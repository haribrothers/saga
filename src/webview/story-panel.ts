import * as vscode from 'vscode';
import { readStory, writeStory, listEpics, getSagaRoot, nextSubtaskId } from '../saga-repo';
import { InvestValidator } from '../invest/validator';
import { generateSubtasks } from '../generation/subtasks';
import { resolveProviderFromConfig } from '../llm/routing';
import { Story, InvestResult, Subtask } from '../schema';
import { LLMProvider } from '../llm/provider';
import { SecretsManager } from '../secrets';
import { getWebviewHtml } from './html';

// Matches the message types in webview-ui/src/vscode.ts
type ExtensionToWebview =
    | { type: 'load'; story: StoryMsg; epics: EpicSummary[] }
    | { type: 'investResult'; invest: InvestResult }
    | { type: 'saveAck' }
    | { type: 'generatingSubtasks' }
    | { type: 'subtasksGenerated'; subtasks: Subtask[] };

type WebviewToExtension =
    | { type: 'ready' }
    | { type: 'save'; story: StoryMsg }
    | { type: 'validate' }
    | { type: 'generateSubtasks' }
    | { type: 'splitStory' };

interface StoryMsg {
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
    subtasks: Subtask[];
    invest?: InvestResult;
    // Preserved opaquely so save never loses sync state
    remote?: Story['remote'];
    local_hash?: string;
}

interface EpicSummary {
    id: string;
    title: string;
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export class StoryPanel {
    static readonly viewType = 'sagaStoryEditor';

    private static _panels = new Map<string, StoryPanel>();

    private readonly _panel: vscode.WebviewPanel;
    private _storyId: string;

    static async open(
        storyId: string,
        workspaceRoot: vscode.Uri,
        extensionUri: vscode.Uri,
        provider?: LLMProvider,
        secrets?: SecretsManager,
    ): Promise<void> {
        const existing = StoryPanel._panels.get(storyId);
        if (existing) {
            existing._panel.reveal();
            // Re-fetch from disk — the story may have changed since the panel was
            // opened (e.g. subtasks generated via the tree/command-palette flow).
            await existing.reload();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            StoryPanel.viewType,
            `Story: ${storyId}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')],
                retainContextWhenHidden: true,
            },
        );

        new StoryPanel(panel, storyId, workspaceRoot, extensionUri, provider, secrets);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        storyId: string,
        private readonly workspaceRoot: vscode.Uri,
        private readonly extensionUri: vscode.Uri,
        private readonly provider?: LLMProvider,
        private readonly secrets?: SecretsManager,
    ) {
        this._panel = panel;
        this._storyId = storyId;
        StoryPanel._panels.set(storyId, this);

        this._panel.webview.html = this.getHtml();
        this._panel.webview.onDidReceiveMessage((msg: WebviewToExtension) => this.handleMessage(msg));
        this._panel.onDidDispose(() => {
            StoryPanel._panels.delete(this._storyId);
        });
    }

    /** Re-reads the story from disk and pushes a fresh `load` to the webview. */
    private async reload(): Promise<void> {
        const sagaRoot = getSagaRoot(this.workspaceRoot);
        const story = await readStory(sagaRoot, this._storyId);
        const epics = await listEpics(sagaRoot);
        this.post({
            type: 'load',
            story: storyToMsg(story),
            epics: epics.map((e) => ({ id: e.id, title: e.title })),
        });
    }

    private async handleMessage(msg: WebviewToExtension): Promise<void> {
        const sagaRoot = getSagaRoot(this.workspaceRoot);

        if (msg.type === 'ready') {
            await this.reload();
        }

        if (msg.type === 'save') {
            const sagaRoot = getSagaRoot(this.workspaceRoot);
            const story = msgToStory(msg.story);
            await writeStory(sagaRoot, story);
            this.post({ type: 'saveAck' });
            this._panel.title = `Story: ${story.id} — ${story.title}`;
        }

        if (msg.type === 'validate') {
            const sagaRoot = getSagaRoot(this.workspaceRoot);
            const story = await readStory(sagaRoot, this._storyId);
            const validator = new InvestValidator(this.provider);
            const invest = await validator.validate(story);
            this.post({ type: 'investResult', invest });
            // Also persist the invest result back to the YAML
            await writeStory(sagaRoot, { ...story, invest });
        }

        if (msg.type === 'generateSubtasks') {
            this.post({ type: 'generatingSubtasks' });
            const sagaRoot = getSagaRoot(this.workspaceRoot);
            const story = await readStory(sagaRoot, this._storyId);

            const resolved = await resolveProviderFromConfig('subtask_generation', this.workspaceRoot, this.secrets);
            if (!resolved) {
                vscode.window.showErrorMessage('Saga: No AI provider available. Check Settings.');
                this.post({ type: 'subtasksGenerated', subtasks: story.subtasks });
                return;
            }

            let result: Awaited<ReturnType<typeof generateSubtasks>> | undefined;
            let cancelled = false;
            let failure: unknown;

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Saga: Proposing subtasks for ${this._storyId} via ${resolved.modelLabel}…`,
                    cancellable: true,
                },
                async (_progress, token) => {
                    const abort = new AbortController();
                    token.onCancellationRequested(() => abort.abort());
                    try {
                        result = await generateSubtasks(resolved.provider, story, abort.signal);
                        // The underlying provider may not interrupt an in-flight request on
                        // cancellation (best-effort only) — re-check after the await resolves
                        // so a late cancel still discards the result instead of writing it.
                        if (abort.signal.aborted) { cancelled = true; result = undefined; }
                    } catch (err) {
                        if (isAbortError(err) || abort.signal.aborted) { cancelled = true; }
                        else { failure = err; }
                    }
                },
            );

            if (cancelled) {
                vscode.window.showInformationMessage('Saga: Subtask generation cancelled.');
                this.post({ type: 'subtasksGenerated', subtasks: story.subtasks });
                return;
            }
            if (failure || !result) {
                vscode.window.showErrorMessage(`Saga: Subtask generation failed — ${failure instanceof Error ? failure.message : String(failure)}`);
                this.post({ type: 'subtasksGenerated', subtasks: story.subtasks });
                return;
            }

            const updated: Story = { ...story, subtasks: [...story.subtasks] };
            for (const proposed of result.items) {
                const id = nextSubtaskId(updated);
                updated.subtasks.push({ id, title: proposed.title, type: proposed.type, done: false });
            }
            await writeStory(sagaRoot, updated);
            this.post({ type: 'subtasksGenerated', subtasks: updated.subtasks });
        }

        if (msg.type === 'splitStory') {
            // Delegate to the saga.splitStory command so the panel reuses the exact
            // same INVEST re-check, progress UX, and save-gated original-deletion flow.
            await vscode.commands.executeCommand('saga.splitStory', this._storyId);
        }
    }

    private post(msg: ExtensionToWebview): void {
        this._panel.webview.postMessage(msg);
    }

    private getHtml(): string {
        return getWebviewHtml(this._panel.webview, this.extensionUri, 'story');
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isAbortError(err: unknown): boolean {
    return (
        err instanceof Error &&
        (err.name === 'AbortError' || err.message.includes('aborted') || err.message.includes('Cancelled'))
    );
}

function storyToMsg(story: Story): StoryMsg {
    return {
        id: story.id,
        title: story.title,
        epic: story.epic,
        status: story.status,
        as_a: story.as_a,
        i_want: story.i_want,
        so_that: story.so_that,
        description: story.description,
        acceptance_criteria: story.acceptance_criteria,
        estimate: story.estimate,
        labels: story.labels,
        subtasks: story.subtasks,
        invest: story.invest,
        remote: story.remote,
        local_hash: story.local_hash,
    };
}

function msgToStory(msg: StoryMsg): Story {
    return {
        id: msg.id,
        type: 'story',
        title: msg.title,
        epic: msg.epic,
        status: msg.status as Story['status'],
        as_a: msg.as_a,
        i_want: msg.i_want,
        so_that: msg.so_that,
        description: msg.description,
        acceptance_criteria: msg.acceptance_criteria,
        estimate: msg.estimate,
        labels: msg.labels,
        subtasks: msg.subtasks,
        invest: msg.invest,
        remote: msg.remote,
        local_hash: msg.local_hash,
    };
}
