import * as vscode from 'vscode';
import { getSagaRoot, readConfig, readContextRegistry, listEpics } from '../saga-repo';
import { getWebviewHtml } from './html';

// ─── Message contract ─────────────────────────────────────────────────────────

export interface GettingStartedState {
    hasProvider: boolean;
    hasContext: boolean;
    hasEpic: boolean;
}

type ExtensionToWebview =
    | { type: 'load'; state: GettingStartedState };

type WebviewToExtension =
    | { type: 'ready' }
    | { type: 'runStep'; step: 'provider' | 'context' | 'epic' }
    | { type: 'skip' }
    | { type: 'finish' };

// ─── Panel ────────────────────────────────────────────────────────────────────

export class GettingStartedPanel {
    static readonly viewType = 'sagaGettingStarted';
    private static _panel: GettingStartedPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;

    static async open(workspaceRoot: vscode.Uri, extensionUri: vscode.Uri): Promise<void> {
        if (GettingStartedPanel._panel) {
            GettingStartedPanel._panel._panel.reveal(vscode.ViewColumn.One);
            await GettingStartedPanel._panel.sendLoad();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            GettingStartedPanel.viewType,
            'Saga — Getting Started',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')],
            },
        );
        GettingStartedPanel._panel = new GettingStartedPanel(panel, workspaceRoot, extensionUri);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly workspaceRoot: vscode.Uri,
        private readonly extensionUri: vscode.Uri,
    ) {
        this._panel = panel;
        this._panel.webview.html = getWebviewHtml(this._panel.webview, extensionUri, 'getting-started');
        this._panel.webview.onDidReceiveMessage((msg: WebviewToExtension) => this.handleMessage(msg));
        // Refresh state whenever the panel regains focus — covers the case where
        // a step's command (e.g. Settings) was completed in another panel/dialog.
        this._panel.onDidChangeViewState(() => { void this.sendLoad(); });
        this._panel.onDidDispose(() => { GettingStartedPanel._panel = undefined; });
    }

    private async handleMessage(msg: WebviewToExtension): Promise<void> {
        if (msg.type === 'ready') {
            await this.sendLoad();
        }

        if (msg.type === 'runStep') {
            const commandByStep = {
                provider: 'saga.openSettings',
                context: 'saga.addContextFile',
                epic: 'saga.generateEpics',
            } as const;
            await vscode.commands.executeCommand(commandByStep[msg.step]);
            await this.sendLoad();
        }

        if (msg.type === 'skip' || msg.type === 'finish') {
            this._panel.dispose();
        }
    }

    private async sendLoad(): Promise<void> {
        const state = await this.computeState();
        this.post({ type: 'load', state });
    }

    private async computeState(): Promise<GettingStartedState> {
        const sagaRoot = getSagaRoot(this.workspaceRoot);

        let hasProvider = false;
        try {
            const config = await readConfig(sagaRoot);
            const providers = config.ai.providers;
            hasProvider = Object.values(providers).some((p) => p?.enabled);
        } catch { /* config missing/malformed — treat as no provider */ }

        let hasContext = false;
        try {
            const registry = await readContextRegistry(sagaRoot);
            hasContext = registry.entries.length > 0;
        } catch { /* ignore */ }

        let hasEpic = false;
        try {
            const epics = await listEpics(sagaRoot);
            hasEpic = epics.length > 0;
        } catch { /* ignore */ }

        return { hasProvider, hasContext, hasEpic };
    }

    private post(msg: ExtensionToWebview): void {
        this._panel.webview.postMessage(msg);
    }
}
