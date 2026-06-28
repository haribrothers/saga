// Typed postMessage bridge for the Generation Review Webview panel.
import { vscodeApi } from './vscode-api';

export type ReviewMode = 'epics' | 'stories';

export interface EpicDraft {
    id: string;
    title: string;
    description: string;
    labels: string[];
}

export interface StoryDraft {
    id: string;
    title: string;
    epic: string;
    as_a: string;
    i_want: string;
    so_that: string;
    description: string;
    acceptance_criteria: string[];
    estimate: number | undefined;
    labels: string[];
    invest?: InvestResult;
}

export type InvestGrade = 'pass' | 'warn' | 'fail';

export interface InvestCriterion {
    result: InvestGrade;
    reason: string;
}

export interface InvestResult {
    independent: InvestCriterion;
    negotiable: InvestCriterion;
    valuable: InvestCriterion;
    estimable: InvestCriterion;
    small: InvestCriterion;
    testable: InvestCriterion;
}

export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    estimated?: boolean;
}

export type ReviewExtensionToWebview =
    | { type: 'load'; mode: ReviewMode; epics: EpicDraft[]; stories: StoryDraft[]; modelLabel: string; contextFileCount: number; tokenUsage?: TokenUsage }
    | { type: 'investResults'; results: Record<string, InvestResult> }
    | { type: 'refined'; mode: ReviewMode; epics: EpicDraft[]; stories: StoryDraft[]; tokenUsage?: TokenUsage }
    | { type: 'saveAck' }
    | { type: 'error'; message: string };

export type ReviewWebviewToExtension =
    | { type: 'ready' }
    | { type: 'validate'; stories: StoryDraft[] }
    | { type: 'refine'; mode: ReviewMode; items: EpicDraft[] | StoryDraft[]; instructions: string }
    | { type: 'regenerate' }
    | { type: 'save'; mode: ReviewMode; epics: EpicDraft[]; stories: StoryDraft[] };

const reviewApi = {
    postMessage: (msg: ReviewWebviewToExtension) => vscodeApi.postMessage(msg),
};
export default reviewApi;
