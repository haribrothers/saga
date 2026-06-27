// Typed bridge to the VS Code extension host postMessage API.
// acquireVsCodeApi() is injected by VS Code into the Webview context.

declare function acquireVsCodeApi(): {
    postMessage(msg: WebviewToExtension): void;
    getState(): unknown;
    setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
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
