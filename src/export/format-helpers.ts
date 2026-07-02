import { Epic, Story } from '../schema';

/** An epic with its child stories attached, for hierarchical export formats. */
export interface EpicWithStories {
    epic: Epic;
    stories: Story[];
}

// ─── Shared formatting helpers ─────────────────────────────────────────────────
// Pure — no vscode dependency, so the export-*.ts renderers stay unit-testable
// without the VS Code test harness.

const INVEST_KEYS = ['independent', 'negotiable', 'valuable', 'estimable', 'small', 'testable'] as const;

/** Renders a story's INVEST result as a compact inline badge string, e.g. "✓✓⚠✓✓✗". */
export function investBadgeString(story: Story): string {
    if (!story.invest) { return ''; }
    return INVEST_KEYS.map((k) => gradeIcon(story.invest![k].result)).join('');
}

/** Per-criterion INVEST lines, e.g. "Independent: ✓ pass — <reason>". */
export function investDetailLines(story: Story): string[] {
    if (!story.invest) { return []; }
    return INVEST_KEYS.map((k) => {
        const c = story.invest![k];
        const label = k.charAt(0).toUpperCase() + k.slice(1);
        return `${gradeIcon(c.result)} ${label}: ${c.result}${c.reason ? ` — ${c.reason}` : ''}`;
    });
}

export function gradeIcon(grade: 'pass' | 'warn' | 'fail'): string {
    return grade === 'pass' ? '✓' : grade === 'warn' ? '⚠' : '✗';
}

export function storyPointsLabel(story: Story): string {
    return story.estimate !== undefined ? String(story.estimate) : '—';
}
