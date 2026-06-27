// Typed postMessage bridge for the Settings Webview panel.
// Imports the shared singleton so acquireVsCodeApi() is only called once.
import { vscodeApi as _api } from './vscode-api';

const vscodeApi = {
    postMessage: (msg: SettingsWebviewToExtension) => _api.postMessage(msg),
    getState: () => _api.getState(),
    setState: (s: unknown) => _api.setState(s),
};
export default vscodeApi;

// ─── Shared types ─────────────────────────────────────────────────────────────

export type ProviderId = 'vscode-lm' | 'anthropic' | 'gemini' | 'openai' | 'local';
export type ProviderStatus = 'connected' | 'unreachable' | 'unknown' | 'testing';

export interface ModelOption {
    id: string;
    displayName: string;
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

// ─── Message types ────────────────────────────────────────────────────────────

export type SettingsExtensionToWebview =
    | { type: 'load'; config: SettingsConfigData; providerStatus: Record<ProviderId, ProviderStatus>; secretsPresent: Record<string, boolean>; availableModels: ModelOption[] }
    | { type: 'saveAck'; availableModels: ModelOption[] }
    | { type: 'connectionResult'; provider: ProviderId; ok: boolean; message: string };

export type SettingsWebviewToExtension =
    | { type: 'ready' }
    | { type: 'save'; config: SettingsConfigData }
    | { type: 'testConnection'; provider: ProviderId }
    | { type: 'saveSecret'; provider: ProviderId };
