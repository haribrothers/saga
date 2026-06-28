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
