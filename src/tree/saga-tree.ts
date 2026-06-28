import * as vscode from 'vscode';
import { Epic, Story, StoryStatus } from '../schema';
import { listEpics, listStories } from '../saga-repo';
import { hashEpic, hashStory } from '../tracker/hash';

// ─── Tree item types ──────────────────────────────────────────────────────────

export type SagaTreeNode = EpicTreeItem | StoryTreeItem;

export class EpicTreeItem extends vscode.TreeItem {
    readonly kind = 'epic' as const;

    constructor(
        readonly epic: Epic,
        storyCount: number,
    ) {
        super(epic.title, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = epic.id;

        const syncBadge = epicSyncBadge(epic);
        const storyLabel = `${storyCount} ${storyCount === 1 ? 'story' : 'stories'}`;
        this.description = syncBadge
            ? `${epic.id} · ${storyLabel}  ${syncBadge}`
            : `${epic.id} · ${storyLabel}`;
        this.tooltip = epic.description ?? epic.title;
        this.contextValue = 'sagaEpic';
        this.iconPath = epicIcon(epic);
    }
}

export class StoryTreeItem extends vscode.TreeItem {
    readonly kind = 'story' as const;

    constructor(readonly story: Story) {
        super(story.title, vscode.TreeItemCollapsibleState.None);
        this.id = story.id;

        const effectiveStatus = storyEffectiveStatus(story);
        this.description = `${story.id}  ${statusBadge(effectiveStatus)}`;
        this.tooltip = `${story.as_a} wants ${story.i_want}`;
        this.contextValue = 'sagaStory';
        this.iconPath = statusIcon(effectiveStatus);
        this.command = {
            command: 'saga.openStory',
            title: 'Open Story',
            arguments: [story.id],
        };
    }
}

// ─── Tree data provider ───────────────────────────────────────────────────────

export class SagaTreeProvider implements vscode.TreeDataProvider<SagaTreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<SagaTreeNode | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private watcher?: vscode.FileSystemWatcher;

    constructor(private readonly sagaRoot: vscode.Uri) {
        this.startWatcher();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SagaTreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: SagaTreeNode): Promise<SagaTreeNode[]> {
        if (!element) {
            // Root: list all epics
            const epics = await listEpics(this.sagaRoot);
            const nodes: EpicTreeItem[] = [];
            for (const epic of epics) {
                const stories = await listStories(this.sagaRoot, epic.id);
                nodes.push(new EpicTreeItem(epic, stories.length));
            }
            return nodes;
        }

        if (element.kind === 'epic') {
            const stories = await listStories(this.sagaRoot, element.epic.id);
            return stories.map((s) => new StoryTreeItem(s));
        }

        return [];
    }

    dispose(): void {
        this.watcher?.dispose();
        this._onDidChangeTreeData.dispose();
    }

    private startWatcher(): void {
        const pattern = new vscode.RelativePattern(this.sagaRoot, '{epics,stories}/*.yaml');
        this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
        this.watcher.onDidChange(() => this.refresh());
        this.watcher.onDidCreate(() => this.refresh());
        this.watcher.onDidDelete(() => this.refresh());
    }
}

// ─── Context file tree ────────────────────────────────────────────────────────

export class ContextFileItem extends vscode.TreeItem {
    readonly kind = 'contextFile' as const;

    constructor(
        readonly filename: string,
        readonly role: string,
    ) {
        super(filename, vscode.TreeItemCollapsibleState.None);
        this.description = `[${role}]`;
        this.iconPath = new vscode.ThemeIcon('file-text');
        this.contextValue = 'sagaContextFile';
        this.tooltip = `Role: ${role}`;
    }
}

import { readContextRegistry } from '../saga-repo';

export class ContextTreeProvider implements vscode.TreeDataProvider<ContextFileItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ContextFileItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private watcher?: vscode.FileSystemWatcher;

    constructor(private readonly sagaRoot: vscode.Uri) {
        this.startWatcher();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ContextFileItem): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<ContextFileItem[]> {
        const registry = await readContextRegistry(this.sagaRoot);
        return registry.entries.map((e) => new ContextFileItem(e.filename, e.role));
    }

    dispose(): void {
        this.watcher?.dispose();
        this._onDidChangeTreeData.dispose();
    }

    private startWatcher(): void {
        const pattern = new vscode.RelativePattern(this.sagaRoot, 'context/context-registry.yaml');
        this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
        this.watcher.onDidChange(() => this.refresh());
        this.watcher.onDidCreate(() => this.refresh());
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Computes the effective display status for a story, accounting for local drift.
 * A story with a remote key whose local content has changed since last sync is
 * shown as "drifted" rather than "synced", even if story.status === 'synced'.
 */
function storyEffectiveStatus(story: Story): StoryStatus | 'drifted' {
    if (story.status === 'synced' && story.remote?.last_synced_hash) {
        const currentHash = hashStory(story);
        if (currentHash !== story.remote.last_synced_hash) {
            return 'drifted';
        }
    }
    return story.status;
}

function statusBadge(status: StoryStatus | 'drifted'): string {
    const badges: Record<StoryStatus | 'drifted', string> = {
        draft: '[draft]',
        ready: '[ready]',
        synced: '[synced ✓]',
        drifted: '[drifted ●]',
        'in-progress': '[in-progress]',
        done: '[done]',
    };
    return badges[status] ?? `[${status}]`;
}

function statusIcon(status: StoryStatus | 'drifted'): vscode.ThemeIcon {
    switch (status) {
        case 'synced':  return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
        case 'drifted': return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.yellow'));
        case 'ready':   return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.blue'));
        case 'done':    return new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
        default:        return new vscode.ThemeIcon('circle-outline');
    }
}

/** Badge shown next to an epic's description when it has been pushed. */
function epicSyncBadge(epic: Epic): string | undefined {
    if (!epic.remote?.key) { return undefined; }
    const currentHash = hashEpic(epic);
    const isDrifted = epic.remote.last_synced_hash && currentHash !== epic.remote.last_synced_hash;
    return isDrifted ? `[drifted ●]` : `[${epic.remote.key} ✓]`;
}

function epicIcon(epic: Epic): vscode.ThemeIcon {
    if (!epic.remote?.key) { return new vscode.ThemeIcon('symbol-module'); }
    const currentHash = hashEpic(epic);
    const isDrifted = epic.remote.last_synced_hash && currentHash !== epic.remote.last_synced_hash;
    return isDrifted
        ? new vscode.ThemeIcon('symbol-module', new vscode.ThemeColor('charts.yellow'))
        : new vscode.ThemeIcon('symbol-module', new vscode.ThemeColor('charts.green'));
}
