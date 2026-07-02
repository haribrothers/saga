import { EpicWithStories, investBadgeString, investDetailLines, storyPointsLabel } from './format-helpers';

/**
 * Renders the backlog as a .docx buffer via the `docx` package.
 * Hierarchy: Epic (H1) → Story (H2) → Subtask (H3).
 * `docx` is dynamically imported by the caller to keep it off the
 * extension's synchronous activation path.
 */
export async function exportDocx(groups: EpicWithStories[]): Promise<Buffer> {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');

    const children: InstanceType<typeof Paragraph>[] = [
        new Paragraph({ text: 'Saga Backlog', heading: HeadingLevel.TITLE }),
    ];

    for (const { epic, stories } of groups) {
        children.push(new Paragraph({ text: `${epic.id}: ${epic.title}`, heading: HeadingLevel.HEADING_1 }));
        if (epic.description) {
            children.push(new Paragraph({ text: epic.description.trim() }));
        }
        const epicMetaParts: string[] = [`Status: ${epic.status}`];
        if (epic.labels.length > 0) { epicMetaParts.push(`Labels: ${epic.labels.join(', ')}`); }
        children.push(new Paragraph({ children: [new TextRun({ text: epicMetaParts.join('   ·   '), italics: true })] }));

        for (const story of stories) {
            children.push(new Paragraph({ text: `${story.id}: ${story.title}`, heading: HeadingLevel.HEADING_2 }));
            children.push(new Paragraph({
                text: `As a ${story.as_a}, I want ${story.i_want}, so that ${story.so_that}.`,
            }));

            if (story.description) {
                children.push(new Paragraph({ text: story.description.trim() }));
            }

            const badges = investBadgeString(story);
            const metaParts = [`Status: ${story.status}`, `Estimate: ${storyPointsLabel(story)}`];
            if (badges) { metaParts.push(`INVEST: ${badges}`); }
            if (story.labels.length > 0) { metaParts.push(`Labels: ${story.labels.join(', ')}`); }
            children.push(new Paragraph({ children: [new TextRun({ text: metaParts.join('   ·   '), italics: true })] }));

            const investLines = investDetailLines(story);
            for (const line of investLines) {
                children.push(new Paragraph({ text: line, bullet: { level: 0 } }));
            }

            children.push(new Paragraph({ children: [new TextRun({ text: 'Acceptance Criteria', bold: true })] }));
            for (const ac of story.acceptance_criteria) {
                for (const acLine of ac.trim().split('\n')) {
                    children.push(new Paragraph({
                        children: [new TextRun({ text: acLine, font: 'Courier New' })],
                    }));
                }
            }

            for (const sub of story.subtasks) {
                children.push(new Paragraph({ text: `${sub.id}: ${sub.title}`, heading: HeadingLevel.HEADING_3 }));
                children.push(new Paragraph({
                    children: [new TextRun({ text: `Type: ${sub.type}   ·   Done: ${sub.done ? 'Yes' : 'No'}`, italics: true })],
                }));
            }
        }
    }

    const doc = new Document({ sections: [{ children }] });
    return Packer.toBuffer(doc);
}
