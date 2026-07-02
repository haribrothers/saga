import { Epic, Story, Subtask } from '../schema';
import { TrackerAdapter, PushResult, ConnectionTestResult, TrackerError, RemoteEpic, RemoteStory, RemoteSubtask } from './adapter';
import { hashEpic, hashStory, hashComparableSubtask } from './hash';
import {
    JiraConfig,
    toJiraEpicFields,
    toJiraStoryFields,
    toJiraSubtaskFields,
    JiraIssueFields,
} from './field-mapping';

// ─── Story-points field ───────────────────────────────────────────────────────
// Story points field IDs vary by Jira project configuration and are not on the
// create screen by default. We skip the field unless the user explicitly sets
// story_points_field_id in their config. Common values:
//   customfield_10016 — "Story Points" on classic boards
//   customfield_10028 — "Story point estimate" on next-gen / team-managed
// Leave undefined to omit the field entirely and avoid 400 errors.
const STORY_POINTS_FIELD: string | undefined = undefined;

// ─── JiraAdapter ─────────────────────────────────────────────────────────────

export interface JiraAdapterOptions {
    baseUrl: string;   // e.g. "https://myorg.atlassian.net"
    email: string;
    apiToken: string;  // from SecretStorage
    config: JiraConfig;
}

export class JiraAdapter implements TrackerAdapter {
    readonly provider = 'jira' as const;

    private readonly baseUrl: string;
    private readonly authHeader: string;
    private readonly cfg: JiraConfig;

    constructor(opts: JiraAdapterOptions) {
        // Normalise: strip trailing slash
        this.baseUrl = opts.baseUrl.replace(/\/$/, '');
        this.authHeader = 'Basic ' + Buffer.from(`${opts.email}:${opts.apiToken}`).toString('base64');
        this.cfg = opts.config;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    async testConnection(): Promise<ConnectionTestResult> {
        try {
            const data = await this.get<{ displayName?: string; emailAddress?: string }>('/rest/api/3/myself');
            const name = data.displayName ?? data.emailAddress ?? 'unknown';
            return { ok: true, message: `Connected as ${name}` };
        } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : String(err) };
        }
    }

    async pushEpic(epic: Epic): Promise<PushResult> {
        const fields = toJiraEpicFields(epic, this.cfg);
        const hash = hashEpic(epic);

        let key: string;
        let url: string;

        if (epic.remote?.provider === 'jira' && epic.remote.key) {
            // Update existing
            await this.updateIssue(epic.remote.key, fields);
            key = epic.remote.key;
            url = this.browseUrl(key);
        } else {
            // Create new
            const created = await this.createIssue(fields);
            key = created.key;
            url = this.browseUrl(key);
        }

        return {
            remoteRef: {
                provider: 'jira',
                key,
                url,
                last_synced_hash: hash,
                last_synced_at: new Date().toISOString(),
            },
            syncedHash: hash,
        };
    }

    async pushStory(story: Story, epicRemoteKey?: string): Promise<PushResult> {
        // Only pass the story-points field ID when configured — omitting it avoids
        // 400 errors on projects where the field isn't on the create screen.
        const spField = this.cfg.storyPointsFieldId ?? STORY_POINTS_FIELD;
        const fields = toJiraStoryFields(story, this.cfg, epicRemoteKey, spField);
        const hash = hashStory(story);

        let key: string;
        let url: string;

        if (story.remote?.provider === 'jira' && story.remote.key) {
            await this.updateIssue(story.remote.key, fields);
            key = story.remote.key;
            url = this.browseUrl(key);
        } else {
            const created = await this.createIssue(fields);
            key = created.key;
            url = this.browseUrl(key);
        }

        return {
            remoteRef: {
                provider: 'jira',
                key,
                url,
                last_synced_hash: hash,
                last_synced_at: new Date().toISOString(),
            },
            syncedHash: hash,
        };
    }

    async pushSubtask(subtask: Subtask, storyRemoteKey: string): Promise<PushResult> {
        const fields = toJiraSubtaskFields(subtask, this.cfg, storyRemoteKey);
        // Use the tracker-comparable hash (excludes `type`, which trackers don't
        // model) so it's directly comparable to hashRemoteSubtask() during sync.
        const hash = hashComparableSubtask(subtask);

        let key: string;
        let url: string;

        if (subtask.remote?.provider === 'jira' && subtask.remote.key) {
            await this.updateIssue(subtask.remote.key, fields);
            key = subtask.remote.key;
            url = this.browseUrl(key);
        } else {
            const created = await this.createIssue(fields);
            key = created.key;
            url = this.browseUrl(key);
        }

        return {
            remoteRef: {
                provider: 'jira',
                key,
                url,
                last_synced_hash: hash,
                last_synced_at: new Date().toISOString(),
            },
            syncedHash: hash,
        };
    }

    async deleteEpic(epic: Epic): Promise<void> {
        if (epic.remote?.provider !== 'jira' || !epic.remote.key) {
            throw new TrackerError('Epic has no Jira remote key — nothing to delete.');
        }
        await this.deleteIssue(epic.remote.key);
    }

    async deleteStory(story: Story): Promise<void> {
        if (story.remote?.provider !== 'jira' || !story.remote.key) {
            throw new TrackerError('Story has no Jira remote key — nothing to delete.');
        }
        await this.deleteIssue(story.remote.key);
    }

    async fetchEpic(remoteKey: string): Promise<RemoteEpic> {
        const issue = await this.get<JiraIssueResponse>(`/rest/api/3/issue/${remoteKey}?fields=summary,description,labels`);
        return {
            key: remoteKey,
            title: issue.fields.summary,
            description: adfToText(issue.fields.description),
            labels: issue.fields.labels ?? [],
            url: this.browseUrl(remoteKey),
        };
    }

    async fetchStory(remoteKey: string): Promise<RemoteStory> {
        // Fetch all fields we care about in one request. The AC field may be
        // in the description or a custom field — we always read description and
        // any configured custom AC field.
        const fields = ['summary', 'description', 'labels', 'story_points',
            this.cfg.acFieldId !== 'description' ? this.cfg.acFieldId : null,
            this.cfg.storyPointsFieldId ?? null,
        ].filter(Boolean).join(',');

        const issue = await this.get<JiraIssueResponse>(`/rest/api/3/issue/${remoteKey}?fields=${fields}`);

        const rawDesc = adfToText(issue.fields.description);
        const { as_a, i_want, so_that, description } = parseUserStoryText(rawDesc);

        // Acceptance criteria: either from a custom field or embedded in description
        let acText: string;
        if (this.cfg.acFieldId !== 'description' && issue.fields[this.cfg.acFieldId]) {
            acText = adfToText(issue.fields[this.cfg.acFieldId] as AdfDoc | null);
        } else {
            // AC is appended to description after the "## Acceptance Criteria" header
            acText = extractAcFromDescription(rawDesc);
        }
        const acceptance_criteria = parseGherkinScenarios(acText);

        // Story points: read from the configured custom field if present
        const spField = this.cfg.storyPointsFieldId;
        const estimate = spField && issue.fields[spField] !== null && issue.fields[spField] !== undefined
            ? Number(issue.fields[spField])
            : undefined;

        return {
            key: remoteKey,
            title: issue.fields.summary,
            as_a,
            i_want,
            so_that,
            description,
            acceptance_criteria,
            estimate: Number.isFinite(estimate) ? estimate : undefined,
            labels: issue.fields.labels ?? [],
            url: this.browseUrl(remoteKey),
        };
    }

    async fetchSubtask(remoteKey: string): Promise<RemoteSubtask> {
        const issue = await this.get<JiraSubtaskIssueResponse>(
            `/rest/api/3/issue/${remoteKey}?fields=summary,status`,
        );
        return {
            key: remoteKey,
            title: issue.fields.summary,
            done: issue.fields.status?.statusCategory?.key === 'done',
            url: this.browseUrl(remoteKey),
        };
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private browseUrl(key: string): string {
        return `${this.baseUrl}/browse/${key}`;
    }

    private async createIssue(fields: JiraIssueFields): Promise<{ id: string; key: string }> {
        return this.post<{ id: string; key: string }>('/rest/api/3/issue', { fields });
    }

    private async updateIssue(key: string, fields: JiraIssueFields): Promise<void> {
        await this.put(`/rest/api/3/issue/${key}`, { fields });
    }

    private async deleteIssue(key: string): Promise<void> {
        await this.delete(`/rest/api/3/issue/${key}`);
    }

    // ── HTTP primitives ───────────────────────────────────────────────────────

    private async get<T>(path: string): Promise<T> {
        const res = await fetch(`${this.baseUrl}${path}`, {
            method: 'GET',
            headers: this.headers(),
        });
        await this.assertOk(res, 'GET', path);
        return res.json() as Promise<T>;
    }

    private async post<T>(path: string, body: unknown): Promise<T> {
        const res = await fetch(`${this.baseUrl}${path}`, {
            method: 'POST',
            headers: this.headers('application/json'),
            body: JSON.stringify(body),
        });
        await this.assertOk(res, 'POST', path);
        return res.json() as Promise<T>;
    }

    private async put(path: string, body: unknown): Promise<void> {
        const res = await fetch(`${this.baseUrl}${path}`, {
            method: 'PUT',
            headers: this.headers('application/json'),
            body: JSON.stringify(body),
        });
        await this.assertOk(res, 'PUT', path);
    }

    private async delete(path: string): Promise<void> {
        const res = await fetch(`${this.baseUrl}${path}`, {
            method: 'DELETE',
            headers: this.headers(),
        });
        // 204 No Content is the success response for Jira deletes
        if (res.status === 204 || res.ok) { return; }
        let body = '';
        try { body = await res.text(); } catch { /* ignore */ }
        const detail = body ? ` — ${body}` : '';
        throw new TrackerError(
            `Jira DELETE ${path} failed: ${res.status} ${res.statusText}${detail}`,
            res.status,
            body,
        );
    }

    private headers(contentType?: string): Record<string, string> {
        const h: Record<string, string> = {
            'Authorization': this.authHeader,
            'Accept': 'application/json',
        };
        if (contentType) { h['Content-Type'] = contentType; }
        return h;
    }

    private async assertOk(res: Response, method: string, path: string): Promise<void> {
        if (res.ok) { return; }
        let body = '';
        try { body = await res.text(); } catch { /* ignore */ }
        // Include the response body in the message so VS Code's error dialog shows it
        const detail = body ? ` — ${body}` : '';
        throw new TrackerError(
            `Jira ${method} ${path} failed: ${res.status} ${res.statusText}${detail}`,
            res.status,
            body,
        );
    }
}

// ─── Jira API response shapes (minimal) ──────────────────────────────────────

interface AdfNode {
    type: string;
    text?: string;
    content?: AdfNode[];
}

interface AdfDoc {
    type: 'doc';
    version: number;
    content: AdfNode[];
}

interface JiraIssueResponse {
    key: string;
    fields: {
        summary: string;
        description: AdfDoc | null;
        labels: string[];
        [key: string]: unknown;
    };
}

interface JiraSubtaskIssueResponse {
    key: string;
    fields: {
        summary: string;
        status?: { statusCategory?: { key?: string } };
    };
}

// ─── ADF → plain text ─────────────────────────────────────────────────────────

function adfToText(doc: AdfDoc | null | undefined): string {
    if (!doc) { return ''; }
    return extractText(doc.content ?? []).trim();
}

function extractText(nodes: AdfNode[]): string {
    return nodes.map((node) => {
        if (node.type === 'text') { return node.text ?? ''; }
        const inner = extractText(node.content ?? []);
        // Add a newline after block-level nodes so paragraphs separate naturally
        const isBlock = ['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote'].includes(node.type);
        return isBlock ? inner + '\n' : inner;
    }).join('');
}

// ─── User-story text parsing ──────────────────────────────────────────────────

/**
 * Reverse of storyDescription() in field-mapping.ts.
 * Parses "As a ...\nI want ...\nSo that ...\n\n<description>" into parts.
 * Returns empty strings for any missing parts so the caller always has
 * a complete object even if the remote text was hand-edited.
 */
function parseUserStoryText(text: string): {
    as_a: string; i_want: string; so_that: string; description: string;
} {
    // Strip the AC section first — match flexibly since ADF collapses whitespace
    const acSectionMatch = text.match(/[-—]{3,}\s*(?:##?\s*)?Acceptance Criteria/i);
    const body = (acSectionMatch?.index !== undefined
        ? text.slice(0, acSectionMatch.index)
        : text
    ).trim();

    // Match "As a X", "I want X", "So that X" — each may be on its own line
    // after ADF round-trip paragraph splitting
    const asAMatch = body.match(/^As a\s+(.+)/im);
    const iWantMatch = body.match(/^I want\s+(.+)/im);
    const soThatMatch = body.match(/^So that\s+(.+)/im);

    // Description is everything after the "So that" line
    const soThatIdx = body.search(/^So that\s+.+$/im);
    let description = '';
    if (soThatIdx >= 0) {
        const afterSoThat = body.slice(soThatIdx).replace(/^So that\s+.+\n?/i, '').trim();
        description = afterSoThat;
    }

    return {
        as_a: asAMatch?.[1]?.trim() ?? '',
        i_want: iWantMatch?.[1]?.trim() ?? '',
        so_that: soThatMatch?.[1]?.trim() ?? '',
        description,
    };
}

/**
 * Extract the acceptance criteria block appended by toJiraStoryFields()
 * when acFieldId === 'description'.
 *
 * We wrote: "---\n\n## Acceptance Criteria\n\n<scenarios>"
 * but ADF round-trips collapse whitespace, so we match flexibly on
 * "---" and "Acceptance Criteria" regardless of surrounding whitespace.
 * Returns empty string if the marker isn't present.
 */
function extractAcFromDescription(text: string): string {
    // Try the exact marker first
    const exactMarker = '---\n\n## Acceptance Criteria\n\n';
    const exactIdx = text.indexOf(exactMarker);
    if (exactIdx >= 0) {
        return text.slice(exactIdx + exactMarker.length).trim();
    }
    // Flexible match: find "Acceptance Criteria" heading (with any surrounding whitespace)
    const match = text.match(/[-—]{3,}\s*##?\s*Acceptance Criteria\s*/i);
    if (match?.index !== undefined) {
        return text.slice(match.index + match[0].length).trim();
    }
    // Last resort: look for just the heading line
    const headingMatch = text.match(/##?\s*Acceptance Criteria\s*/i);
    if (headingMatch?.index !== undefined) {
        return text.slice(headingMatch.index + headingMatch[0].length).trim();
    }
    return '';
}

/**
 * Split a multi-scenario Gherkin block back into individual scenario strings.
 * Each scenario starts with "Scenario:" (with optional leading whitespace).
 * If the text doesn't look like Gherkin, wrap the whole thing as one item.
 */
function parseGherkinScenarios(text: string): string[] {
    if (!text.trim()) { return []; }
    const parts = text.split(/(?=^\s*Scenario:)/m).map((s) => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts : [text.trim()];
}
