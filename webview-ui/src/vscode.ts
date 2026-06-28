// Typed bridge to the VS Code extension host postMessage API — Story panel.
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
    | { type: 'load'; story: StoryData; epics: EpicSummary[] }
    | { type: 'investResult'; invest: InvestData }
    | { type: 'saveAck' };

export type WebviewToExtension =
    | { type: 'ready' }
    | { type: 'save'; story: StoryData }
    | { type: 'validate' };

export interface StoryData {
    id: string;
    title: string;
    epic: string;
    status: string;
    as_a: string;
    i_want: string;
    so_that: string;
    description?: string;
    acceptance_criteria: string[];
    estimate?: number;
    labels: string[];
    invest?: InvestData;
    // Passed through opaquely so save never strips sync state
    remote?: unknown;
    local_hash?: string;
}

export interface EpicSummary {
    id: string;
    title: string;
}

export type InvestGrade = 'pass' | 'warn' | 'fail';

export interface InvestCriterion {
    result: InvestGrade;
    reason: string;
}

export interface InvestData {
    independent: InvestCriterion;
    negotiable: InvestCriterion;
    valuable: InvestCriterion;
    estimable: InvestCriterion;
    small: InvestCriterion;
    testable: InvestCriterion;
}
