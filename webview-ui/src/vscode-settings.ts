// Typed postMessage bridge for the Settings Webview panel.
// Kept separate from vscode.ts (story panel) to avoid type conflicts.

declare function acquireVsCodeApi(): {
    postMessage(msg: SettingsWebviewToExtension): void;
    getState(): unknown;
    setState(state: unknown): void;
};

const vscodeApi = acquireVsCodeApi();
export default vscodeApi;

// ─── Shared types ─────────────────────────────────────────────────────────────

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

// ─── Message types ────────────────────────────────────────────────────────────

export type SettingsExtensionToWebview =
    | { type: 'load'; config: SettingsConfigData; providerStatus: Record<ProviderId, ProviderStatus>; secretsPresent: Record<string, boolean> }
    | { type: 'saveAck' }
    | { type: 'connectionResult'; provider: ProviderId; ok: boolean; message: string };

export type SettingsWebviewToExtension =
    | { type: 'ready' }
    | { type: 'save'; config: SettingsConfigData }
    | { type: 'testConnection'; provider: ProviderId }
    | { type: 'saveSecret'; provider: ProviderId };
