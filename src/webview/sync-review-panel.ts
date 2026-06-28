import * as vscode from 'vscode';
import { Epic, Story, StorySchema, EpicSchema } from '../schema';
import { TrackerAdapter, RemoteEpic, RemoteStory } from '../tracker/adapter';
import {
    SyncPlan,
    EpicSyncState,
    StorySyncState,
} from '../tracker/sync-engine';
import { hashEpic, hashStory, hashRemoteEpic, hashRemoteStory } from '../tracker/hash';
import { setMapping } from '../tracker/sync-store';
import { writeEpic, writeStory, getSagaRoot } from '../saga-repo';
import { clearConflicts } from '../tracker/conflicts-store';
import { getWebviewHtml } from './html';
// ─── Message contract (mirrored in vscode-sync-review.ts on the webview side) ─

export interface LocalEpicView {
    id: string; title: string; description: string; labels: string[];
}

export interface LocalStoryView {
    id: string; title: string; epic: string;
    as_a: string; i_want: string; so_that: string;
    description: string; acceptance_criteria: string[];
    estimate?: number; labels: string[];
}

export interface RemoteEpicView {
    key: string; title: string; description: string; labels: string[]; url: string;
}

export interface RemoteStoryView {
    key: string; title: string;
    as_a: string; i_want: string; so_that: string;
    description: string; acceptance_criteria: string[];
    estimate?: number; labels: string[]; url: string;
}

export type EpicSyncStateView =
    | { kind: 'in-sync'; local: LocalEpicView }
    | { kind: 'local-only'; local: LocalEpicView }
    | { kind: 'remote-only'; local: LocalEpicView; remote: RemoteEpicView }
    | { kind: 'conflict'; local: LocalEpicView; remote: RemoteEpicView };

export type StorySyncStateView =
    | { kind: 'in-sync'; local: LocalStoryView }
    | { kind: 'local-only'; local: LocalStoryView }
    | { kind: 'remote-only'; local: LocalStoryView; remote: RemoteStoryView }
    | { kind: 'conflict'; local: LocalStoryView; remote: RemoteStoryView };

export interface SyncPlanView {
    epics: EpicSyncStateView[];
    stories: StorySyncStateView[];
    unpushedEpicIds: string[];
    unpushedStoryIds: string[];
    fetchErrors: Array<{ sagaId: string; error: string }>;
}

export type SyncExtensionToWebview =
    | { type: 'load'; plan: SyncPlanView; provider: 'jira' | 'ado' }
    | { type: 'applyAck'; applied: number; failed: Array<{ sagaId: string; error: string }> }
    | { type: 'error'; message: string };

export type SyncWebviewToExtension =
    | { type: 'ready' }
    | { type: 'apply'; epicResolutions: EpicResolutionView[]; storyResolutions: StoryResolutionView[] }
    | { type: 'cancel' };

export type EpicResolutionView =
    | { kind: 'push' | 'pull' | 'keep-local' | 'take-remote' | 'skip'; sagaId: string };

export type StoryResolutionView =
    | { kind: 'push' | 'pull' | 'keep-local' | 'take-remote' | 'skip'; sagaId: string };

// ─── Panel options ────────────────────────────────────────────────────────────

export interface SyncReviewOptions {
    plan: SyncPlan;
    adapter: TrackerAdapter;
    epicsMap: Map<string, Epic>;      // sagaId → Epic, for apply
    storiesMap: Map<string, Story>;   // sagaId → Story, for apply
    remoteEpicsMap: Map<string, RemoteEpic>;    // sagaId → RemoteEpic
    remoteStoriesMap: Map<string, RemoteStory>; // sagaId → RemoteStory
    workspaceRoot: vscode.Uri;
    extensionUri: vscode.Uri;
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export class SyncReviewPanel {
    static readonly viewType = 'sagaSyncReview';
    private static _instance: SyncReviewPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private _opts: SyncReviewOptions;

    static async open(opts: SyncReviewOptions): Promise<void> {
        if (SyncReviewPanel._instance) {
            SyncReviewPanel._instance._opts = opts;
            SyncReviewPanel._instance._panel.reveal();
            await SyncReviewPanel._instance.sendLoad();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            SyncReviewPanel.viewType,
            'Saga — Sync Review',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(opts.extensionUri, 'dist', 'webview')],
                retainContextWhenHidden: true,
            },
        );
        new SyncReviewPanel(panel, opts);
    }

    private constructor(panel: vscode.WebviewPanel, opts: SyncReviewOptions) {
        this._panel = panel;
        this._opts = opts;
        SyncReviewPanel._instance = this;

        this._panel.webview.html = getWebviewHtml(this._panel.webview, opts.extensionUri, 'sync-review');
        this._panel.webview.onDidReceiveMessage((msg: SyncWebviewToExtension) => this.handleMessage(msg));
        this._panel.onDidDispose(() => { SyncReviewPanel._instance = undefined; });
    }

    private async sendLoad(): Promise<void> {
        const view = serialisePlan(this._opts.plan);
        this.post({ type: 'load', plan: view, provider: this._opts.adapter.provider });
    }

    private async handleMessage(msg: SyncWebviewToExtension): Promise<void> {
        if (msg.type === 'ready') {
            await this.sendLoad();
            return;
        }
        if (msg.type === 'cancel') {
            this._panel.dispose();
            return;
        }
        if (msg.type === 'apply') {
            await this.runApply({ epics: msg.epicResolutions, stories: msg.storyResolutions });
        }
    }

    // ─── Apply ────────────────────────────────────────────────────────────────

    private async runApply(resolutions: { epics: EpicResolutionView[]; stories: StoryResolutionView[] }): Promise<void> {
        const { adapter, workspaceRoot, epicsMap, storiesMap, remoteEpicsMap, remoteStoriesMap } = this._opts;
        const sagaRoot = getSagaRoot(workspaceRoot);
        const provider = adapter.provider;
        let applied = 0;
        const failed: Array<{ sagaId: string; error: string }> = [];

        // ── Epic resolutions ──────────────────────────────────────────────────
        for (const res of resolutions.epics) {
            const { sagaId } = res;
            try {
                const local = epicsMap.get(sagaId);
                if (!local) { continue; }

                if (res.kind === 'push') {
                    const epicKey = local.remote?.provider === provider ? local.remote.key : undefined;
                    const result = await adapter.pushEpic(local);
                    const updated: Epic = {
                        ...local,
                        remote: result.remoteRef,
                        local_hash: hashEpic(local),
                    };
                    await writeEpic(sagaRoot, updated);
                    await setMapping(sagaRoot, sagaId, provider, {
                        key: result.remoteRef.key,
                        url: result.remoteRef.url,
                        last_synced_hash: result.syncedHash,
                        last_synced_at: new Date().toISOString(),
                    });
                    void epicKey; // used only as a type guard above
                    applied++;

                } else if (res.kind === 'pull' || res.kind === 'take-remote') {
                    const remote = remoteEpicsMap.get(sagaId);
                    if (!remote) { continue; }
                    const syncedAt = new Date().toISOString();
                    // Parse through the schema so Zod defaults are applied before hashing.
                    const parsedEpic = EpicSchema.parse({
                        ...local,
                        title: remote.title || local.title,
                        description: remote.description || local.description || undefined,
                        labels: remote.labels,
                        status: 'active',
                        local_hash: undefined,
                        remote: undefined,
                    });
                    const writtenHash = hashEpic(parsedEpic);
                    const updated: Epic = {
                        ...parsedEpic,
                        local_hash: writtenHash,
                        remote: {
                            provider,
                            key: remote.key,
                            url: remote.url,
                            last_synced_hash: writtenHash,
                            last_synced_at: syncedAt,
                        },
                    };
                    await writeEpic(sagaRoot, updated);
                    await setMapping(sagaRoot, sagaId, provider, {
                        key: remote.key,
                        url: remote.url,
                        last_synced_hash: writtenHash,
                        last_synced_at: syncedAt,
                    });
                    applied++;

                } else if (res.kind === 'keep-local') {
                    // Push local version to overwrite remote
                    const result = await adapter.pushEpic(local);
                    const updated: Epic = {
                        ...local,
                        remote: result.remoteRef,
                        local_hash: hashEpic(local),
                    };
                    await writeEpic(sagaRoot, updated);
                    await setMapping(sagaRoot, sagaId, provider, {
                        key: result.remoteRef.key,
                        url: result.remoteRef.url,
                        last_synced_hash: result.syncedHash,
                        last_synced_at: new Date().toISOString(),
                    });
                    applied++;
                }
                // 'skip' — do nothing
            } catch (err) {
                failed.push({ sagaId, error: String(err) });
            }
        }

        // ── Story resolutions ─────────────────────────────────────────────────
        for (const res of resolutions.stories) {
            const { sagaId } = res;
            try {
                const local = storiesMap.get(sagaId);
                if (!local) { continue; }

                if (res.kind === 'push') {
                    const epicRemoteKey = epicsMap.get(local.epic)?.remote?.provider === provider
                        ? epicsMap.get(local.epic)?.remote?.key
                        : undefined;
                    const result = await adapter.pushStory(local, epicRemoteKey);
                    const updated: Story = {
                        ...local,
                        remote: result.remoteRef,
                        local_hash: hashStory(local),
                    };
                    await writeStory(sagaRoot, updated);
                    await setMapping(sagaRoot, sagaId, provider, {
                        key: result.remoteRef.key,
                        url: result.remoteRef.url,
                        last_synced_hash: result.syncedHash,
                        last_synced_at: new Date().toISOString(),
                    });
                    applied++;

                } else if (res.kind === 'pull' || res.kind === 'take-remote') {
                    const remote = remoteStoriesMap.get(sagaId);
                    if (!remote) { continue; }
                    // AC round-trips through the tracker lossily (Jira ADF, ADO HTML).
                    // If the fetch returned no parseable AC, keep the local value so
                    // we never violate the schema's min-1 constraint.
                    const acceptance_criteria = remote.acceptance_criteria.length > 0
                        ? remote.acceptance_criteria
                        : local.acceptance_criteria;
                    const syncedAt = new Date().toISOString();
                    // Build the story content we'll write — remote wins on tracker-owned fields.
                    // Fall back to local values for fields the tracker can't reliably round-trip
                    // (as_a/i_want/so_that embedded in ADF description may parse as empty).
                    // Parse through the schema first — Zod may apply defaults (e.g.
                    // labels: []) and coercions that change the value. We must hash
                    // the post-parse object so local_hash matches what readStory()
                    // will return when the tree recomputes drift.
                    const parsed = StorySchema.parse({
                        ...local,
                        title: remote.title || local.title,
                        as_a: remote.as_a || local.as_a,
                        i_want: remote.i_want || local.i_want,
                        so_that: remote.so_that || local.so_that,
                        description: remote.description || local.description || undefined,
                        acceptance_criteria,
                        estimate: remote.estimate ?? local.estimate,
                        labels: remote.labels,
                        status: 'synced',
                        local_hash: undefined,  // exclude from hash computation
                        remote: undefined,       // exclude from hash computation
                    });
                    // Hash the canonical fields exactly as they'll be stored on disk.
                    const writtenHash = hashStory(parsed);
                    const updatedStory: Story = {
                        ...parsed,
                        local_hash: writtenHash,
                        // Preserve the remote key/provider so future pushes take the update path.
                        remote: {
                            provider,
                            key: remote.key,
                            url: remote.url,
                            last_synced_hash: writtenHash,
                            last_synced_at: syncedAt,
                        },
                    };
                    await writeStory(sagaRoot, updatedStory);
                    await setMapping(sagaRoot, sagaId, provider, {
                        key: remote.key,
                        url: remote.url,
                        last_synced_hash: writtenHash,
                        last_synced_at: syncedAt,
                    });
                    applied++;

                } else if (res.kind === 'keep-local') {
                    const epicRemoteKey = epicsMap.get(local.epic)?.remote?.provider === provider
                        ? epicsMap.get(local.epic)?.remote?.key
                        : undefined;
                    const result = await adapter.pushStory(local, epicRemoteKey);
                    const updated: Story = {
                        ...local,
                        remote: result.remoteRef,
                        local_hash: hashStory(local),
                    };
                    await writeStory(sagaRoot, updated);
                    await setMapping(sagaRoot, sagaId, provider, {
                        key: result.remoteRef.key,
                        url: result.remoteRef.url,
                        last_synced_hash: result.syncedHash,
                        last_synced_at: new Date().toISOString(),
                    });
                    applied++;
                }
                // 'skip' — do nothing
            } catch (err) {
                failed.push({ sagaId, error: String(err) });
            }
        }

        this.post({ type: 'applyAck', applied, failed });

        // Clear conflict markers now that all resolutions have been applied
        await clearConflicts(sagaRoot).catch(() => { /* best-effort */ });

        if (failed.length === 0) {
            this._panel.dispose();
            vscode.window.showInformationMessage(`Saga sync: ${applied} item(s) updated.`);
        } else {
            vscode.window.showWarningMessage(
                `Saga sync: ${applied} applied, ${failed.length} failed. See the panel for details.`,
            );
        }
    }

    private post(msg: SyncExtensionToWebview): void {
        this._panel.webview.postMessage(msg);
    }
}

// ─── Plan serialisation ───────────────────────────────────────────────────────

function serialisePlan(plan: SyncPlan): SyncPlanView {
    return {
        epics: plan.epics.map(serialiseEpicState),
        stories: plan.stories.map(serialiseStoryState),
        unpushedEpicIds: plan.unpushedEpicIds,
        unpushedStoryIds: plan.unpushedStoryIds,
        fetchErrors: plan.fetchErrors,
    };
}

function serialiseEpicState(s: EpicSyncState): EpicSyncStateView {
    const local = epicToView(s.local);
    if (s.kind === 'in-sync') { return { kind: 'in-sync', local }; }
    if (s.kind === 'local-only') { return { kind: 'local-only', local }; }
    const remote = remoteEpicToView(s.remote);
    if (s.kind === 'remote-only') { return { kind: 'remote-only', local, remote }; }
    return { kind: 'conflict', local, remote };
}

function serialiseStoryState(s: StorySyncState): StorySyncStateView {
    const local = storyToView(s.local);
    if (s.kind === 'in-sync') { return { kind: 'in-sync', local }; }
    if (s.kind === 'local-only') { return { kind: 'local-only', local }; }
    const remote = remoteStoryToView(s.remote);
    if (s.kind === 'remote-only') { return { kind: 'remote-only', local, remote }; }
    return { kind: 'conflict', local, remote };
}

function epicToView(e: Epic): LocalEpicView {
    return { id: e.id, title: e.title, description: e.description ?? '', labels: e.labels };
}

function storyToView(s: Story): LocalStoryView {
    return {
        id: s.id, title: s.title, epic: s.epic,
        as_a: s.as_a, i_want: s.i_want, so_that: s.so_that,
        description: s.description ?? '',
        acceptance_criteria: s.acceptance_criteria,
        estimate: s.estimate, labels: s.labels,
    };
}

function remoteEpicToView(r: RemoteEpic): RemoteEpicView {
    return { key: r.key, title: r.title, description: r.description, labels: r.labels, url: r.url };
}

function remoteStoryToView(r: RemoteStory): RemoteStoryView {
    return {
        key: r.key, title: r.title,
        as_a: r.as_a, i_want: r.i_want, so_that: r.so_that,
        description: r.description, acceptance_criteria: r.acceptance_criteria,
        estimate: r.estimate, labels: r.labels, url: r.url,
    };
}
