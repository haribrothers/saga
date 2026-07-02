import * as vscode from 'vscode';
import { Story } from '../schema';
import { TokenUsage } from '../llm/provider';
import { getWebviewHtml } from './html';

// ─── Message contract ─────────────────────────────────────────────────────────

export interface SerialTokenUsage {
    inputTokens: number;
    outputTokens: number;
    estimated?: boolean;
}

type ExtensionToWebview =
    | { type: 'load'; storyId: string; storyTitle: string; content: string; modelLabel: string; tokenUsage?: SerialTokenUsage }
    | { type: 'error'; message: string };

type WebviewToExtension =
    | { type: 'ready' }
    | { type: 'save' }
    | { type: 'copy' };

// ─── Panel options ────────────────────────────────────────────────────────────

export interface AgentPromptPanelOptions {
    story: Story;
    content: string;
    modelLabel: string;
    tokenUsage?: TokenUsage;
    extensionUri: vscode.Uri;
    /** Called when the user clicks Save — persists the (possibly edited) content. */
    onSave: (content: string) => Promise<void>;
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export class AgentPromptPanel {
    static readonly viewType = 'sagaAgentPrompt';

    // One panel per story ID — lets the user have multiple open simultaneously.
    private static _panels = new Map<string, AgentPromptPanel>();

    private readonly _panel: vscode.WebviewPanel;
    private _opts: AgentPromptPanelOptions;
    private _currentContent: string;

    static async open(opts: AgentPromptPanelOptions): Promise<void> {
        const storyId = opts.story.id;
        const existing = AgentPromptPanel._panels.get(storyId);
        if (existing) {
            // Same story — refresh content and bring to front.
            existing._opts = opts;
            existing._currentContent = opts.content;
            existing._panel.reveal(vscode.ViewColumn.Beside);
            existing._load();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            AgentPromptPanel.viewType,
            `Agent Prompt — ${storyId}`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(opts.extensionUri, 'dist')],
            },
        );

        AgentPromptPanel._panels.set(storyId, new AgentPromptPanel(panel, opts));
    }

    private constructor(panel: vscode.WebviewPanel, opts: AgentPromptPanelOptions) {
        this._panel = panel;
        this._opts = opts;
        this._currentContent = opts.content;

        this._panel.webview.html = getWebviewHtml(this._panel.webview, opts.extensionUri, 'agent-prompt');

        this._panel.webview.onDidReceiveMessage(async (msg: WebviewToExtension) => {
            if (msg.type === 'ready') {
                this._load();
                return;
            }
            if (msg.type === 'save') {
                await this._opts.onSave(this._currentContent);
                vscode.window.showInformationMessage(`Agent prompt saved to .saga/prompts/${this._opts.story.id}.prompt.md`);
                return;
            }
            if (msg.type === 'copy') {
                await vscode.env.clipboard.writeText(this._currentContent);
                vscode.window.showInformationMessage('Agent prompt copied to clipboard.');
                return;
            }
        });

        this._panel.onDidDispose(() => {
            AgentPromptPanel._panels.delete(this._opts.story.id);
        });
    }

    private _load(): void {
        const opts = this._opts;
        const msg: ExtensionToWebview = {
            type: 'load',
            storyId: opts.story.id,
            storyTitle: opts.story.title,
            content: this._currentContent,
            modelLabel: opts.modelLabel,
            tokenUsage: opts.tokenUsage,
        };
        void this._panel.webview.postMessage(msg);
    }

}
