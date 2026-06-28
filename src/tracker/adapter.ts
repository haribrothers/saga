import { Epic, Story, RemoteRef } from '../schema';

// ─── Push result ──────────────────────────────────────────────────────────────

export interface PushResult {
    remoteRef: RemoteRef;
    /** Canonical hash of the fields that were pushed — stored as last_synced_hash. */
    syncedHash: string;
}

// ─── Connection test ──────────────────────────────────────────────────────────

export interface ConnectionTestResult {
    ok: boolean;
    message: string;
}

// ─── Remote item shapes (returned by fetch methods) ───────────────────────────

/**
 * Normalised remote representation of an epic fetched from the tracker.
 * Field names match the canonical fields used by hashEpic() so that
 * hashRemoteEpic() produces a comparable hash for drift detection.
 */
export interface RemoteEpic {
    key: string;
    title: string;
    description: string;
    labels: string[];
    url: string;
}

/**
 * Normalised remote representation of a story fetched from the tracker.
 * Field names match the canonical fields used by hashStory() so that
 * hashRemoteStory() produces a comparable hash for drift detection.
 */
export interface RemoteStory {
    key: string;
    title: string;
    as_a: string;
    i_want: string;
    so_that: string;
    description: string;
    acceptance_criteria: string[];
    estimate?: number;
    labels: string[];
    url: string;
}

// ─── Tracker adapter interface ────────────────────────────────────────────────

/**
 * Provider-agnostic interface for pushing epics and stories to a remote tracker.
 * Implementations: JiraAdapter, AdoAdapter.
 *
 * pushEpic / pushStory:
 *   - If the item has no remote.key → CREATE a new issue/work-item.
 *   - If the item already has remote.key → UPDATE the existing one.
 * Both return a PushResult with the populated RemoteRef and the hash
 * of what was pushed (to be stored as last_synced_hash).
 *
 * fetchEpic / fetchStory:
 *   - Fetch the current remote state of a single item by its tracker key.
 *   - Returns a normalised RemoteEpic / RemoteStory for sync comparison.
 *   - Throws TrackerError if the item no longer exists (404) or is inaccessible.
 */
export interface TrackerAdapter {
    readonly provider: 'jira' | 'ado';

    /** Verify credentials and connectivity. Safe to call without any stories. */
    testConnection(): Promise<ConnectionTestResult>;

    /**
     * Push an epic. Returns the RemoteRef to store on the epic.
     * @param epic The epic to push.
     */
    pushEpic(epic: Epic): Promise<PushResult>;

    /**
     * Push a story. Returns the RemoteRef to store on the story.
     * @param story The story to push.
     * @param epicRemoteKey The tracker-native key of the parent epic (e.g. "PROJ-10"),
     *   used to set the parent link on the issue/work-item. Optional — if missing the
     *   story is created without a parent link.
     */
    pushStory(story: Story, epicRemoteKey?: string): Promise<PushResult>;

    /**
     * Delete an epic from the remote tracker by its remote key.
     * Throws TrackerError if the delete fails (e.g. 403 Forbidden).
     * The caller decides whether to proceed with local deletion after a failure.
     */
    deleteEpic(epic: Epic): Promise<void>;

    /**
     * Delete a story from the remote tracker by its remote key.
     * Throws TrackerError if the delete fails (e.g. 403 Forbidden).
     * The caller decides whether to proceed with local deletion after a failure.
     */
    deleteStory(story: Story): Promise<void>;

    /**
     * Fetch the current remote state of an epic by its tracker key.
     * Used during sync to detect remote-side changes.
     * Throws TrackerError if not found (404) or inaccessible.
     */
    fetchEpic(remoteKey: string): Promise<RemoteEpic>;

    /**
     * Fetch the current remote state of a story by its tracker key.
     * Used during sync to detect remote-side changes.
     * Throws TrackerError if not found (404) or inaccessible.
     */
    fetchStory(remoteKey: string): Promise<RemoteStory>;
}

// ─── Tracker error ────────────────────────────────────────────────────────────

export class TrackerError extends Error {
    constructor(
        message: string,
        public readonly statusCode?: number,
        public readonly body?: string,
    ) {
        super(message);
        this.name = 'TrackerError';
    }
}
