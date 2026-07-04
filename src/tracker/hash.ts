import * as crypto from 'crypto';
import { Epic, Story, Subtask } from '../schema';
import { RemoteEpic, RemoteStory, RemoteSubtask } from './adapter';

/**
 * Compute a stable SHA-256 hash over the canonical fields of an epic or story.
 * Used to detect local drift (local_hash) and confirm sync (last_synced_hash).
 *
 * Only the fields that are pushed to the tracker are included — purely local
 * fields like status, remote, and local_hash itself are excluded so that
 * round-tripping through the tracker doesn't invalidate the hash.
 */
export function hashEpic(epic: Epic): string {
    const canonical = {
        id: epic.id,
        title: epic.title,
        description: epic.description ?? '',
        labels: [...(epic.labels ?? [])].sort(),
    };
    return sha256(canonical);
}

/**
 * Includes `subtasks`, unlike hashComparableStory()/hashRemoteStory(). NOT used
 * for anything that gets stored as `local_hash`/`remote.last_synced_hash` or
 * compared against a tracker — a subtask has no story-level remote equivalent
 * (it's pushed/compared as its own independent tracker item, see
 * hashComparableSubtask/hashRemoteSubtask), so a hash including it can never
 * match hashRemoteStory()'s output. Kept for any future purely-local "has
 * anything about this story changed at all" use case.
 */
export function hashStory(story: Story): string {
    const canonical = {
        id: story.id,
        title: story.title,
        epic: story.epic,
        as_a: story.as_a,
        i_want: story.i_want,
        so_that: story.so_that,
        description: story.description ?? '',
        acceptance_criteria: story.acceptance_criteria,
        estimate: story.estimate ?? null,
        labels: [...(story.labels ?? [])].sort(),
        subtasks: (story.subtasks ?? []).map((s) => ({ id: s.id, title: s.title, type: s.type, done: s.done })),
    };
    return sha256(canonical);
}

/**
 * Hash of only the story fields that round-trip through a tracker — i.e. the
 * same canonical set as hashRemoteStory(). Excludes `subtasks`, which have no
 * story-level equivalent on the remote (subtasks are pushed/compared as their
 * own tracker items via hashComparableSubtask/hashRemoteSubtask).
 *
 * This is the hash that must be stored as `local_hash` and `remote.last_synced_hash`
 * for tracker push/pull/sync — using hashStory() (which includes subtasks) there
 * would make local_hash and last_synced_hash structurally incomparable to
 * hashRemoteStory(), guaranteeing a false "changed" result on every sync pass
 * regardless of any real edit.
 */
export function hashComparableStory(story: Pick<Story,
    'id' | 'title' | 'epic' | 'as_a' | 'i_want' | 'so_that' | 'description' | 'acceptance_criteria' | 'estimate' | 'labels'
>): string {
    const canonical = {
        id: story.id,
        title: story.title,
        epic: story.epic,
        as_a: story.as_a,
        i_want: story.i_want,
        so_that: story.so_that,
        description: story.description ?? '',
        acceptance_criteria: story.acceptance_criteria,
        estimate: story.estimate ?? null,
        labels: [...(story.labels ?? [])].sort(),
    };
    return sha256(canonical);
}

export function hashSubtask(subtask: Subtask): string {
    const canonical = {
        id: subtask.id,
        title: subtask.title,
        type: subtask.type,
        done: subtask.done,
    };
    return sha256(canonical);
}

/**
 * Hash of only the subtask fields that round-trip through a tracker
 * (title, done — trackers have no concept of Saga's task/test/chore "type").
 * Used for subtask-level 3-way sync comparison; NOT the same as the hash
 * stored on the story's `subtasks[]` local_hash surface, which includes `type`.
 */
export function hashComparableSubtask(subtask: Pick<Subtask, 'id' | 'title' | 'done'>): string {
    const canonical = { id: subtask.id, title: subtask.title, done: subtask.done };
    return sha256(canonical);
}

/**
 * Hash a RemoteSubtask using the same canonical field set as hashComparableSubtask().
 */
export function hashRemoteSubtask(remote: RemoteSubtask, sagaId: string): string {
    const canonical = { id: sagaId, title: remote.title, done: remote.done };
    return sha256(canonical);
}

/**
 * Hash a RemoteEpic using the same canonical field set as hashEpic().
 * The `id` field is omitted because RemoteEpic uses tracker keys, not Saga IDs —
 * the caller must supply the Saga ID separately when building the comparison.
 * Passing `sagaId` here keeps the hash comparable to hashEpic() output.
 */
export function hashRemoteEpic(remote: RemoteEpic, sagaId: string): string {
    const canonical = {
        id: sagaId,
        title: remote.title,
        description: remote.description,
        labels: [...remote.labels].sort(),
    };
    return sha256(canonical);
}

/**
 * Hash a RemoteStory using the same canonical field set as hashComparableStory()
 * (NOT hashStory(), which additionally includes `subtasks` — a field with no
 * remote equivalent here). Always compare this against hashComparableStory()'s
 * output, never hashStory()'s, or every sync pass will show a false mismatch.
 * `sagaId` and `epicSagaId` must be provided since they're not present on the
 * remote object but are part of the canonical hash for local stories.
 */
export function hashRemoteStory(remote: RemoteStory, sagaId: string, epicSagaId: string): string {
    const canonical = {
        id: sagaId,
        title: remote.title,
        epic: epicSagaId,
        as_a: remote.as_a,
        i_want: remote.i_want,
        so_that: remote.so_that,
        description: remote.description,
        acceptance_criteria: remote.acceptance_criteria,
        estimate: remote.estimate ?? null,
        labels: [...remote.labels].sort(),
    };
    return sha256(canonical);
}

function sha256(value: unknown): string {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(value))
        .digest('hex');
}
