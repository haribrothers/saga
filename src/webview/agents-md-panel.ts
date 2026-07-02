import * as vscode from 'vscode';
import { TokenUsage } from '../llm/provider';
import { getWebviewHtml } from './html';

// ─── Message contract ─────────────────────────────────────────────────────────

export interface SerialTokenUsage {
    inputTokens: number;
    outputTokens: number;
    estimated?: boolean;
}

type ExtensionToWebview =
    | { type: 'load'; content: string; modelLabel: string; tokenUsage?: SerialTokenUsage; hasExisting: boolean }
    | { type: 'acceptAck' }
    | { type: 'error'; message: string };

type WebviewToExtension =
    | { type: 'ready' }
    | { type: 'accept'; content: string }
    | { type: 'regenerate' }
    | { type: 'discard' };

// ─── Panel options ────────────────────────────────────────────────────────────

export interface AgentsMdPanelOptions {
    content: string;
    modelLabel: string;
    tokenUsage?: TokenUsage;
    /** True if AGENTS.md already exists in workspace root (enables diff context). */
    hasExisting: boolean;
    extensionUri: vscode.Uri;
    /** Called when user accepts — writes AGENTS.md + lock. */
    onAccept: (content: string) => Promise<void>;
    /** Called when user clicks Regenerate — re-runs generation. */
    onRegenerate: (signal: AbortSignal) => Promise<{ content: string; modelLabel: string; tokenUsage?: TokenUsage }>;
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export class AgentsMdPanel {
    static readonly viewType = 'sagaAgentsMd';
    private static _panel: AgentsMdPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private _opts: AgentsMdPanelOptions;
    private _abortController: AbortController | undefined;

    static async open(opts: AgentsMdPanelOptions): Promise<void> {
        if (AgentsMdPanel._panel) {
            AgentsMdPanel._panel._opts = opts;
            AgentsMdPanel._panel._panel.reveal(vscode.ViewColumn.One);
            AgentsMdPanel._panel._load();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            AgentsMdPanel.viewType,
            'AGENTS.md — Review',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(opts.extensionUri, 'dist')],
            },
        );
        AgentsMdPanel._panel = new AgentsMdPanel(panel, opts);
    }

    private constructor(panel: vscode.WebviewPanel, opts: AgentsMdPanelOptions) {
        this._panel = panel;
        this._opts = opts;

        this._panel.webview.html = getWebviewHtml(this._panel.webview, opts.extensionUri, 'agents-md');

        this._panel.webview.onDidReceiveMessage(async (msg: WebviewToExtension) => {
            if (msg.type === 'ready') {
                this._load();
                return;
            }
            if (msg.type === 'accept') {
                try {
                    await this._opts.onAccept(msg.content);
                    void this._panel.webview.postMessage({ type: 'acceptAck' } satisfies ExtensionToWebview);
                    this._panel.dispose();
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    void this._panel.webview.postMessage({ type: 'error', message } satisfies ExtensionToWebview);
                }
                return;
            }
            if (msg.type === 'regenerate') {
                this._abortController?.abort();
                this._abortController = new AbortController();
                try {
                    const fresh = await this._opts.onRegenerate(this._abortController.signal);
                    this._opts = { ...this._opts, ...fresh };
                    this._load();
                } catch (err) {
                    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
                        return; // silently ignore cancellation
                    }
                    const message = err instanceof Error ? err.message : String(err);
                    void this._panel.webview.postMessage({ type: 'error', message } satisfies ExtensionToWebview);
                }
                return;
            }
            if (msg.type === 'discard') {
                this._panel.dispose();
                return;
            }
        });

        this._panel.onDidDispose(() => {
            this._abortController?.abort();
            AgentsMdPanel._panel = undefined;
        });
    }

    private _load(): void {
        const msg: ExtensionToWebview = {
            type: 'load',
            content: this._opts.content,
            modelLabel: this._opts.modelLabel,
            tokenUsage: this._opts.tokenUsage,
            hasExisting: this._opts.hasExisting,
        };
        void this._panel.webview.postMessage(msg);
    }
}
