import * as vscode from 'vscode';
import { Epic, Story, StoryStatus } from '../schema';
import { listEpics, listStories } from '../saga-repo';

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
        this.description = `${epic.id} · ${storyCount} ${storyCount === 1 ? 'story' : 'stories'}`;
        this.tooltip = epic.description ?? epic.title;
        this.contextValue = 'sagaEpic';
        this.iconPath = new vscode.ThemeIcon('symbol-module');
    }
}

export class StoryTreeItem extends vscode.TreeItem {
    readonly kind = 'story' as const;

    constructor(readonly story: Story) {
        super(story.title, vscode.TreeItemCollapsibleState.None);
        this.id = story.id;
        this.description = `${story.id}  ${statusBadge(story.status)}`;
        this.tooltip = `${story.as_a} wants ${story.i_want}`;
        this.contextValue = 'sagaStory';
        this.iconPath = statusIcon(story.status);
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

function statusBadge(status: StoryStatus): string {
    const badges: Record<StoryStatus, string> = {
        draft: '[draft]',
        ready: '[ready]',
        synced: '[synced ✓]',
        'in-progress': '[in-progress]',
        done: '[done]',
    };
    return badges[status] ?? `[${status}]`;
}

function statusIcon(status: StoryStatus): vscode.ThemeIcon {
    switch (status) {
        case 'synced': return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
        case 'ready':  return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.blue'));
        case 'done':   return new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
        default:       return new vscode.ThemeIcon('circle-outline');
    }
}
