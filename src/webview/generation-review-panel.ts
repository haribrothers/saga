import * as vscode from 'vscode';
import { Epic, Story, InvestResult } from '../schema';
import { writeEpic, writeStory, getSagaRoot } from '../saga-repo';
import { GenerationService } from '../generation/service';
import { InvestValidator } from '../invest/validator';
import { resolveProviderFromConfig, RoutingTask } from '../llm/routing';
import { TokenUsage } from '../llm/provider';
import { getWebviewHtml } from './html';

// ─── Message contract ─────────────────────────────────────────────────────────

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

// Serialisable token usage (mirrors TokenUsage from provider.ts)
export interface SerialTokenUsage {
    inputTokens: number;
    outputTokens: number;
    estimated?: boolean;
}

type ExtensionToWebview =
    | { type: 'load'; mode: ReviewMode; epics: EpicDraft[]; stories: StoryDraft[]; modelLabel: string; contextFileCount: number; tokenUsage?: SerialTokenUsage }
    | { type: 'investResults'; results: Record<string, InvestResult> }
    | { type: 'refined'; mode: ReviewMode; epics: EpicDraft[]; stories: StoryDraft[]; tokenUsage?: SerialTokenUsage }
    | { type: 'saveAck' }
    | { type: 'error'; message: string };

type WebviewToExtension =
    | { type: 'ready' }
    | { type: 'validate'; stories: StoryDraft[] }
    | { type: 'refine'; mode: ReviewMode; items: EpicDraft[] | StoryDraft[]; instructions: string }
    | { type: 'regenerate' }
    | { type: 'save'; mode: ReviewMode; epics: EpicDraft[]; stories: StoryDraft[] };

// ─── Panel ────────────────────────────────────────────────────────────────────

export interface GenerationReviewOptions {
    mode: ReviewMode;
    epics: Epic[];
    stories: Story[];
    modelLabel: string;
    contextFileCount: number;
    tokenUsage?: TokenUsage;
    workspaceRoot: vscode.Uri;
    extensionUri: vscode.Uri;
    /** Called when user clicks Regenerate — re-runs generation and reloads the panel. Signal allows mid-flight cancellation. */
    onRegenerate: (signal: AbortSignal) => Promise<{ epics: Epic[]; stories: Story[]; modelLabel: string; tokenUsage?: TokenUsage }>;
}

export class GenerationReviewPanel {
    static readonly viewType = 'sagaGenerationReview';
    private static _panel: GenerationReviewPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private _opts: GenerationReviewOptions;

    static async open(opts: GenerationReviewOptions): Promise<void> {
        if (GenerationReviewPanel._panel) {
            GenerationReviewPanel._panel._opts = opts;
            GenerationReviewPanel._panel._panel.reveal();
            await GenerationReviewPanel._panel.sendLoad();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            GenerationReviewPanel.viewType,
            opts.mode === 'epics' ? 'Saga — Generated Epics' : 'Saga — Generated Stories',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(opts.extensionUri, 'dist', 'webview')],
                retainContextWhenHidden: true,
            },
        );
        new GenerationReviewPanel(panel, opts);
    }

    private constructor(panel: vscode.WebviewPanel, opts: GenerationReviewOptions) {
        this._panel = panel;
        this._opts = opts;
        GenerationReviewPanel._panel = this;

        this._panel.webview.html = getWebviewHtml(this._panel.webview, opts.extensionUri, 'generation-review');
        this._panel.webview.onDidReceiveMessage((msg: WebviewToExtension) => this.handleMessage(msg));
        this._panel.onDidDispose(() => { GenerationReviewPanel._panel = undefined; });
    }

    private async sendLoad(): Promise<void> {
        this.post({
            type: 'load',
            mode: this._opts.mode,
            epics: this._opts.epics.map(epicToDraft),
            stories: this._opts.stories.map(storyToDraft),
            modelLabel: this._opts.modelLabel,
            contextFileCount: this._opts.contextFileCount,
            tokenUsage: this._opts.tokenUsage,
        });
    }

    private async handleMessage(msg: WebviewToExtension): Promise<void> {
        if (msg.type === 'ready') {
            await this.sendLoad();
        }

        if (msg.type === 'validate') {
            await this.runValidation(msg.stories);
        }

        if (msg.type === 'refine') {
            await this.runRefinement(msg.mode, msg.items, msg.instructions);
        }

        if (msg.type === 'regenerate') {
            await this.runRegenerate();
        }

        if (msg.type === 'save') {
            await this.runSave(msg.mode, msg.epics, msg.stories);
        }
    }

    // ─── Validate ─────────────────────────────────────────────────────────────

    private async runValidation(drafts: StoryDraft[]): Promise<void> {
        const resolved = await resolveProviderFromConfig('invest_validation', this._opts.workspaceRoot);
        const validator = new InvestValidator(resolved?.provider);
        const results: Record<string, InvestResult> = {};

        await Promise.all(drafts.map(async (d) => {
            const story = draftToStory(d);
            results[d.id] = await validator.validate(story);
        }));

        this.post({ type: 'investResults', results });
    }

    // ─── Refine ───────────────────────────────────────────────────────────────

    private async runRefinement(
        mode: ReviewMode,
        items: EpicDraft[] | StoryDraft[],
        instructions: string,
    ): Promise<void> {
        const task: RoutingTask = mode === 'epics' ? 'epic_generation' : 'story_generation';
        const resolved = await resolveProviderFromConfig(task, this._opts.workspaceRoot);
        if (!resolved) {
            this.post({ type: 'error', message: 'No AI provider available for refinement.' });
            return;
        }

        try {
            const service = new GenerationService(resolved.provider);
            if (mode === 'epics') {
                const epics = items as EpicDraft[];
                const result = await service.refineEpics(epics.map(draftToEpic), instructions);
                this.post({ type: 'refined', mode, epics: result.items.map(epicToDraft), stories: [], tokenUsage: result.usage });
            } else {
                const stories = items as StoryDraft[];
                const result = await service.refineStories(stories.map(draftToStory), instructions);
                this.post({ type: 'refined', mode, epics: [], stories: result.items.map(storyToDraft), tokenUsage: result.usage });
            }
        } catch (err) {
            this.post({ type: 'error', message: String(err) });
        }
    }

    // ─── Regenerate ───────────────────────────────────────────────────────────

    private async runRegenerate(): Promise<void> {
        const abort = new AbortController();
        // Store controller so a future dispose could cancel it; for now it runs to completion or error.
        try {
            const result = await this._opts.onRegenerate(abort.signal);
            this._opts.epics = result.epics;
            this._opts.stories = result.stories;
            this._opts.modelLabel = result.modelLabel;
            this._opts.tokenUsage = result.tokenUsage;
            await this.sendLoad();
        } catch (err) {
            const isAbort = err instanceof Error &&
                (err.name === 'AbortError' || err.message.includes('aborted'));
            if (!isAbort) {
                this.post({ type: 'error', message: String(err) });
            }
            // Silently swallow abort — panel stays open with previous content
        }
    }

    // ─── Save ─────────────────────────────────────────────────────────────────

    private async runSave(
        mode: ReviewMode,
        epicDrafts: EpicDraft[],
        storyDrafts: StoryDraft[],
    ): Promise<void> {
        const { workspaceRoot } = this._opts;
        const sagaRoot = getSagaRoot(workspaceRoot);

        try {
            if (mode === 'epics') {
                for (const d of epicDrafts) {
                    await writeEpic(sagaRoot, draftToEpic(d));
                }
                vscode.window.showInformationMessage(`Saved ${epicDrafts.length} epic(s) to .saga/epics/`);
            } else {
                for (const d of storyDrafts) {
                    await writeStory(sagaRoot, draftToStory(d));
                }
                vscode.window.showInformationMessage(`Saved ${storyDrafts.length} story(ies) to .saga/stories/`);
            }
            this.post({ type: 'saveAck' });
            this._panel.dispose();
        } catch (err) {
            this.post({ type: 'error', message: `Save failed: ${String(err)}` });
        }
    }

    private post(msg: ExtensionToWebview): void {
        this._panel.webview.postMessage(msg);
    }
}

// ─── Draft ↔ Domain converters ────────────────────────────────────────────────

function epicToDraft(e: Epic): EpicDraft {
    return {
        id: e.id,
        title: e.title,
        description: e.description ?? '',
        labels: e.labels,
    };
}

function draftToEpic(d: EpicDraft): Epic {
    return {
        id: d.id,
        type: 'epic',
        title: d.title,
        description: d.description || undefined,
        status: 'draft',
        labels: d.labels,
    };
}

function storyToDraft(s: Story): StoryDraft {
    return {
        id: s.id,
        title: s.title,
        epic: s.epic,
        as_a: s.as_a,
        i_want: s.i_want,
        so_that: s.so_that,
        description: s.description ?? '',
        acceptance_criteria: s.acceptance_criteria,
        estimate: s.estimate,
        labels: s.labels,
        invest: s.invest,
    };
}

function draftToStory(d: StoryDraft): Story {
    return {
        id: d.id,
        type: 'story',
        title: d.title,
        epic: d.epic,
        status: 'draft',
        as_a: d.as_a,
        i_want: d.i_want,
        so_that: d.so_that,
        description: d.description || undefined,
        acceptance_criteria: d.acceptance_criteria,
        estimate: d.estimate,
        labels: d.labels,
        invest: d.invest,
    };
}

