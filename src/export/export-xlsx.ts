import { EpicWithStories, investBadgeString, storyPointsLabel } from './format-helpers';

/**
 * Renders the backlog as an .xlsx buffer via the `exceljs` package.
 * Flat one-row-per-story layout (Excel doesn't suit nested hierarchy well) —
 * epic fields are repeated on every row so the sheet can be filtered/pivoted
 * per epic. `exceljs` is dynamically imported by the caller to keep it off
 * the extension's synchronous activation path.
 */
export async function exportXlsx(groups: EpicWithStories[]): Promise<Buffer> {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Backlog');

    sheet.columns = [
        { header: 'EpicID', key: 'epicId', width: 12 },
        { header: 'Epic Title', key: 'epicTitle', width: 30 },
        { header: 'Epic Status', key: 'epicStatus', width: 12 },
        { header: 'StoryID', key: 'storyId', width: 12 },
        { header: 'Story Title', key: 'storyTitle', width: 30 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'As A', key: 'asA', width: 20 },
        { header: 'I Want', key: 'iWant', width: 30 },
        { header: 'So That', key: 'soThat', width: 30 },
        { header: 'Estimate', key: 'estimate', width: 10 },
        { header: 'INVEST', key: 'invest', width: 10 },
        { header: 'Labels', key: 'labels', width: 20 },
        { header: 'SubtaskCount', key: 'subtaskCount', width: 12 },
        { header: 'Subtasks Done', key: 'subtasksDone', width: 12 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const { epic, stories } of groups) {
        if (stories.length === 0) {
            sheet.addRow({
                epicId: epic.id,
                epicTitle: epic.title,
                epicStatus: epic.status,
            });
            continue;
        }
        for (const story of stories) {
            sheet.addRow({
                epicId: epic.id,
                epicTitle: epic.title,
                epicStatus: epic.status,
                storyId: story.id,
                storyTitle: story.title,
                status: story.status,
                asA: story.as_a,
                iWant: story.i_want,
                soThat: story.so_that,
                estimate: storyPointsLabel(story),
                invest: investBadgeString(story),
                labels: story.labels.join(', '),
                subtaskCount: story.subtasks.length,
                subtasksDone: story.subtasks.filter((s) => s.done).length,
            });
        }
    }

    sheet.autoFilter = { from: 'A1', to: `N${sheet.rowCount}` };

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
}
