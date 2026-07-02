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
    savedUri: vscode.Uri;
    extensionUri: vscode.Uri;
    /** Called when the user clicks Save — persists the (possibly edited) content. */
    onSave: (content: string) => Promise<void>;
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export class AgentPromptPanel {
    static readonly viewType = 'sagaAgentPrompt';
    private static _panel: AgentPromptPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private _opts: AgentPromptPanelOptions;
    private _currentContent: string;

    static async open(opts: AgentPromptPanelOptions): Promise<void> {
        if (AgentPromptPanel._panel) {
            AgentPromptPanel._panel._opts = opts;
            AgentPromptPanel._panel._currentContent = opts.content;
            AgentPromptPanel._panel._panel.reveal(vscode.ViewColumn.One);
            AgentPromptPanel._panel._load();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            AgentPromptPanel.viewType,
            `Agent Prompt — ${opts.story.id}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(opts.extensionUri, 'dist')],
            },
        );

        AgentPromptPanel._panel = new AgentPromptPanel(panel, opts);
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
            AgentPromptPanel._panel = undefined;
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

    /** Update the in-memory content (called from the webview when user edits). */
    updateContent(content: string): void {
        this._currentContent = content;
    }
}
