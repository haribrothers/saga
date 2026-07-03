// Typed bridge to the VS Code extension host postMessage API — Epic panel.
// Re-exports the shared singleton so acquireVsCodeApi() is only called once.
import { vscodeApi } from './vscode-api';

const vscode = {
    postMessage: (msg: WebviewToExtension) => vscodeApi.postMessage(msg),
    getState: () => vscodeApi.getState(),
    setState: (s: unknown) => vscodeApi.setState(s),
};
export default vscode;

// ─── Message types (shared contract between Webview and extension host) ────────

export type ExtensionToWebview =
    | { type: 'load'; epic: EpicData; storyCount: number }
    | { type: 'saveAck' };

export type WebviewToExtension =
    | { type: 'ready' }
    | { type: 'save'; epic: EpicData };

export interface EpicData {
    id: string;
    title: string;
    status: string;
    description?: string;
    labels: string[];
    // Passed through opaquely so save never strips sync state
    remote?: unknown;
    local_hash?: string;
}
