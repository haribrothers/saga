import * as vscode from 'vscode';
import * as yaml from 'yaml';
import { getSagaRoot, readConfig } from '../saga-repo';
import { VsCodeLmProvider } from '../llm/vscode-lm';
import { LocalLmProvider } from '../llm/local';
import { AnthropicProvider } from '../llm/anthropic';
import { GeminiProvider } from '../llm/gemini';
import { OpenAIByokProvider } from '../llm/openai-byok';
import { OpenRouterProvider } from '../llm/openrouter';
import { SecretsManager, SecretKey, SecretKeyName } from '../secrets';
import { getWebviewHtml } from './html';

// ─── Message contract ─────────────────────────────────────────────────────────

export type ProviderId = 'vscode-lm' | 'anthropic' | 'gemini' | 'openai' | 'openrouter' | 'local';
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
            openrouter: { enabled: boolean };
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
        jira: {
            base_url: string;
            project_key: string;
            email: string;
            epic_issue_type: string;
            story_issue_type: string;
            subtask_issue_type: string;
            ac_field_id: string;
            epic_link_style: 'parent' | 'customfield_10014';
            story_points_field_id: string; // empty string = omit from push
        };
        ado: {
            org_url: string;
            project: string;
            area_path: string;
            epic_work_item_type: string;
            story_work_item_type: string;
        };
    };
}

type ExtensionToWebview =
    | { type: 'load'; config: SettingsConfigData; providerStatus: Record<ProviderId, ProviderStatus>; secretsPresent: Record<string, boolean>; availableModels: ModelOption[] }
    | { type: 'saveAck'; availableModels: ModelOption[] }
    | { type: 'connectionResult'; provider: ProviderId; ok: boolean; message: string }
    | { type: 'trackerConnectionResult'; tracker: 'jira' | 'ado'; ok: boolean; message: string };

type WebviewToExtension =
    | { type: 'ready' }
    | { type: 'save'; config: SettingsConfigData }
    | { type: 'testConnection'; provider: ProviderId }
    | { type: 'saveSecret'; provider: ProviderId }
    | { type: 'saveTrackerSecret'; tracker: 'jira' | 'ado' }
    | { type: 'testTrackerConnection'; tracker: 'jira' | 'ado' };

// Secret storage keys per AI provider
const SECRET_KEYS: Partial<Record<ProviderId, SecretKeyName>> = {
    anthropic: SecretKey.ANTHROPIC_API_KEY,
    gemini: SecretKey.GEMINI_API_KEY,
    openai: SecretKey.OPENAI_API_KEY,
    openrouter: SecretKey.OPENROUTER_API_KEY,
};

// Secret storage keys per tracker
const TRACKER_SECRET_KEYS: Record<'jira' | 'ado', SecretKeyName> = {
    jira: SecretKey.JIRA_API_TOKEN,
    ado: SecretKey.ADO_PAT,
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

        if (msg.type === 'saveTrackerSecret') {
            await this.promptForTrackerSecret(msg.tracker);
            await this.sendLoad();
        }

        if (msg.type === 'testTrackerConnection') {
            const result = await this.testTrackerConnection(msg.tracker);
            this.post({ type: 'trackerConnectionResult', tracker: msg.tracker, ...result });
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
                        openrouter: { enabled: raw.ai.providers.openrouter?.enabled ?? false },
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
                tracker: {
                    default: raw.tracker.default,
                    jira: {
                        base_url: raw.tracker.jira?.base_url ?? '',
                        project_key: raw.tracker.jira?.project_key ?? '',
                        email: raw.tracker.jira?.email ?? '',
                        epic_issue_type: raw.tracker.jira?.epic_issue_type ?? 'Epic',
                        story_issue_type: raw.tracker.jira?.story_issue_type ?? 'Story',
                        subtask_issue_type: raw.tracker.jira?.subtask_issue_type ?? 'Sub-task',
                        ac_field_id: raw.tracker.jira?.ac_field_id ?? 'description',
                        epic_link_style: raw.tracker.jira?.epic_link_style ?? 'parent',
                        story_points_field_id: raw.tracker.jira?.story_points_field_id ?? '',
                    },
                    ado: {
                        org_url: raw.tracker.ado?.org_url ?? '',
                        project: raw.tracker.ado?.project ?? '',
                        area_path: raw.tracker.ado?.area_path ?? '',
                        epic_work_item_type: raw.tracker.ado?.epic_work_item_type ?? 'Epic',
                        story_work_item_type: raw.tracker.ado?.story_work_item_type ?? 'User Story',
                    },
                },
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
        setIn(doc, ['ai', 'providers', 'openrouter', 'enabled'], data.ai.providers.openrouter.enabled);
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
        setIn(doc, ['tracker', 'jira', 'base_url'],          data.tracker.jira.base_url);
        setIn(doc, ['tracker', 'jira', 'project_key'],        data.tracker.jira.project_key);
        setIn(doc, ['tracker', 'jira', 'email'],              data.tracker.jira.email);
        setIn(doc, ['tracker', 'jira', 'epic_issue_type'],    data.tracker.jira.epic_issue_type);
        setIn(doc, ['tracker', 'jira', 'story_issue_type'],   data.tracker.jira.story_issue_type);
        setIn(doc, ['tracker', 'jira', 'subtask_issue_type'], data.tracker.jira.subtask_issue_type);
        setIn(doc, ['tracker', 'jira', 'ac_field_id'],        data.tracker.jira.ac_field_id);
        setIn(doc, ['tracker', 'jira', 'epic_link_style'],         data.tracker.jira.epic_link_style);
        // Only write story_points_field_id when non-empty; omit to keep the
        // field undefined in config.yaml (which means "skip story points on push").
        if (data.tracker.jira.story_points_field_id) {
            setIn(doc, ['tracker', 'jira', 'story_points_field_id'], data.tracker.jira.story_points_field_id);
        }
        setIn(doc, ['tracker', 'ado', 'org_url'],             data.tracker.ado.org_url);
        setIn(doc, ['tracker', 'ado', 'project'],             data.tracker.ado.project);
        setIn(doc, ['tracker', 'ado', 'area_path'],           data.tracker.ado.area_path);
        setIn(doc, ['tracker', 'ado', 'epic_work_item_type'], data.tracker.ado.epic_work_item_type);
        setIn(doc, ['tracker', 'ado', 'story_work_item_type'],data.tracker.ado.story_work_item_type);

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
            // BYOK providers — use real adapters to do a live availability check
            const key = SECRET_KEYS[id];
            if (!key) {
                return { ok: false, message: 'Provider not yet supported.' };
            }
            const stored = await this.secrets.get(key);
            if (!stored) {
                return { ok: false, message: 'No API key stored. Click "Update Key" to add one.' };
            }
            const getKey = () => this.secrets.get(key);
            let provider;
            if (id === 'anthropic') { provider = new AnthropicProvider(getKey); }
            else if (id === 'gemini') { provider = new GeminiProvider(getKey); }
            else if (id === 'openai') { provider = new OpenAIByokProvider(getKey); }
            else if (id === 'openrouter') { provider = new OpenRouterProvider(getKey); }
            else { return { ok: false, message: 'Provider not yet supported.' }; }
            const ok = await provider.isAvailable();
            return ok
                ? { ok: true, message: 'API key is stored and valid.' }
                : { ok: false, message: 'API key present but provider is unreachable.' };
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
            openrouter: 'unknown',
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

        // BYOK providers — use the real adapters to list models (requires key stored).
        const byokProviders: Array<{ id: ProviderId; key: SecretKeyName }> = [
            { id: 'anthropic', key: SecretKey.ANTHROPIC_API_KEY },
            { id: 'gemini',    key: SecretKey.GEMINI_API_KEY },
            { id: 'openai',    key: SecretKey.OPENAI_API_KEY },
            { id: 'openrouter', key: SecretKey.OPENROUTER_API_KEY },
        ];

        for (const { id, key } of byokProviders) {
            if (!config.ai.providers[id].enabled) { continue; }
            queries.push((async () => {
                try {
                    const hasKey = await this.secrets.has(key);
                    if (!hasKey) { return; }
                    const getKey = () => this.secrets.get(key);
                    let provider;
                    if (id === 'anthropic') { provider = new AnthropicProvider(getKey); }
                    else if (id === 'gemini') { provider = new GeminiProvider(getKey); }
                    else if (id === 'openrouter') { provider = new OpenRouterProvider(getKey); }
                    else { provider = new OpenAIByokProvider(getKey); }
                    const models = await provider.listModels();
                    for (const m of models) {
                        options.push({ id: m.id, displayName: m.displayName, provider: id });
                    }
                } catch { /* key present but network error — skip */ }
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
            openrouter: 'OpenRouter',
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

    private async promptForTrackerSecret(tracker: 'jira' | 'ado'): Promise<void> {
        const key = TRACKER_SECRET_KEYS[tracker];
        const label = tracker === 'jira' ? 'Jira API Token' : 'Azure DevOps Personal Access Token (PAT)';
        const input = await vscode.window.showInputBox({
            title: label,
            prompt: 'Enter the token. It will be stored in VS Code SecretStorage and never written to disk.',
            password: true,
            ignoreFocusOut: true,
            validateInput: (v) => v.trim().length < 8 ? 'Token looks too short.' : undefined,
        });
        if (input?.trim()) {
            await this.secrets.set(key, input.trim());
        }
    }

    private async testTrackerConnection(tracker: 'jira' | 'ado'): Promise<{ ok: boolean; message: string }> {
        // Lazy import to avoid pulling tracker code into the settings panel module unnecessarily.
        const { JiraAdapter } = await import('../tracker/jira.js');
        const { AdoAdapter } = await import('../tracker/ado.js');
        const sagaRoot = getSagaRoot(this.workspaceRoot);

        try {
            const config = await readConfig(sagaRoot);
            if (tracker === 'jira') {
                const jiraCfg = config.tracker.jira;
                if (!jiraCfg?.base_url || !jiraCfg.email) {
                    return { ok: false, message: 'Jira base URL and email are required.' };
                }
                const token = await this.secrets.get(SecretKey.JIRA_API_TOKEN);
                if (!token) {
                    return { ok: false, message: 'No Jira API token stored. Click "Update Token" to add one.' };
                }
                const adapter = new JiraAdapter({
                    baseUrl: jiraCfg.base_url,
                    email: jiraCfg.email,
                    apiToken: token,
                    config: {
                        projectKey: jiraCfg.project_key,
                        email: jiraCfg.email,
                        epicIssueType: jiraCfg.epic_issue_type,
                        storyIssueType: jiraCfg.story_issue_type,
                        subtaskIssueType: jiraCfg.subtask_issue_type,
                        acFieldId: jiraCfg.ac_field_id,
                        epicLinkStyle: jiraCfg.epic_link_style,
                    },
                });
                return adapter.testConnection();
            } else {
                const adoCfg = config.tracker.ado;
                if (!adoCfg?.org_url || !adoCfg.project) {
                    return { ok: false, message: 'ADO org URL and project are required.' };
                }
                const pat = await this.secrets.get(SecretKey.ADO_PAT);
                if (!pat) {
                    return { ok: false, message: 'No ADO PAT stored. Click "Update PAT" to add one.' };
                }
                const adapter = new AdoAdapter({
                    orgUrl: adoCfg.org_url,
                    pat,
                    config: {
                        project: adoCfg.project,
                        areaPath: adoCfg.area_path,
                        epicWorkItemType: adoCfg.epic_work_item_type,
                        storyWorkItemType: adoCfg.story_work_item_type,
                    },
                });
                return adapter.testConnection();
            }
        } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : String(err) };
        }
    }

    private async checkSecretsPresent(): Promise<Record<string, boolean>> {
        const result: Record<string, boolean> = {};
        for (const [provider, key] of Object.entries(SECRET_KEYS) as [string, SecretKeyName][]) {
            result[provider] = await this.secrets.has(key);
        }
        // Include tracker secrets
        result['jira'] = await this.secrets.has(TRACKER_SECRET_KEYS.jira);
        result['ado'] = await this.secrets.has(TRACKER_SECRET_KEYS.ado);
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
                openrouter: { enabled: false },
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
        tracker: {
            default: 'none',
            jira: { base_url: '', project_key: '', email: '', epic_issue_type: 'Epic', story_issue_type: 'Story', subtask_issue_type: 'Sub-task', ac_field_id: 'description', epic_link_style: 'parent', story_points_field_id: '' },
            ado: { org_url: '', project: '', area_path: '', epic_work_item_type: 'Epic', story_work_item_type: 'User Story' },
        },
    };
}
