import { Epic, Story, Subtask } from '../schema';
import { TrackerAdapter, RemoteEpic, RemoteStory, RemoteSubtask } from './adapter';
import { RemoteMapping, readMappings } from './sync-store';
import { hashEpic, hashStory, hashComparableSubtask, hashRemoteEpic, hashRemoteStory, hashRemoteSubtask } from './hash';
import * as vscode from 'vscode';

// ─── Sync state classification ────────────────────────────────────────────────

export type EpicSyncState =
    | { kind: 'in-sync'; local: Epic }
    | { kind: 'local-only'; local: Epic }          // local changed, needs push
    | { kind: 'remote-only'; local: Epic; remote: RemoteEpic }  // remote changed, needs pull
    | { kind: 'conflict'; local: Epic; remote: RemoteEpic; mapping: RemoteMapping };

export type StorySyncState =
    | { kind: 'in-sync'; local: Story }
    | { kind: 'local-only'; local: Story }
    | { kind: 'remote-only'; local: Story; remote: RemoteStory }
    | { kind: 'conflict'; local: Story; remote: RemoteStory; mapping: RemoteMapping };

/** `syncId` is `${storyId}:${subtask.id}` — subtask IDs are only unique within a story. */
export type SubtaskSyncState =
    | { kind: 'in-sync'; syncId: string; storyId: string; local: Subtask }
    | { kind: 'local-only'; syncId: string; storyId: string; local: Subtask }
    | { kind: 'remote-only'; syncId: string; storyId: string; local: Subtask; remote: RemoteSubtask }
    | { kind: 'conflict'; syncId: string; storyId: string; local: Subtask; remote: RemoteSubtask; mapping: RemoteMapping };

// ─── Sync plan ────────────────────────────────────────────────────────────────

export interface SyncPlan {
    epics: EpicSyncState[];
    stories: StorySyncState[];
    subtasks: SubtaskSyncState[];
    /** Items that have no remote key and have never been pushed — excluded from sync. */
    unpushedEpicIds: string[];
    unpushedStoryIds: string[];
    unpushedSubtaskIds: string[];
    /** Items that failed to fetch from the remote (network/auth errors). */
    fetchErrors: Array<{ sagaId: string; error: string }>;
}

// ─── Resolution types (from the UI) ──────────────────────────────────────────

export type EpicResolution =
    | { kind: 'push'; sagaId: string }
    | { kind: 'pull'; sagaId: string }
    | { kind: 'keep-local'; sagaId: string }
    | { kind: 'take-remote'; sagaId: string }
    | { kind: 'skip'; sagaId: string };

export type StoryResolution =
    | { kind: 'push'; sagaId: string }
    | { kind: 'pull'; sagaId: string }
    | { kind: 'keep-local'; sagaId: string }
    | { kind: 'take-remote'; sagaId: string }
    | { kind: 'skip'; sagaId: string };

/** sagaId here is the syncId (`${storyId}:${subtaskId}`). */
export type SubtaskResolution =
    | { kind: 'push'; sagaId: string }
    | { kind: 'pull'; sagaId: string }
    | { kind: 'keep-local'; sagaId: string }
    | { kind: 'take-remote'; sagaId: string }
    | { kind: 'skip'; sagaId: string };

export interface SyncResolutions {
    epics: EpicResolution[];
    stories: StoryResolution[];
    subtasks: SubtaskResolution[];
}

// ─── Apply result ─────────────────────────────────────────────────────────────

export interface ApplyResult {
    applied: number;
    failed: Array<{ sagaId: string; error: string }>;
}

// ─── Plan builder ─────────────────────────────────────────────────────────────

/**
 * Fetch remote state for all pushed epics and stories and classify each into
 * a SyncState. Items that have never been pushed (no remote.key) are collected
 * into unpushedEpicIds / unpushedStoryIds.
 *
 * Fetch failures are collected into fetchErrors rather than aborting the entire
 * plan — a 404 or auth error on one item shouldn't block reviewing the rest.
 */
export async function buildSyncPlan(
    adapter: TrackerAdapter,
    sagaRoot: vscode.Uri,
    epics: Epic[],
    stories: Story[],
): Promise<SyncPlan> {
    const provider = adapter.provider;
    const mappings = await readMappings(sagaRoot);

    const plan: SyncPlan = {
        epics: [],
        stories: [],
        subtasks: [],
        unpushedEpicIds: [],
        unpushedStoryIds: [],
        unpushedSubtaskIds: [],
        fetchErrors: [],
    };

    // ── Epics ─────────────────────────────────────────────────────────────────
    await Promise.all(epics.map(async (epic) => {
        const remoteKey = epic.remote?.provider === provider ? epic.remote.key : undefined;
        if (!remoteKey) {
            plan.unpushedEpicIds.push(epic.id);
            return;
        }

        const mapping = mappings[epic.id]?.[provider];
        let remote: RemoteEpic;
        try {
            remote = await adapter.fetchEpic(remoteKey);
        } catch (err) {
            plan.fetchErrors.push({ sagaId: epic.id, error: String(err) });
            return;
        }

        plan.epics.push(classifyEpic(epic, remote, mapping));
    }));

    // ── Stories ───────────────────────────────────────────────────────────────
    await Promise.all(stories.map(async (story) => {
        const remoteKey = story.remote?.provider === provider ? story.remote.key : undefined;
        if (!remoteKey) {
            plan.unpushedStoryIds.push(story.id);
            return;
        }

        const mapping = mappings[story.id]?.[provider];
        let remote: RemoteStory;
        try {
            remote = await adapter.fetchStory(remoteKey);
        } catch (err) {
            plan.fetchErrors.push({ sagaId: story.id, error: String(err) });
            return;
        }

        plan.stories.push(classifyStory(story, remote, mapping));
    }));

    // ── Subtasks (nested under each story) ──────────────────────────────────────
    const subtaskJobs = stories.flatMap((story) =>
        story.subtasks.map((subtask) => ({ story, subtask })),
    );
    await Promise.all(subtaskJobs.map(async ({ story, subtask }) => {
        const syncId = `${story.id}:${subtask.id}`;
        const remoteKey = subtask.remote?.provider === provider ? subtask.remote.key : undefined;
        if (!remoteKey) {
            plan.unpushedSubtaskIds.push(syncId);
            return;
        }

        const mapping = mappings[syncId]?.[provider];
        let remote: RemoteSubtask;
        try {
            remote = await adapter.fetchSubtask(remoteKey);
        } catch (err) {
            plan.fetchErrors.push({ sagaId: syncId, error: String(err) });
            return;
        }

        plan.subtasks.push(classifySubtask(story.id, subtask, remote, mapping));
    }));

    // Sort results for deterministic rendering: epics and stories in SAGA-ID order
    plan.epics.sort((a, b) => a.local.id.localeCompare(b.local.id));
    plan.stories.sort((a, b) => a.local.id.localeCompare(b.local.id));
    plan.subtasks.sort((a, b) => a.syncId.localeCompare(b.syncId));

    return plan;
}

// ─── Classification ───────────────────────────────────────────────────────────

function classifyEpic(
    local: Epic,
    remote: RemoteEpic,
    mapping: RemoteMapping | undefined,
): EpicSyncState {
    const localHash = local.local_hash ?? hashEpic(local);
    const remoteHash = hashRemoteEpic(remote, local.id);
    const baseHash = mapping?.last_synced_hash ?? local.remote?.last_synced_hash;

    const localChanged = baseHash !== undefined && localHash !== baseHash;
    const remoteChanged = baseHash !== undefined && remoteHash !== baseHash;

    if (localChanged && remoteChanged) {
        if (!mapping) {
            // No mapping means we have no reliable base — treat as conflict
            return { kind: 'conflict', local, remote, mapping: makeFallbackMapping(local.remote!) };
        }
        return { kind: 'conflict', local, remote, mapping };
    }
    if (localChanged) { return { kind: 'local-only', local }; }
    if (remoteChanged) { return { kind: 'remote-only', local, remote }; }
    return { kind: 'in-sync', local };
}

function classifyStory(
    local: Story,
    remote: RemoteStory,
    mapping: RemoteMapping | undefined,
): StorySyncState {
    const localHash = local.local_hash ?? hashStory(local);
    const remoteHash = hashRemoteStory(remote, local.id, local.epic);
    const baseHash = mapping?.last_synced_hash ?? local.remote?.last_synced_hash;

    const localChanged = baseHash !== undefined && localHash !== baseHash;
    const remoteChanged = baseHash !== undefined && remoteHash !== baseHash;

    if (localChanged && remoteChanged) {
        if (!mapping) {
            return { kind: 'conflict', local, remote, mapping: makeFallbackMapping(local.remote!) };
        }
        return { kind: 'conflict', local, remote, mapping };
    }
    if (localChanged) { return { kind: 'local-only', local }; }
    if (remoteChanged) { return { kind: 'remote-only', local, remote }; }
    return { kind: 'in-sync', local };
}

function classifySubtask(
    storyId: string,
    local: Subtask,
    remote: RemoteSubtask,
    mapping: RemoteMapping | undefined,
): SubtaskSyncState {
    const syncId = `${storyId}:${local.id}`;
    const localHash = hashComparableSubtask(local);
    const remoteHash = hashRemoteSubtask(remote, local.id);
    const baseHash = mapping?.last_synced_hash ?? local.remote?.last_synced_hash;

    const localChanged = baseHash !== undefined && localHash !== baseHash;
    const remoteChanged = baseHash !== undefined && remoteHash !== baseHash;

    if (localChanged && remoteChanged) {
        if (!mapping) {
            return { kind: 'conflict', syncId, storyId, local, remote, mapping: makeFallbackMapping(local.remote!) };
        }
        return { kind: 'conflict', syncId, storyId, local, remote, mapping };
    }
    if (localChanged) { return { kind: 'local-only', syncId, storyId, local }; }
    if (remoteChanged) { return { kind: 'remote-only', syncId, storyId, local, remote }; }
    return { kind: 'in-sync', syncId, storyId, local };
}

function makeFallbackMapping(remote: NonNullable<Epic['remote'] | Story['remote'] | Subtask['remote']>): RemoteMapping {
    return {
        key: remote.key,
        url: remote.url,
        last_synced_hash: remote.last_synced_hash ?? '',
        last_synced_at: remote.last_synced_at ?? new Date().toISOString(),
    };
}

// ─── Summary helpers (used by the UI) ────────────────────────────────────────

export function countByKind(plan: SyncPlan): {
    inSync: number;
    localOnly: number;
    remoteOnly: number;
    conflicts: number;
    unpushed: number;
    errors: number;
} {
    const all = [...plan.epics, ...plan.stories, ...plan.subtasks];
    return {
        inSync: all.filter((s) => s.kind === 'in-sync').length,
        localOnly: all.filter((s) => s.kind === 'local-only').length,
        remoteOnly: all.filter((s) => s.kind === 'remote-only').length,
        conflicts: all.filter((s) => s.kind === 'conflict').length,
        unpushed: plan.unpushedEpicIds.length + plan.unpushedStoryIds.length + plan.unpushedSubtaskIds.length,
        errors: plan.fetchErrors.length,
    };
}
