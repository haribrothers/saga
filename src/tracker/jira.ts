import { Epic, Story } from '../schema';
import { TrackerAdapter, PushResult, ConnectionTestResult, TrackerError } from './adapter';
import { hashEpic, hashStory } from './hash';
import {
    JiraConfig,
    toJiraEpicFields,
    toJiraStoryFields,
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
