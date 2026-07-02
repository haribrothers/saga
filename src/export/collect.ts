import * as vscode from 'vscode';
import { listEpics, listStories, getSagaRoot } from '../saga-repo';
import { Story } from '../schema';
import { EpicWithStories } from './format-helpers';

export type { EpicWithStories } from './format-helpers';
export { investBadgeString, investDetailLines, gradeIcon, storyPointsLabel } from './format-helpers';

/**
 * Reads all epics and stories from disk and groups stories under their
 * parent epic, sorted by ID. Stories whose epic no longer exists are
 * dropped silently — they'd be orphaned in the UI too.
 */
export async function collectBacklog(workspaceRoot: vscode.Uri): Promise<EpicWithStories[]> {
    const sagaRoot = getSagaRoot(workspaceRoot);
    const [epics, stories] = await Promise.all([
        listEpics(sagaRoot),
        listStories(sagaRoot),
    ]);

    const sortedEpics = [...epics].sort((a, b) => a.id.localeCompare(b.id));
    const storiesByEpic = new Map<string, Story[]>();
    for (const story of stories) {
        const list = storiesByEpic.get(story.epic) ?? [];
        list.push(story);
        storiesByEpic.set(story.epic, list);
    }
    for (const list of storiesByEpic.values()) {
        list.sort((a, b) => a.id.localeCompare(b.id));
    }

    return sortedEpics.map((epic) => ({
        epic,
        stories: storiesByEpic.get(epic.id) ?? [],
    }));
}
