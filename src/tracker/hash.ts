import * as crypto from 'crypto';
import { Epic, Story } from '../schema';
import { RemoteEpic, RemoteStory } from './adapter';

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
    };
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
 * Hash a RemoteStory using the same canonical field set as hashStory().
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
