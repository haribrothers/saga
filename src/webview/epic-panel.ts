import * as vscode from 'vscode';
import { readEpic, writeEpic, listStories, getSagaRoot } from '../saga-repo';
import { Epic } from '../schema';
import { getWebviewHtml } from './html';

// Matches the message types in webview-ui/src/vscode-epic.ts
type ExtensionToWebview =
    | { type: 'load'; epic: EpicMsg; storyCount: number }
    | { type: 'saveAck' };

type WebviewToExtension =
    | { type: 'ready' }
    | { type: 'save'; epic: EpicMsg };

interface EpicMsg {
    id: string;
    title: string;
    status: string;
    description?: string;
    labels: string[];
    // Preserved opaquely so save never loses sync state
    remote?: Epic['remote'];
    local_hash?: string;
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export class EpicPanel {
    static readonly viewType = 'sagaEpicEditor';

    private static _panels = new Map<string, EpicPanel>();

    private readonly _panel: vscode.WebviewPanel;
    private _epicId: string;
    /** title/description at the time the panel last loaded from disk — used to detect story-impacting edits on save. */
    private _lastLoaded: { title: string; description?: string } | undefined;

    static async open(
        epicId: string,
        workspaceRoot: vscode.Uri,
        extensionUri: vscode.Uri,
    ): Promise<void> {
        const existing = EpicPanel._panels.get(epicId);
        if (existing) {
            existing._panel.reveal();
            await existing.reload();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            EpicPanel.viewType,
            `Epic: ${epicId}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')],
                retainContextWhenHidden: true,
            },
        );

        new EpicPanel(panel, epicId, workspaceRoot, extensionUri);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        epicId: string,
        private readonly workspaceRoot: vscode.Uri,
        private readonly extensionUri: vscode.Uri,
    ) {
        this._panel = panel;
        this._epicId = epicId;
        EpicPanel._panels.set(epicId, this);

        this._panel.webview.html = this.getHtml();
        this._panel.webview.onDidReceiveMessage((msg: WebviewToExtension) => this.handleMessage(msg));
        this._panel.onDidDispose(() => {
            EpicPanel._panels.delete(this._epicId);
        });
    }

    /** Re-reads the epic from disk and pushes a fresh `load` to the webview. */
    private async reload(): Promise<void> {
        const sagaRoot = getSagaRoot(this.workspaceRoot);
        const epic = await readEpic(sagaRoot, this._epicId);
        const stories = await listStories(sagaRoot, this._epicId);
        this._lastLoaded = { title: epic.title, description: epic.description };
        this.post({
            type: 'load',
            epic: epicToMsg(epic),
            storyCount: stories.length,
        });
    }

    private async handleMessage(msg: WebviewToExtension): Promise<void> {
        const sagaRoot = getSagaRoot(this.workspaceRoot);

        if (msg.type === 'ready') {
            await this.reload();
        }

        if (msg.type === 'save') {
            const epic = msgToEpic(msg.epic);
            await writeEpic(sagaRoot, epic);
            this.post({ type: 'saveAck' });
            this._panel.title = `Epic: ${epic.id} — ${epic.title}`;

            const storyImpacting =
                this._lastLoaded !== undefined &&
                (epic.title !== this._lastLoaded.title || epic.description !== this._lastLoaded.description);
            this._lastLoaded = { title: epic.title, description: epic.description };

            if (storyImpacting) {
                const stories = await listStories(sagaRoot, epic.id);
                if (stories.length > 0) {
                    const choice = await vscode.window.showInformationMessage(
                        `This epic's title/description changed. Existing stories under ${epic.id} may no longer match.`,
                        'Regenerate Stories',
                        'Not Now',
                    );
                    if (choice === 'Regenerate Stories') {
                        await vscode.commands.executeCommand('saga.generateStoriesForEpic', epic.id);
                    }
                }
            }
        }
    }

    private post(msg: ExtensionToWebview): void {
        this._panel.webview.postMessage(msg);
    }

    private getHtml(): string {
        return getWebviewHtml(this._panel.webview, this.extensionUri, 'epic');
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function epicToMsg(epic: Epic): EpicMsg {
    return {
        id: epic.id,
        title: epic.title,
        status: epic.status,
        description: epic.description,
        labels: epic.labels,
        remote: epic.remote,
        local_hash: epic.local_hash,
    };
}

function msgToEpic(msg: EpicMsg): Epic {
    return {
        id: msg.id,
        type: 'epic',
        title: msg.title,
        status: msg.status as Epic['status'],
        description: msg.description,
        labels: msg.labels,
        remote: msg.remote,
        local_hash: msg.local_hash,
    };
}
