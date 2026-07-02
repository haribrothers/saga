import { EpicWithStories, investBadgeString, investDetailLines, storyPointsLabel } from './format-helpers';

/**
 * Renders the backlog as a single markdown document.
 * Hierarchy: Epic (H1) → Story (H2) → Subtask (H3).
 */
export function exportMarkdown(groups: EpicWithStories[]): string {
    const lines: string[] = ['# Saga Backlog', ''];

    for (const { epic, stories } of groups) {
        lines.push(`# ${epic.id}: ${epic.title}`, '');
        if (epic.description) {
            lines.push(epic.description.trim(), '');
        }
        if (epic.labels.length > 0) {
            lines.push(`**Labels:** ${epic.labels.join(', ')}`, '');
        }
        lines.push(`**Status:** ${epic.status}`, '');

        for (const story of stories) {
            lines.push(`## ${story.id}: ${story.title}`, '');
            lines.push(`As a ${story.as_a}, I want ${story.i_want}, so that ${story.so_that}.`, '');

            if (story.description) {
                lines.push(story.description.trim(), '');
            }

            const badges = investBadgeString(story);
            const meta: string[] = [`**Status:** ${story.status}`, `**Estimate:** ${storyPointsLabel(story)}`];
            if (badges) { meta.push(`**INVEST:** ${badges}`); }
            lines.push(meta.join('  ·  '), '');

            if (story.labels.length > 0) {
                lines.push(`**Labels:** ${story.labels.join(', ')}`, '');
            }

            const investLines = investDetailLines(story);
            if (investLines.length > 0) {
                lines.push('**INVEST detail:**', ...investLines.map((l) => `- ${l}`), '');
            }

            lines.push('**Acceptance Criteria:**', '');
            for (const ac of story.acceptance_criteria) {
                lines.push('```gherkin', ac.trim(), '```', '');
            }

            if (story.subtasks.length > 0) {
                for (const sub of story.subtasks) {
                    lines.push(`### ${sub.id}: ${sub.title}`, '');
                    lines.push(`Type: ${sub.type}  ·  Done: ${sub.done ? '✓' : '✗'}`, '');
                }
            }
        }
    }

    return lines.join('\n').trimEnd() + '\n';
}
