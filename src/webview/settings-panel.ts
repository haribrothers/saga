import * as vscode from 'vscode';
import * as yaml from 'yaml';
import { getSagaRoot, readConfig } from '../saga-repo';
import { VsCodeLmProvider } from '../llm/vscode-lm';
import { LocalLmProvider } from '../llm/local';
import { SecretsManager, SecretKey, SecretKeyName } from '../secrets';

// ─── Message contract ─────────────────────────────────────────────────────────

export type ProviderId = 'vscode-lm' | 'anthropic' | 'gemini' | 'openai' | 'local';
export type ProviderStatus = 'connected' | 'unreachable' | 'unknown' | 'testing';
export type ModelTier = 'quality' | 'cheap';

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
            epic_generation: ModelTier;
            story_generation: ModelTier;
            invest_validation: ModelTier;
            story_splitting: ModelTier;
            agent_prompt: ModelTier;
            agents_md: ModelTier;
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
    | { type: 'load'; config: SettingsConfigData; providerStatus: Record<ProviderId, ProviderStatus>; secretsPresent: Record<string, boolean> }
    | { type: 'saveAck' }
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
            this.post({ type: 'saveAck' });
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
        const providerStatus = await this.probeAllProviders(config);
        const secretsPresent = await this.checkSecretsPresent();
        this.post({ type: 'load', config, providerStatus, secretsPresent });
    }

    private async readSettingsConfig(sagaRoot: vscode.Uri): Promise<SettingsConfigData> {
        try {
            const raw = await readConfig(sagaRoot);
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
                        epic_generation: (raw.ai.routing?.epic_generation?.tier ?? 'quality') as ModelTier,
                        story_generation: (raw.ai.routing?.story_generation?.tier ?? 'quality') as ModelTier,
                        invest_validation: (raw.ai.routing?.invest_validation?.tier ?? 'cheap') as ModelTier,
                        story_splitting: (raw.ai.routing?.story_splitting?.tier ?? 'cheap') as ModelTier,
                        agent_prompt: (raw.ai.routing?.agent_prompt?.tier ?? 'cheap') as ModelTier,
                        agents_md: (raw.ai.routing?.agents_md?.tier ?? 'cheap') as ModelTier,
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
        setIn(doc, ['ai', 'routing', 'epic_generation', 'tier'], data.ai.routing.epic_generation);
        setIn(doc, ['ai', 'routing', 'story_generation', 'tier'], data.ai.routing.story_generation);
        setIn(doc, ['ai', 'routing', 'invest_validation', 'tier'], data.ai.routing.invest_validation);
        setIn(doc, ['ai', 'routing', 'story_splitting', 'tier'], data.ai.routing.story_splitting);
        setIn(doc, ['ai', 'routing', 'agent_prompt', 'tier'], data.ai.routing.agent_prompt);
        setIn(doc, ['ai', 'routing', 'agents_md', 'tier'], data.ai.routing.agents_md);
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
        const webview = this._panel.webview;
        const distUri = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'assets', 'index.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'assets', 'index.css'));
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Saga Settings</title>
</head>
<body>
    <div id="root" data-panel="settings"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private post(msg: ExtensionToWebview): void {
        this._panel.webview.postMessage(msg);
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/** Deep-set a value in a yaml.Document by key path, creating maps as needed. */
function setIn(doc: yaml.Document, path: string[], value: unknown): void {
     
    let node: any = doc.contents;
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        let child = node?.get?.(key, true);
        if (!child || child.type !== 'MAP') {
            const map = doc.createNode({});
            node.set(key, map);
            child = map;
        }
        node = child;
    }
    node?.set?.(path[path.length - 1], value);
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
                epic_generation: 'quality',
                story_generation: 'quality',
                invest_validation: 'cheap',
                story_splitting: 'cheap',
                agent_prompt: 'cheap',
                agents_md: 'cheap',
            },
            budget: { confirm_above_usd: 0.5, show_token_preview: true },
        },
        tracker: { default: 'none' },
    };
}
