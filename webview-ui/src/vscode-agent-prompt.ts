import { vscodeApi } from './vscode-api';

// ─── Message types ─────────────────────────────────────────────────────────────

export interface SerialTokenUsage {
    inputTokens: number;
    outputTokens: number;
    estimated?: boolean;
}

export type ExtensionToWebview =
    | { type: 'load'; storyId: string; storyTitle: string; content: string; modelLabel: string; tokenUsage?: SerialTokenUsage }
    | { type: 'error'; message: string };

export type WebviewToExtension =
    | { type: 'ready' }
    | { type: 'save' }
    | { type: 'copy' };

// ─── Typed API ────────────────────────────────────────────────────────────────

export function sendReady(): void {
    vscodeApi.postMessage({ type: 'ready' } satisfies WebviewToExtension);
}

export function sendSave(): void {
    vscodeApi.postMessage({ type: 'save' } satisfies WebviewToExtension);
}

export function sendCopy(): void {
    vscodeApi.postMessage({ type: 'copy' } satisfies WebviewToExtension);
}

export function onMessage(handler: (msg: ExtensionToWebview) => void): () => void {
    const listener = (event: MessageEvent<ExtensionToWebview>) => handler(event.data);
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
}
