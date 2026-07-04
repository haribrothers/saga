import { Epic, Story, Subtask } from '../schema';

// ─── Jira ─────────────────────────────────────────────────────────────────────

export interface JiraConfig {
    projectKey: string;
    email: string;
    epicIssueType: string;   // e.g. "Epic" — varies by project type
    storyIssueType: string;  // e.g. "Story" or "User Story"
    /** Issue type name for subtasks. e.g. "Sub-task" or "Subtask" — varies by project. */
    subtaskIssueType: string;
    /** Field ID used to store acceptance criteria. Defaults to description. */
    acFieldId: string;
    /**
     * How to link a story to its parent epic.
     * - "parent"  — Next-Gen / Team-Managed projects (Jira Cloud default since 2022)
     * - "customfield_10014" — Classic projects using the legacy Epic Link field
     */
    epicLinkStyle: 'parent' | 'customfield_10014';
    /**
     * Custom field ID for story points. When undefined, story points are omitted
     * from the push payload (avoids 400 on projects where the field isn't on the
     * create screen). Common values: "customfield_10016" (classic),
     * "customfield_10028" (next-gen story point estimate).
     */
    storyPointsFieldId?: string;
}

export interface JiraIssueFields {
    summary: string;
    description: {
        type: 'doc';
        version: number;
        content: { type: string; content?: { type: string; text: string }[] }[];
    };
    issuetype: { name: string };
    project: { key: string };
    labels?: string[];
    story_points?: number;
    // Parent link for Next-Gen projects
    parent?: { key: string };
    // Legacy Epic Link for classic projects
    customfield_10014?: string;
    // Acceptance criteria in a custom field (if not description)
    [key: string]: unknown;
}

function toAdf(markdown: string): JiraIssueFields['description'] {
    // Minimal Atlassian Document Format conversion — plain paragraphs only.
    // Full ADF rendering is a P1 enhancement; for v1 a code block preserves formatting.
    const lines = markdown.split('\n');
    const content: JiraIssueFields['description']['content'] = [];

    let buffer: string[] = [];
    const flush = () => {
        if (buffer.length > 0) {
            content.push({
                type: 'paragraph',
                content: [{ type: 'text', text: buffer.join('\n').trim() }],
            });
            buffer = [];
        }
    };

    for (const line of lines) {
        if (line.trim() === '') {
            flush();
        } else {
            buffer.push(line);
        }
    }
    flush();

    // Jira 400s on an empty doc — always include at least one paragraph node.
    if (content.length === 0) {
        content.push({ type: 'paragraph', content: [{ type: 'text', text: ' ' }] });
    }

    return { type: 'doc', version: 1, content };
}

function storyDescription(story: Story): string {
    const parts: string[] = [
        `As a ${story.as_a}`,
        `I want ${story.i_want}`,
        `So that ${story.so_that}`,
    ];
    if (story.description) {
        parts.push('', story.description);
    }
    return parts.join('\n');
}

function acceptanceCriteriaText(story: Story): string {
    return story.acceptance_criteria.join('\n\n');
}

export function toJiraEpicFields(epic: Epic, cfg: JiraConfig): JiraIssueFields {
    const fields: JiraIssueFields = {
        summary: epic.title,
        description: toAdf(epic.description ?? ''),
        issuetype: { name: cfg.epicIssueType },
        project: { key: cfg.projectKey },
    };
    // Only include labels when non-empty — Jira 400s on explicit undefined/null
    if (epic.labels.length > 0) {
        fields.labels = epic.labels;
    }
    return fields;
}

export function toJiraStoryFields(
    story: Story,
    cfg: JiraConfig,
    epicRemoteKey?: string,
    storyPointsFieldId?: string,
): JiraIssueFields {
    const descText = storyDescription(story);
    const acText = acceptanceCriteriaText(story);

    // When AC field == description, append AC to description block.
    const fullDesc = cfg.acFieldId === 'description'
        ? `${descText}\n\n---\n\n## Acceptance Criteria\n\n${acText}`
        : descText;

    const fields: JiraIssueFields = {
        summary: story.title,
        description: toAdf(fullDesc),
        issuetype: { name: cfg.storyIssueType },
        project: { key: cfg.projectKey },
    };

    // Only include labels when non-empty
    if (story.labels.length > 0) {
        fields.labels = story.labels;
    }

    // Story points — only included when a field ID is explicitly configured.
    // Omitting it avoids 400 errors on projects where the field isn't on the
    // create screen.
    if (story.estimate !== undefined && storyPointsFieldId) {
        fields[storyPointsFieldId] = story.estimate;
    }

    if (epicRemoteKey) {
        if (cfg.epicLinkStyle === 'parent') {
            fields.parent = { key: epicRemoteKey };
        } else {
            fields.customfield_10014 = epicRemoteKey;
        }
    }

    // Custom AC field (if configured)
    if (cfg.acFieldId !== 'description') {
        fields[cfg.acFieldId] = toAdf(acText);
    }

    return fields;
}

export function toJiraSubtaskFields(
    subtask: Subtask,
    cfg: JiraConfig,
    storyRemoteKey: string,
): JiraIssueFields {
    return {
        summary: subtask.title,
        description: toAdf(''),
        issuetype: { name: cfg.subtaskIssueType },
        project: { key: cfg.projectKey },
        parent: { key: storyRemoteKey },
    };
}

// ─── Azure DevOps ─────────────────────────────────────────────────────────────

export interface AdoConfig {
    project: string;
    areaPath?: string;
    epicWorkItemType: string;    // e.g. "Epic"
    storyWorkItemType: string;   // e.g. "User Story" or "Product Backlog Item" (Scrum)
    /** Work item type for subtasks. e.g. "Task" — standard across Agile/Scrum/CMMI. */
    subtaskWorkItemType: string;
    /** Field reference for acceptance criteria. Defaults to the standard field. */
    acFieldId: string;
    /**
     * Field reference for story points. When undefined, falls back to the standard
     * Microsoft.VSTS.Scheduling.StoryPoints field.
     */
    storyPointsFieldId?: string;
}

export interface AdoPatchOperation {
    op: 'add' | 'replace' | 'remove';
    path: string;
    value?: unknown;
}

function storyPointsPath(cfg: AdoConfig): string {
    return `/fields/${cfg.storyPointsFieldId ?? 'Microsoft.VSTS.Scheduling.StoryPoints'}`;
}

/**
 * Escape text destined for an ADO rich-text (HTML-typed) field. ADO's
 * System.Description / Microsoft.VSTS.Common.AcceptanceCriteria fields are
 * HTML, so unescaped `<`, `>`, `&` in Gherkin/user-story text (e.g.
 * "Given the count < 5") would either be misinterpreted as markup or
 * re-encoded unpredictably by ADO's server on save — either way producing
 * a permanent fetch-time mismatch against the original text. Escaping on
 * push and unescaping on fetch (see unescapeAdoHtml in ado.ts) keeps the
 * round trip exact regardless of what characters the content contains.
 */
export function escapeAdoHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function toAdoEpicPatch(epic: Epic, cfg: AdoConfig): AdoPatchOperation[] {
    const ops: AdoPatchOperation[] = [
        { op: 'add', path: '/fields/System.Title', value: epic.title },
        {
            op: 'add',
            path: '/fields/System.Description',
            value: escapeAdoHtml(epic.description ?? ''),
        },
    ];

    if (cfg.areaPath) {
        ops.push({ op: 'add', path: '/fields/System.AreaPath', value: cfg.areaPath });
    }

    if (epic.labels.length > 0) {
        ops.push({ op: 'add', path: '/fields/System.Tags', value: epic.labels.join('; ') });
    }

    return ops;
}

export function toAdoStoryPatch(
    story: Story,
    cfg: AdoConfig,
    orgUrl: string,
    epicWorkItemId?: number,
): AdoPatchOperation[] {
    const description = [
        `<p><strong>As a</strong> ${escapeAdoHtml(story.as_a)}</p>`,
        `<p><strong>I want</strong> ${escapeAdoHtml(story.i_want)}</p>`,
        `<p><strong>So that</strong> ${escapeAdoHtml(story.so_that)}</p>`,
        story.description ? `<p>${escapeAdoHtml(story.description)}</p>` : '',
    ].filter(Boolean).join('\n');

    const acHtml = story.acceptance_criteria
        .map((ac) => `<pre>${escapeAdoHtml(ac)}</pre>`)
        .join('\n');

    const ops: AdoPatchOperation[] = [
        { op: 'add', path: '/fields/System.Title', value: story.title },
        { op: 'add', path: '/fields/System.Description', value: description },
        {
            op: 'add',
            path: `/fields/${cfg.acFieldId}`,
            value: acHtml,
        },
    ];

    if (cfg.areaPath) {
        ops.push({ op: 'add', path: '/fields/System.AreaPath', value: cfg.areaPath });
    }

    if (story.estimate !== undefined) {
        ops.push({ op: 'add', path: storyPointsPath(cfg), value: story.estimate });
    }

    if (story.labels.length > 0) {
        ops.push({ op: 'add', path: '/fields/System.Tags', value: story.labels.join('; ') });
    }

    // Link to parent epic work item — ADO requires the full absolute URL here,
    // not a relative path (a relative url fails with 400 "requires the full url").
    if (epicWorkItemId !== undefined) {
        ops.push({
            op: 'add',
            path: '/relations/-',
            value: {
                rel: 'System.LinkTypes.Hierarchy-Reverse',
                url: `${orgUrl}/_apis/wit/workItems/${epicWorkItemId}`,
            },
        });
    }

    return ops;
}

export function toAdoSubtaskPatch(
    subtask: Subtask,
    cfg: AdoConfig,
    orgUrl: string,
    storyWorkItemId: number,
): AdoPatchOperation[] {
    const ops: AdoPatchOperation[] = [
        { op: 'add', path: '/fields/System.Title', value: subtask.title },
        // "Task" work items use Closed as the terminal state on all standard process templates.
        { op: 'add', path: '/fields/System.State', value: subtask.done ? 'Closed' : 'New' },
    ];

    if (cfg.areaPath) {
        ops.push({ op: 'add', path: '/fields/System.AreaPath', value: cfg.areaPath });
    }

    // ADO requires the full absolute URL here, not a relative path.
    ops.push({
        op: 'add',
        path: '/relations/-',
        value: {
            rel: 'System.LinkTypes.Hierarchy-Reverse',
            url: `${orgUrl}/_apis/wit/workItems/${storyWorkItemId}`,
        },
    });

    return ops;
}
