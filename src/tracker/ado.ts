import { Epic, Story, Subtask } from '../schema';
import { TrackerAdapter, PushResult, ConnectionTestResult, TrackerError, RemoteEpic, RemoteStory, RemoteSubtask } from './adapter';
import { hashEpic, hashComparableStory, hashComparableSubtask } from './hash';
import { AdoConfig, toAdoEpicPatch, toAdoStoryPatch, toAdoSubtaskPatch } from './field-mapping';

// ─── ADO work item response shape (minimal) ───────────────────────────────────

interface AdoWorkItem {
    id: number;
    url: string;
    _links?: {
        html?: { href: string };
    };
    fields?: Record<string, unknown>;
}

interface AdoProjectInfo {
    id: string;
    name: string;
}

// ─── AdoAdapter ───────────────────────────────────────────────────────────────

export interface AdoAdapterOptions {
    orgUrl: string;   // e.g. "https://dev.azure.com/myorg"
    pat: string;      // Personal Access Token, from SecretStorage
    config: AdoConfig;
}

export class AdoAdapter implements TrackerAdapter {
    readonly provider = 'ado' as const;

    private readonly orgUrl: string;
    private readonly authHeader: string;
    private readonly cfg: AdoConfig;
    private readonly apiVersion = '7.1';

    constructor(opts: AdoAdapterOptions) {
        this.orgUrl = opts.orgUrl.replace(/\/$/, '');
        // ADO Basic auth: base64(:<PAT>)
        this.authHeader = 'Basic ' + Buffer.from(`:${opts.pat}`).toString('base64');
        this.cfg = opts.config;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    async testConnection(): Promise<ConnectionTestResult> {
        try {
            const data = await this.get<AdoProjectInfo>(
                `/_apis/projects/${encodeURIComponent(this.cfg.project)}?api-version=${this.apiVersion}`,
            );
            return { ok: true, message: `Connected to project "${data.name}"` };
        } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : String(err) };
        }
    }

    async pushEpic(epic: Epic): Promise<PushResult> {
        const patch = toAdoEpicPatch(epic, this.cfg);
        const hash = hashEpic(epic);

        let workItem: AdoWorkItem;

        if (epic.remote?.provider === 'ado' && epic.remote.key) {
            workItem = await this.updateWorkItem(Number(epic.remote.key), patch);
        } else {
            workItem = await this.createWorkItem(this.cfg.epicWorkItemType, patch);
        }

        const url = workItem._links?.html?.href ?? this.browseUrl(workItem.id);

        return {
            remoteRef: {
                provider: 'ado',
                key: String(workItem.id),
                url,
                last_synced_hash: hash,
                last_synced_at: new Date().toISOString(),
            },
            syncedHash: hash,
        };
    }

    async pushStory(story: Story, epicRemoteKey?: string): Promise<PushResult> {
        const epicId = epicRemoteKey !== undefined ? Number(epicRemoteKey) : undefined;
        const patch = toAdoStoryPatch(story, this.cfg, this.orgUrl, epicId);
        const hash = hashComparableStory(story);

        let workItem: AdoWorkItem;

        if (story.remote?.provider === 'ado' && story.remote.key) {
            workItem = await this.updateWorkItem(Number(story.remote.key), patch);
        } else {
            workItem = await this.createWorkItem(this.cfg.storyWorkItemType, patch);
        }

        const url = workItem._links?.html?.href ?? this.browseUrl(workItem.id);

        return {
            remoteRef: {
                provider: 'ado',
                key: String(workItem.id),
                url,
                last_synced_hash: hash,
                last_synced_at: new Date().toISOString(),
            },
            syncedHash: hash,
        };
    }

    async pushSubtask(subtask: Subtask, storyRemoteKey: string): Promise<PushResult> {
        const patch = toAdoSubtaskPatch(subtask, this.cfg, this.orgUrl, Number(storyRemoteKey));
        // Use the tracker-comparable hash (excludes `type`, which trackers don't
        // model) so it's directly comparable to hashRemoteSubtask() during sync.
        const hash = hashComparableSubtask(subtask);

        let workItem: AdoWorkItem;

        if (subtask.remote?.provider === 'ado' && subtask.remote.key) {
            workItem = await this.updateWorkItem(Number(subtask.remote.key), patch);
        } else {
            workItem = await this.createWorkItem(this.cfg.subtaskWorkItemType, patch);
        }

        const url = workItem._links?.html?.href ?? this.browseUrl(workItem.id);

        return {
            remoteRef: {
                provider: 'ado',
                key: String(workItem.id),
                url,
                last_synced_hash: hash,
                last_synced_at: new Date().toISOString(),
            },
            syncedHash: hash,
        };
    }

    async deleteEpic(epic: Epic): Promise<void> {
        if (epic.remote?.provider !== 'ado' || !epic.remote.key) {
            throw new TrackerError('Epic has no ADO remote key — nothing to delete.');
        }
        await this.deleteWorkItem(Number(epic.remote.key));
    }

    async deleteStory(story: Story): Promise<void> {
        if (story.remote?.provider !== 'ado' || !story.remote.key) {
            throw new TrackerError('Story has no ADO remote key — nothing to delete.');
        }
        await this.deleteWorkItem(Number(story.remote.key));
    }

    async fetchEpic(remoteKey: string): Promise<RemoteEpic> {
        const item = await this.get<AdoWorkItem>(
            `/_apis/wit/workitems/${remoteKey}?fields=System.Title,System.Description,System.Tags&api-version=${this.apiVersion}`,
        );
        const f = item.fields ?? {};
        return {
            key: remoteKey,
            title: String(f['System.Title'] ?? ''),
            description: htmlToText(String(f['System.Description'] ?? '')),
            labels: adoTagsToLabels(String(f['System.Tags'] ?? '')),
            url: item._links?.html?.href ?? this.browseUrl(Number(remoteKey)),
        };
    }

    async fetchStory(remoteKey: string): Promise<RemoteStory> {
        const item = await this.get<AdoWorkItem>(
            `/_apis/wit/workitems/${remoteKey}?fields=System.Title,System.Description,Microsoft.VSTS.Common.AcceptanceCriteria,Microsoft.VSTS.Scheduling.StoryPoints,System.Tags&api-version=${this.apiVersion}`,
        );
        const f = item.fields ?? {};

        const rawDesc = htmlToText(String(f['System.Description'] ?? ''));
        const { as_a, i_want, so_that, description } = parseAdoUserStoryHtml(
            String(f['System.Description'] ?? ''),
        );

        const acHtml = String(f['Microsoft.VSTS.Common.AcceptanceCriteria'] ?? '');
        const acceptance_criteria = parseAdoAcHtml(acHtml);

        const sp = f['Microsoft.VSTS.Scheduling.StoryPoints'];
        const estimate = sp !== null && sp !== undefined && sp !== '' ? Number(sp) : undefined;

        return {
            key: remoteKey,
            title: String(f['System.Title'] ?? ''),
            as_a,
            i_want,
            so_that,
            description,
            acceptance_criteria,
            estimate: Number.isFinite(estimate) ? estimate : undefined,
            labels: adoTagsToLabels(String(f['System.Tags'] ?? '')),
            url: item._links?.html?.href ?? this.browseUrl(Number(remoteKey)),
        };
    }

    async fetchSubtask(remoteKey: string): Promise<RemoteSubtask> {
        const item = await this.get<AdoWorkItem>(
            `/_apis/wit/workitems/${remoteKey}?fields=System.Title,System.State&api-version=${this.apiVersion}`,
        );
        const f = item.fields ?? {};
        const state = String(f['System.State'] ?? '').toLowerCase();
        const DONE_STATES = new Set(['closed', 'done', 'resolved', 'completed']);
        return {
            key: remoteKey,
            title: String(f['System.Title'] ?? ''),
            done: DONE_STATES.has(state),
            url: item._links?.html?.href ?? this.browseUrl(Number(remoteKey)),
        };
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private browseUrl(id: number): string {
        return `${this.orgUrl}/${encodeURIComponent(this.cfg.project)}/_workitems/edit/${id}`;
    }

    private async createWorkItem(
        type: string,
        patch: { op: string; path: string; value?: unknown }[],
    ): Promise<AdoWorkItem> {
        const encodedType = encodeURIComponent(type);
        return this.patch<AdoWorkItem>(
            `/${encodeURIComponent(this.cfg.project)}/_apis/wit/workitems/$${encodedType}?api-version=${this.apiVersion}`,
            patch,
        );
    }

    private async updateWorkItem(
        id: number,
        patch: { op: string; path: string; value?: unknown }[],
    ): Promise<AdoWorkItem> {
        return this.patch<AdoWorkItem>(
            `/_apis/wit/workitems/${id}?api-version=${this.apiVersion}`,
            patch,
        );
    }

    private async deleteWorkItem(id: number): Promise<void> {
        // ADO requires ?destroy=true to permanently delete; without it the item
        // goes to the recycle bin, which is fine for our purposes.
        const res = await fetch(
            `${this.orgUrl}/_apis/wit/workitems/${id}?api-version=${this.apiVersion}`,
            { method: 'DELETE', headers: this.headers() },
        );
        if (res.status === 204 || res.ok) { return; }
        let body = '';
        try { body = await res.text(); } catch { /* ignore */ }
        const detail = body ? ` — ${body}` : '';
        throw new TrackerError(
            `ADO DELETE workitem/${id} failed: ${res.status} ${res.statusText}${detail}`,
            res.status,
            body,
        );
    }

    // ── HTTP primitives ───────────────────────────────────────────────────────

    private async get<T>(path: string): Promise<T> {
        const res = await fetch(`${this.orgUrl}${path}`, {
            method: 'GET',
            headers: this.headers(),
        });
        await this.assertOk(res, 'GET', path);
        return res.json() as Promise<T>;
    }

    private async patch<T>(path: string, body: unknown): Promise<T> {
        const res = await fetch(`${this.orgUrl}${path}`, {
            method: 'PATCH',
            headers: this.headers('application/json-patch+json'),
            body: JSON.stringify(body),
        });
        await this.assertOk(res, 'PATCH', path);
        return res.json() as Promise<T>;
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
        // ADO error bodies are typically JSON with a human-readable `message`
        // (e.g. "Rule Error for field ... referenced field ... does not exist").
        // Surface it so a 400 is diagnosable instead of a bare status code.
        let detail = '';
        try {
            const parsed = JSON.parse(body) as { message?: string };
            if (parsed.message) { detail = ` — ${parsed.message}`; }
        } catch { /* body wasn't JSON — fall back to raw text below */ }
        if (!detail && body) { detail = ` — ${body}`; }
        throw new TrackerError(
            `ADO ${method} ${path} failed: ${res.status} ${res.statusText}${detail}`,
            res.status,
            body,
        );
    }
}

// ─── ADO HTML parsing helpers ─────────────────────────────────────────────────

/**
 * Strip HTML tags to get plain text. Used for description comparison.
 *
 * Converts block-level boundaries (</p>, </div>, <br>) to newlines BEFORE
 * stripping remaining tags, and only collapses horizontal whitespace (spaces/
 * tabs) rather than all whitespace — a plain `\s+` -> ' ' collapse destroys
 * every newline in a pushed multi-line description (ADO's rich-text field
 * often round-trips literal '\n' verbatim when no HTML was ever present),
 * which makes hashRemoteEpic()/hashRemoteStory() permanently disagree with
 * hashEpic()/hashStory() even with zero real edits.
 */
function htmlToText(html: string): string {
    return html
        .replace(/<\/(p|div)>/gi, '\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Reverse of toAdoStoryPatch description block.
 * Parses "<p><strong>As a</strong> ...</p><p><strong>I want</strong> ...</p>..."
 */
function parseAdoUserStoryHtml(html: string): {
    as_a: string; i_want: string; so_that: string; description: string;
} {
    const asAMatch = html.match(/<strong>As a<\/strong>\s*(.*?)<\/p>/i);
    const iWantMatch = html.match(/<strong>I want<\/strong>\s*(.*?)<\/p>/i);
    const soThatMatch = html.match(/<strong>So that<\/strong>\s*(.*?)<\/p>/i);

    // Description is the last <p> that is not one of the user-story header paragraphs
    const allParas = [...html.matchAll(/<p>(.*?)<\/p>/gi)].map((m) => htmlToText(m[1]));
    const headerTexts = new Set([
        asAMatch ? htmlToText(asAMatch[0]) : null,
        iWantMatch ? htmlToText(iWantMatch[0]) : null,
        soThatMatch ? htmlToText(soThatMatch[0]) : null,
    ]);
    const descParas = allParas.filter((p) => !headerTexts.has(p) && p.trim());
    const description = descParas.join('\n').trim();

    return {
        as_a: asAMatch ? htmlToText(asAMatch[1]) : '',
        i_want: iWantMatch ? htmlToText(iWantMatch[1]) : '',
        so_that: soThatMatch ? htmlToText(soThatMatch[1]) : '',
        description,
    };
}

/**
 * Reverse of the AC HTML block written by toAdoStoryPatch.
 * Each scenario was stored as <pre>...</pre>; split them back out.
 */
function parseAdoAcHtml(html: string): string[] {
    if (!html.trim()) { return []; }
    const matches = [...html.matchAll(/<pre>([\s\S]*?)<\/pre>/gi)];
    if (matches.length > 0) {
        return matches.map((m) => m[1].trim()).filter(Boolean);
    }
    // Fallback: treat the whole thing as one AC item
    return [htmlToText(html).trim()].filter(Boolean);
}

/** ADO tags are semicolon-separated; convert back to a sorted label array. */
function adoTagsToLabels(tags: string): string[] {
    return tags.split(';').map((t) => t.trim()).filter(Boolean).sort();
}
