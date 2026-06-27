import * as vscode from 'vscode';
import * as yaml from 'yaml';
import { getSagaRoot, readConfig } from '../saga-repo';
import { VsCodeLmProvider } from '../llm/vscode-lm';
import { LocalLmProvider } from '../llm/local';
import { SecretsManager, SecretKey, SecretKeyName } from '../secrets';
import { getWebviewHtml } from './html';

// ─── Message contract ─────────────────────────────────────────────────────────

export type ProviderId = 'vscode-lm' | 'anthropic' | 'gemini' | 'openai' | 'local';
export type ProviderStatus = 'connected' | 'unreachable' | 'unknown' | 'testing';

/** A model available for selection in the routing picker. */
export interface ModelOption {
    id: string;          // e.g. "claude-sonnet-4-6"
    displayName: string; // e.g. "claude-sonnet-4-6 (Anthropic)"
    provider: ProviderId;
}

export interface SettingsConfigData {
    ai: {
        default_provider: ProviderId;
        providers: {
            'vscode-lm': { enabled: boolean };
            anthropic: { enabled: boolean; prompt_caching: boolean };
            gemini: { enabled: boolean };
            openai: { enabled: boolean };
            local: { enabled: boolean; base_url: string };
        };
        routing: {
            epic_generation: string;    // model ID or "auto"
            story_generation: string;
            invest_validation: string;
            story_splitting: string;
            agent_prompt: string;
            agents_md: string;
        };
        budget: {
            confirm_above_usd: number;
            show_token_preview: boolean;
        };
    };
    tracker: {
        default: 'jira' | 'ado' | 'none';
    };
}

type ExtensionToWebview =
    | { type: 'load'; config: SettingsConfigData; providerStatus: Record<ProviderId, ProviderStatus>; secretsPresent: Record<string, boolean>; availableModels: ModelOption[] }
    | { type: 'saveAck'; availableModels: ModelOption[] }
    | { type: 'connectionResult'; provider: ProviderId; ok: boolean; message: string };

type WebviewToExtension =
    | { type: 'ready' }
    | { type: 'save'; config: SettingsConfigData }
    | { type: 'testConnection'; provider: ProviderId }
    | { type: 'saveSecret'; provider: ProviderId };

// Secret storage keys per provider
const SECRET_KEYS: Partial<Record<ProviderId, SecretKeyName>> = {
    anthropic: SecretKey.ANTHROPIC_API_KEY,
    gemini: SecretKey.GEMINI_API_KEY,
    openai: SecretKey.OPENAI_API_KEY,
};

// ─── Panel ────────────────────────────────────────────────────────────────────

export class SettingsPanel {
    static readonly viewType = 'sagaSettings';
    private static _panel: SettingsPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;

    static async open(
        workspaceRoot: vscode.Uri,
        extensionUri: vscode.Uri,
        secrets: SecretsManager,
    ): Promise<void> {
        if (SettingsPanel._panel) {
            SettingsPanel._panel._panel.reveal();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            SettingsPanel.viewType,
            'Saga Settings',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')],
                retainContextWhenHidden: true,
            },
        );
        new SettingsPanel(panel, workspaceRoot, extensionUri, secrets);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly workspaceRoot: vscode.Uri,
        private readonly extensionUri: vscode.Uri,
        private readonly secrets: SecretsManager,
    ) {
        this._panel = panel;
        SettingsPanel._panel = this;

        this._panel.webview.html = this.getHtml();
        this._panel.webview.onDidReceiveMessage((msg: WebviewToExtension) => this.handleMessage(msg));
        this._panel.onDidDispose(() => { SettingsPanel._panel = undefined; });
    }

    private async handleMessage(msg: WebviewToExtension): Promise<void> {
        if (msg.type === 'ready') {
            await this.sendLoad();
        }

        if (msg.type === 'save') {
            await this.saveConfig(msg.config);
            // Re-discover models against the updated config so the routing
            // dropdowns refresh without the user having to reopen the panel.
            const availableModels = await this.discoverModels(msg.config);
            this.post({ type: 'saveAck', availableModels });
            this._panel.title = 'Saga Settings';
        }

        if (msg.type === 'testConnection') {
            const result = await this.testProvider(msg.provider);
            this.post({ type: 'connectionResult', provider: msg.provider, ...result });
        }

        if (msg.type === 'saveSecret') {
            await this.promptForSecret(msg.provider);
            // After storing, re-send load so secretsPresent reflects the new state
            await this.sendLoad();
        }
    }

    // ─── Load ─────────────────────────────────────────────────────────────────

    private async sendLoad(): Promise<void> {
        const sagaRoot = getSagaRoot(this.workspaceRoot);
        const config = await this.readSettingsConfig(sagaRoot);
        const [providerStatus, secretsPresent, availableModels] = await Promise.all([
            this.probeAllProviders(config),
            this.checkSecretsPresent(),
            this.discoverModels(config),
        ]);
        this.post({ type: 'load', config, providerStatus, secretsPresent, availableModels });
    }

    private async readSettingsConfig(sagaRoot: vscode.Uri): Promise<SettingsConfigData> {
        try {
            const raw = await readConfig(sagaRoot);
            // Zod already coerces legacy { tier } objects to "auto" via RoutingValueSchema
            const r = raw.ai.routing ?? {};
            return {
                ai: {
                    default_provider: raw.ai.default_provider as ProviderId,
                    providers: {
                        'vscode-lm': { enabled: raw.ai.providers['vscode-lm']?.enabled ?? true },
                        anthropic: { enabled: raw.ai.providers.anthropic?.enabled ?? false, prompt_caching: raw.ai.providers.anthropic?.prompt_caching ?? true },
                        gemini: { enabled: raw.ai.providers.gemini?.enabled ?? false },
                        openai: { enabled: raw.ai.providers.openai?.enabled ?? false },
                        local: { enabled: raw.ai.providers.local?.enabled ?? false, base_url: raw.ai.providers.local?.base_url ?? 'http://localhost:11434/v1' },
                    },
                    routing: {
                        epic_generation:   typeof r.epic_generation   === 'string' ? r.epic_generation   : 'auto',
                        story_generation:  typeof r.story_generation  === 'string' ? r.story_generation  : 'auto',
                        invest_validation: typeof r.invest_validation === 'string' ? r.invest_validation : 'auto',
                        story_splitting:   typeof r.story_splitting   === 'string' ? r.story_splitting   : 'auto',
                        agent_prompt:      typeof r.agent_prompt      === 'string' ? r.agent_prompt      : 'auto',
                        agents_md:         typeof r.agents_md         === 'string' ? r.agents_md         : 'auto',
                    },
                    budget: {
                        confirm_above_usd: raw.ai.budget?.confirm_above_usd ?? 0.5,
                        show_token_preview: raw.ai.budget?.show_token_preview ?? true,
                    },
                },
                tracker: { default: raw.tracker.default },
            };
        } catch {
            return defaultSettingsConfig();
        }
    }

    // ─── Save ─────────────────────────────────────────────────────────────────

    private async saveConfig(data: SettingsConfigData): Promise<void> {
        const sagaRoot = getSagaRoot(this.workspaceRoot);
        const configUri = vscode.Uri.joinPath(sagaRoot, 'config.yaml');

        // Read raw YAML to preserve comments and fields we don't manage
        let rawText = '';
        try {
            const bytes = await vscode.workspace.fs.readFile(configUri);
            rawText = Buffer.from(bytes).toString('utf-8');
        } catch { /* new file */ }

        // Parse → patch → re-serialize
        const doc = rawText ? yaml.parseDocument(rawText) : new yaml.Document();

        setIn(doc, ['ai', 'default_provider'], data.ai.default_provider);
        setIn(doc, ['ai', 'providers', 'vscode-lm', 'enabled'], data.ai.providers['vscode-lm'].enabled);
        setIn(doc, ['ai', 'providers', 'anthropic', 'enabled'], data.ai.providers.anthropic.enabled);
        setIn(doc, ['ai', 'providers', 'anthropic', 'prompt_caching'], data.ai.providers.anthropic.prompt_caching);
        setIn(doc, ['ai', 'providers', 'gemini', 'enabled'], data.ai.providers.gemini.enabled);
        setIn(doc, ['ai', 'providers', 'openai', 'enabled'], data.ai.providers.openai.enabled);
        setIn(doc, ['ai', 'providers', 'local', 'enabled'], data.ai.providers.local.enabled);
        setIn(doc, ['ai', 'providers', 'local', 'base_url'], data.ai.providers.local.base_url);
        setIn(doc, ['ai', 'routing', 'epic_generation'],   data.ai.routing.epic_generation);
        setIn(doc, ['ai', 'routing', 'story_generation'],  data.ai.routing.story_generation);
        setIn(doc, ['ai', 'routing', 'invest_validation'], data.ai.routing.invest_validation);
        setIn(doc, ['ai', 'routing', 'story_splitting'],   data.ai.routing.story_splitting);
        setIn(doc, ['ai', 'routing', 'agent_prompt'],      data.ai.routing.agent_prompt);
        setIn(doc, ['ai', 'routing', 'agents_md'],         data.ai.routing.agents_md);
        setIn(doc, ['ai', 'budget', 'confirm_above_usd'], data.ai.budget.confirm_above_usd);
        setIn(doc, ['ai', 'budget', 'show_token_preview'], data.ai.budget.show_token_preview);
        setIn(doc, ['tracker', 'default'], data.tracker.default);

        await vscode.workspace.fs.writeFile(configUri, Buffer.from(doc.toString(), 'utf-8'));
    }

    // ─── Connection test ──────────────────────────────────────────────────────

    private async testProvider(id: ProviderId): Promise<{ ok: boolean; message: string }> {
        try {
            if (id === 'vscode-lm') {
                const p = new VsCodeLmProvider();
                const ok = await p.isAvailable();
                return ok ? { ok: true, message: 'Connected via Copilot.' } : { ok: false, message: 'No Copilot models found. Install the GitHub Copilot extension.' };
            }
            if (id === 'local') {
                const p = new LocalLmProvider();
                const ok = await p.isAvailable();
                return ok ? { ok: true, message: 'Local endpoint reachable.' } : { ok: false, message: 'Cannot reach local endpoint. Is Ollama / LM Studio running?' };
            }
            // BYOK providers — just check key presence for now (adapters added in M4)
            const key = SECRET_KEYS[id];
            if (!key) {
                return { ok: false, message: 'Provider not yet supported.' };
            }
            const stored = await this.secrets.get(key);
            if (!stored) {
                return { ok: false, message: 'No API key stored. Click "Update Key" to add one.' };
            }
            return { ok: true, message: 'API key is stored. Full connectivity test available after M4 adapter is wired.' };
        } catch (err) {
            return { ok: false, message: String(err) };
        }
    }

    private async probeAllProviders(config: SettingsConfigData): Promise<Record<ProviderId, ProviderStatus>> {
        const status: Record<ProviderId, ProviderStatus> = {
            'vscode-lm': 'unknown',
            anthropic: 'unknown',
            gemini: 'unknown',
            openai: 'unknown',
            local: 'unknown',
        };
        // Only probe enabled providers to keep load fast
        const probes: Promise<void>[] = [];
        for (const [id, cfg] of Object.entries(config.ai.providers) as [ProviderId, { enabled: boolean }][]) {
            if (!cfg.enabled) { continue; }
            probes.push(
                this.testProvider(id).then(({ ok }) => {
                    status[id] = ok ? 'connected' : 'unreachable';
                }).catch(() => { status[id] = 'unreachable'; }),
            );
        }
        await Promise.all(probes);
        return status;
    }

    // ─── Model discovery ──────────────────────────────────────────────────────

    private async discoverModels(config: SettingsConfigData): Promise<ModelOption[]> {
        const options: ModelOption[] = [];

        const queries: Promise<void>[] = [];

        if (config.ai.providers['vscode-lm'].enabled) {
            queries.push((async () => {
                try {
                    const p = new VsCodeLmProvider();
                    const models = await p.listModels();
                    for (const m of models) {
                        options.push({ id: m.id, displayName: `${m.displayName} (Copilot)`, provider: 'vscode-lm' });
                    }
                } catch { /* provider unavailable */ }
            })());
        }

        if (config.ai.providers.local.enabled) {
            queries.push((async () => {
                try {
                    const p = new LocalLmProvider();
                    const models = await p.listModels();
                    for (const m of models) {
                        options.push({ id: m.id, displayName: `${m.displayName} (Local)`, provider: 'local' });
                    }
                } catch { /* endpoint unreachable */ }
            })());
        }

        // BYOK providers: we know their model IDs statically until M4 adapters land.
        // Show them only if a key is stored.
        const byokModels: Array<{ provider: ProviderId; models: Array<{ id: string; label: string }> }> = [
            {
                provider: 'anthropic',
                models: [
                    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Anthropic)' },
                    { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5 (Anthropic)' },
                    { id: 'claude-opus-4-8',   label: 'Claude Opus 4.8 (Anthropic)' },
                ],
            },
            {
                provider: 'gemini',
                models: [
                    { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro (Google)' },
                    { id: 'gemini-2.0-flash',  label: 'Gemini 2.0 Flash (Google)' },
                ],
            },
            {
                provider: 'openai',
                models: [
                    { id: 'gpt-4o',       label: 'GPT-4o (OpenAI)' },
                    { id: 'gpt-4o-mini',  label: 'GPT-4o Mini (OpenAI)' },
                ],
            },
        ];

        for (const { provider, models } of byokModels) {
            const key = SECRET_KEYS[provider];
            if (!key) { continue; }
            if (!config.ai.providers[provider].enabled) { continue; }
            queries.push((async () => {
                const hasKey = await this.secrets.has(key);
                if (!hasKey) { return; }
                for (const m of models) {
                    options.push({ id: m.id, displayName: m.label, provider });
                }
            })());
        }

        await Promise.all(queries);
        return options;
    }

    // ─── Secret entry ─────────────────────────────────────────────────────────

    private async promptForSecret(provider: ProviderId): Promise<void> {
        const key = SECRET_KEYS[provider];
        if (!key) { return; }

        const providerLabel: Record<string, string> = {
            anthropic: 'Anthropic',
            gemini: 'Google Gemini',
            openai: 'OpenAI',
        };

        const input = await vscode.window.showInputBox({
            title: `${providerLabel[provider] ?? provider} API Key`,
            prompt: 'Enter your API key. It will be stored in VS Code SecretStorage and never written to disk.',
            password: true,
            ignoreFocusOut: true,
            validateInput: (v) => v.trim().length < 10 ? 'Key looks too short.' : undefined,
        });

        if (input?.trim()) {
            await this.secrets.set(key, input.trim());
        }
    }

    private async checkSecretsPresent(): Promise<Record<string, boolean>> {
        const result: Record<string, boolean> = {};
        for (const [provider, key] of Object.entries(SECRET_KEYS) as [string, SecretKeyName][]) {
            result[provider] = await this.secrets.has(key);
        }
        return result;
    }

    // ─── HTML ─────────────────────────────────────────────────────────────────

    private getHtml(): string {
        return getWebviewHtml(this._panel.webview, this.extensionUri, 'settings');
    }

    private post(msg: ExtensionToWebview): void {
        this._panel.webview.postMessage(msg);
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Deep-set a value in a yaml.Document by key path, creating maps as needed. */
function setIn(doc: yaml.Document, path: string[], value: unknown): void {
    doc.setIn(path, value);
}

function defaultSettingsConfig(): SettingsConfigData {
    return {
        ai: {
            default_provider: 'vscode-lm',
            providers: {
                'vscode-lm': { enabled: true },
                anthropic: { enabled: false, prompt_caching: true },
                gemini: { enabled: false },
                openai: { enabled: false },
                local: { enabled: false, base_url: 'http://localhost:11434/v1' },
            },
            routing: {
                epic_generation: 'auto',
                story_generation: 'auto',
                invest_validation: 'auto',
                story_splitting: 'auto',
                agent_prompt: 'auto',
                agents_md: 'auto',
            },
            budget: { confirm_above_usd: 0.5, show_token_preview: true },
        },
        tracker: { default: 'none' },
    };
}
