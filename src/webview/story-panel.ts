import * as vscode from 'vscode';
import { readStory, writeStory, listEpics, getSagaRoot } from '../saga-repo';
import { InvestValidator } from '../invest/validator';
import { Story, InvestResult } from '../schema';
import { LLMProvider } from '../llm/provider';
import { getWebviewHtml } from './html';

// Matches the message types in webview-ui/src/vscode.ts
type ExtensionToWebview =
    | { type: 'load'; story: StoryMsg; epics: EpicSummary[] }
    | { type: 'investResult'; invest: InvestResult }
    | { type: 'saveAck' };

type WebviewToExtension =
    | { type: 'ready' }
    | { type: 'save'; story: StoryMsg }
    | { type: 'validate' };

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
    invest?: InvestResult;
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
    ): Promise<void> {
        const existing = StoryPanel._panels.get(storyId);
        if (existing) {
            existing._panel.reveal();
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

        new StoryPanel(panel, storyId, workspaceRoot, extensionUri, provider);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        storyId: string,
        private readonly workspaceRoot: vscode.Uri,
        private readonly extensionUri: vscode.Uri,
        private readonly provider?: LLMProvider,
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

    private async handleMessage(msg: WebviewToExtension): Promise<void> {
        const sagaRoot = getSagaRoot(this.workspaceRoot);

        if (msg.type === 'ready') {
            const story = await readStory(sagaRoot, this._storyId);
            const epics = await listEpics(sagaRoot);
            this.post({
                type: 'load',
                story: storyToMsg(story),
                epics: epics.map((e) => ({ id: e.id, title: e.title })),
            });
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
    }

    private post(msg: ExtensionToWebview): void {
        this._panel.webview.postMessage(msg);
    }

    private getHtml(): string {
        return getWebviewHtml(this._panel.webview, this.extensionUri, 'story');
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
        invest: story.invest,
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
        invest: msg.invest,
    };
}
