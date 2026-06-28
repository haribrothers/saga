import * as crypto from 'crypto';
import { Epic, Story } from '../schema';

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

function sha256(value: unknown): string {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(value))
        .digest('hex');
}
