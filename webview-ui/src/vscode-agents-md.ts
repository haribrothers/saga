import { vscodeApi } from './vscode-api';

// ─── Message types ─────────────────────────────────────────────────────────────

export interface SerialTokenUsage {
    inputTokens: number;
    outputTokens: number;
    estimated?: boolean;
}

export type ExtensionToWebview =
    | { type: 'load'; content: string; modelLabel: string; tokenUsage?: SerialTokenUsage; hasExisting: boolean }
    | { type: 'acceptAck' }
    | { type: 'error'; message: string };

export type WebviewToExtension =
    | { type: 'ready' }
    | { type: 'accept'; content: string }
    | { type: 'regenerate' }
    | { type: 'discard' };

// ─── Typed API ────────────────────────────────────────────────────────────────

export function sendReady(): void {
    vscodeApi.postMessage({ type: 'ready' } satisfies WebviewToExtension);
}

export function sendAccept(content: string): void {
    vscodeApi.postMessage({ type: 'accept', content } satisfies WebviewToExtension);
}

export function sendRegenerate(): void {
    vscodeApi.postMessage({ type: 'regenerate' } satisfies WebviewToExtension);
}

export function sendDiscard(): void {
    vscodeApi.postMessage({ type: 'discard' } satisfies WebviewToExtension);
}

export function onMessage(handler: (msg: ExtensionToWebview) => void): () => void {
    const listener = (event: MessageEvent<ExtensionToWebview>) => handler(event.data);
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
}
