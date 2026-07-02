import { vscodeApi } from './vscode-api';

// ─── Message types ─────────────────────────────────────────────────────────────

export interface GettingStartedState {
    hasProvider: boolean;
    hasContext: boolean;
    hasEpic: boolean;
}

export type ExtensionToWebview =
    | { type: 'load'; state: GettingStartedState };

export type WebviewToExtension =
    | { type: 'ready' }
    | { type: 'runStep'; step: 'provider' | 'context' | 'epic' }
    | { type: 'skip' }
    | { type: 'finish' };

// ─── Typed API ────────────────────────────────────────────────────────────────

export function sendReady(): void {
    vscodeApi.postMessage({ type: 'ready' } satisfies WebviewToExtension);
}

export function sendRunStep(step: 'provider' | 'context' | 'epic'): void {
    vscodeApi.postMessage({ type: 'runStep', step } satisfies WebviewToExtension);
}

export function sendSkip(): void {
    vscodeApi.postMessage({ type: 'skip' } satisfies WebviewToExtension);
}

export function sendFinish(): void {
    vscodeApi.postMessage({ type: 'finish' } satisfies WebviewToExtension);
}

export function onMessage(handler: (msg: ExtensionToWebview) => void): () => void {
    const listener = (event: MessageEvent<ExtensionToWebview>) => handler(event.data);
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
}
