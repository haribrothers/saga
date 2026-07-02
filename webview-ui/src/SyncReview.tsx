import { useEffect, useReducer, useCallback } from 'react';
import syncApi, {
    SyncExtensionToWebview,
    SyncPlanView,
    EpicSyncStateView,
    StorySyncStateView,
    SubtaskSyncStateView,
    EpicResolutionView,
    StoryResolutionView,
    SubtaskResolutionView,
} from './vscode-sync-review';
import './sync-review.css';

// ─── State ────────────────────────────────────────────────────────────────────

type Resolution = 'push' | 'pull' | 'keep-local' | 'take-remote' | 'skip';

interface SyncState {
    plan: SyncPlanView | null;
    provider: 'jira' | 'ado' | null;
    epicResolutions: Record<string, Resolution>;
    storyResolutions: Record<string, Resolution>;
    subtaskResolutions: Record<string, Resolution>;
    applying: boolean;
    applyResult: { applied: number; failed: Array<{ sagaId: string; error: string }> } | null;
    error: string | null;
}

type Action =
    | { type: 'LOAD'; plan: SyncPlanView; provider: 'jira' | 'ado' }
    | { type: 'SET_EPIC_RES'; sagaId: string; resolution: Resolution }
    | { type: 'SET_STORY_RES'; sagaId: string; resolution: Resolution }
    | { type: 'SET_SUBTASK_RES'; syncId: string; resolution: Resolution }
    | { type: 'APPLYING' }
    | { type: 'APPLY_ACK'; applied: number; failed: Array<{ sagaId: string; error: string }> }
    | { type: 'ERROR'; message: string };

function defaultResolution(kind: EpicSyncStateView['kind'] | StorySyncStateView['kind'] | SubtaskSyncStateView['kind']): Resolution {
    if (kind === 'local-only') { return 'push'; }
    if (kind === 'remote-only') { return 'pull'; }
    if (kind === 'conflict') { return 'keep-local'; }
    return 'skip';
}

function buildDefaultResolutions<T extends { kind: string; local: { id: string } }>(
    items: T[],
): Record<string, Resolution> {
    const r: Record<string, Resolution> = {};
    for (const item of items) {
        r[item.local.id] = defaultResolution(item.kind as EpicSyncStateView['kind']);
    }
    return r;
}

function buildDefaultSubtaskResolutions(items: SubtaskSyncStateView[]): Record<string, Resolution> {
    const r: Record<string, Resolution> = {};
    for (const item of items) {
        r[item.syncId] = defaultResolution(item.kind);
    }
    return r;
}

const initial: SyncState = {
    plan: null, provider: null, epicResolutions: {}, storyResolutions: {}, subtaskResolutions: {},
    applying: false, applyResult: null, error: null,
};

function reducer(state: SyncState, action: Action): SyncState {
    switch (action.type) {
        case 'LOAD':
            return {
                ...initial,
                plan: action.plan,
                provider: action.provider,
                epicResolutions: buildDefaultResolutions(action.plan.epics),
                storyResolutions: buildDefaultResolutions(action.plan.stories),
                subtaskResolutions: buildDefaultSubtaskResolutions(action.plan.subtasks),
            };
        case 'SET_EPIC_RES':
            return { ...state, epicResolutions: { ...state.epicResolutions, [action.sagaId]: action.resolution } };
        case 'SET_STORY_RES':
            return { ...state, storyResolutions: { ...state.storyResolutions, [action.sagaId]: action.resolution } };
        case 'SET_SUBTASK_RES':
            return { ...state, subtaskResolutions: { ...state.subtaskResolutions, [action.syncId]: action.resolution } };
        case 'APPLYING':
            return { ...state, applying: true, error: null };
        case 'APPLY_ACK':
            return { ...state, applying: false, applyResult: { applied: action.applied, failed: action.failed } };
        case 'ERROR':
            return { ...state, applying: false, error: action.message };
        default:
            return state;
    }
}

// ─── Root component ───────────────────────────────────────────────────────────

export function SyncReview() {
    const [state, dispatch] = useReducer(reducer, initial);

    useEffect(() => {
        const handler = (event: MessageEvent<SyncExtensionToWebview>) => {
            const msg = event.data;
            if (msg.type === 'load') {
                dispatch({ type: 'LOAD', plan: msg.plan, provider: msg.provider });
            } else if (msg.type === 'applyAck') {
                dispatch({ type: 'APPLY_ACK', applied: msg.applied, failed: msg.failed });
            } else if (msg.type === 'error') {
                dispatch({ type: 'ERROR', message: msg.message });
            }
        };
        window.addEventListener('message', handler);
        syncApi.postMessage({ type: 'ready' });
        return () => window.removeEventListener('message', handler);
    }, []);

    const setEpicRes = useCallback((sagaId: string, resolution: Resolution) => {
        dispatch({ type: 'SET_EPIC_RES', sagaId, resolution });
    }, []);

    const setStoryRes = useCallback((sagaId: string, resolution: Resolution) => {
        dispatch({ type: 'SET_STORY_RES', sagaId, resolution });
    }, []);

    const setSubtaskRes = useCallback((syncId: string, resolution: Resolution) => {
        dispatch({ type: 'SET_SUBTASK_RES', syncId, resolution });
    }, []);

    const handleApply = useCallback(() => {
        if (!state.plan) { return; }
        dispatch({ type: 'APPLYING' });

        const epicResolutions: EpicResolutionView[] = state.plan.epics.map((s) => ({
            kind: state.epicResolutions[s.local.id] ?? 'skip',
            sagaId: s.local.id,
        }));
        const storyResolutions: StoryResolutionView[] = state.plan.stories.map((s) => ({
            kind: state.storyResolutions[s.local.id] ?? 'skip',
            sagaId: s.local.id,
        }));
        const subtaskResolutions: SubtaskResolutionView[] = state.plan.subtasks.map((s) => ({
            kind: state.subtaskResolutions[s.syncId] ?? 'skip',
            sagaId: s.syncId,
        }));
        syncApi.postMessage({ type: 'apply', epicResolutions, storyResolutions, subtaskResolutions });
    }, [state]);

    const handleCancel = useCallback(() => {
        syncApi.postMessage({ type: 'cancel' });
    }, []);

    if (!state.plan) {
        return <div className="sync-loading">Fetching remote state…</div>;
    }

    const { plan, provider } = state;
    const trackerLabel = provider === 'jira' ? 'Jira' : 'Azure DevOps';
    const totalActionable = plan.epics.filter((s) => s.kind !== 'in-sync').length
        + plan.stories.filter((s) => s.kind !== 'in-sync').length
        + plan.subtasks.filter((s) => s.kind !== 'in-sync').length;
    const inSync = plan.epics.filter((s) => s.kind === 'in-sync').length
        + plan.stories.filter((s) => s.kind === 'in-sync').length
        + plan.subtasks.filter((s) => s.kind === 'in-sync').length;

    const hasConflictsUnresolved =
        plan.epics.some((s) => s.kind === 'conflict' && state.epicResolutions[s.local.id] === 'keep-local' && false)
        || false; // conflicts default to keep-local which is a valid resolution

    const localOnly = [
        ...plan.epics.filter((s): s is EpicSyncStateView & { kind: 'local-only' } => s.kind === 'local-only'),
    ];
    const localOnlyStories = [
        ...plan.stories.filter((s): s is StorySyncStateView & { kind: 'local-only' } => s.kind === 'local-only'),
    ];
    const localOnlySubtasks = plan.subtasks.filter((s): s is SubtaskSyncStateView & { kind: 'local-only' } => s.kind === 'local-only');
    const remoteOnly = plan.epics.filter((s): s is EpicSyncStateView & { kind: 'remote-only' } => s.kind === 'remote-only');
    const remoteOnlyStories = plan.stories.filter((s): s is StorySyncStateView & { kind: 'remote-only' } => s.kind === 'remote-only');
    const remoteOnlySubtasks = plan.subtasks.filter((s): s is SubtaskSyncStateView & { kind: 'remote-only' } => s.kind === 'remote-only');
    const conflicts = plan.epics.filter((s): s is EpicSyncStateView & { kind: 'conflict' } => s.kind === 'conflict');
    const conflictStories = plan.stories.filter((s): s is StorySyncStateView & { kind: 'conflict' } => s.kind === 'conflict');
    const conflictSubtasks = plan.subtasks.filter((s): s is SubtaskSyncStateView & { kind: 'conflict' } => s.kind === 'conflict');

    return (
        <div className="sync-root">
            <div className="sync-header">
                <div className="sync-title">Sync Review — {trackerLabel}</div>
                <div className="sync-subtitle">
                    {plan.epics.length + plan.stories.length + plan.subtasks.length} items checked
                    {inSync > 0 && <> · <span className="badge-ok">{inSync} in sync</span></>}
                    {totalActionable > 0 && <> · <span className="badge-action">{totalActionable} need action</span></>}
                    {plan.fetchErrors.length > 0 && <> · <span className="badge-err">{plan.fetchErrors.length} fetch error{plan.fetchErrors.length > 1 ? 's' : ''}</span></>}
                </div>
            </div>

            {state.error && <div className="sync-error">{state.error}</div>}

            {state.applyResult && state.applyResult.failed.length > 0 && (
                <div className="sync-error">
                    {state.applyResult.failed.length} item(s) failed:
                    <ul>{state.applyResult.failed.map((f) => <li key={f.sagaId}>{f.sagaId}: {f.error}</li>)}</ul>
                </div>
            )}

            {/* ── Local-only (push needed) ───────────────────────────────── */}
            {(localOnly.length > 0 || localOnlyStories.length > 0 || localOnlySubtasks.length > 0) && (
                <section className="sync-section">
                    <h3 className="sync-section-title">Local-only changes <span className="pill push">→ Push</span></h3>
                    {localOnly.map((s) => (
                        <EpicRow key={s.local.id} state={s} resolution={state.epicResolutions[s.local.id] ?? 'push'}
                            onChange={(r) => setEpicRes(s.local.id, r)} />
                    ))}
                    {localOnlyStories.map((s) => (
                        <StoryRow key={s.local.id} state={s} resolution={state.storyResolutions[s.local.id] ?? 'push'}
                            onChange={(r) => setStoryRes(s.local.id, r)} />
                    ))}
                    {localOnlySubtasks.map((s) => (
                        <SubtaskRow key={s.syncId} state={s} resolution={state.subtaskResolutions[s.syncId] ?? 'push'}
                            onChange={(r) => setSubtaskRes(s.syncId, r)} />
                    ))}
                </section>
            )}

            {/* ── Remote-only (pull needed) ──────────────────────────────── */}
            {(remoteOnly.length > 0 || remoteOnlyStories.length > 0 || remoteOnlySubtasks.length > 0) && (
                <section className="sync-section">
                    <h3 className="sync-section-title">Remote-only changes <span className="pill pull">← Pull</span></h3>
                    {remoteOnly.map((s) => (
                        <EpicRow key={s.local.id} state={s} resolution={state.epicResolutions[s.local.id] ?? 'pull'}
                            onChange={(r) => setEpicRes(s.local.id, r)} />
                    ))}
                    {remoteOnlyStories.map((s) => (
                        <StoryRow key={s.local.id} state={s} resolution={state.storyResolutions[s.local.id] ?? 'pull'}
                            onChange={(r) => setStoryRes(s.local.id, r)} />
                    ))}
                    {remoteOnlySubtasks.map((s) => (
                        <SubtaskRow key={s.syncId} state={s} resolution={state.subtaskResolutions[s.syncId] ?? 'pull'}
                            onChange={(r) => setSubtaskRes(s.syncId, r)} />
                    ))}
                </section>
            )}

            {/* ── Conflicts ──────────────────────────────────────────────── */}
            {(conflicts.length > 0 || conflictStories.length > 0 || conflictSubtasks.length > 0) && (
                <section className="sync-section">
                    <h3 className="sync-section-title">Conflicts <span className="pill conflict">⚠ Both changed</span></h3>
                    {conflicts.map((s) => (
                        <EpicConflictRow key={s.local.id} state={s}
                            resolution={state.epicResolutions[s.local.id] ?? 'keep-local'}
                            onChange={(r) => setEpicRes(s.local.id, r)} />
                    ))}
                    {conflictStories.map((s) => (
                        <StoryConflictRow key={s.local.id} state={s}
                            resolution={state.storyResolutions[s.local.id] ?? 'keep-local'}
                            onChange={(r) => setStoryRes(s.local.id, r)} />
                    ))}
                    {conflictSubtasks.map((s) => (
                        <SubtaskConflictRow key={s.syncId} state={s}
                            resolution={state.subtaskResolutions[s.syncId] ?? 'keep-local'}
                            onChange={(r) => setSubtaskRes(s.syncId, r)} />
                    ))}
                </section>
            )}

            {/* ── In sync ────────────────────────────────────────────────── */}
            {inSync > 0 && (
                <section className="sync-section sync-section--muted">
                    <h3 className="sync-section-title">In sync <span className="pill ok">✓ {inSync} item{inSync > 1 ? 's' : ''}</span></h3>
                </section>
            )}

            {/* ── Unpushed (informational) ───────────────────────────────── */}
            {(plan.unpushedEpicIds.length > 0 || plan.unpushedStoryIds.length > 0 || plan.unpushedSubtaskIds.length > 0) && (
                <section className="sync-section sync-section--muted">
                    <h3 className="sync-section-title">Not yet pushed (excluded from sync)</h3>
                    <ul className="sync-unpushed-list">
                        {[...plan.unpushedEpicIds, ...plan.unpushedStoryIds, ...plan.unpushedSubtaskIds].map((id) => (
                            <li key={id} className="sync-unpushed-item">{id}</li>
                        ))}
                    </ul>
                </section>
            )}

            {/* ── Fetch errors ───────────────────────────────────────────── */}
            {plan.fetchErrors.length > 0 && (
                <section className="sync-section sync-section--error">
                    <h3 className="sync-section-title">Fetch errors</h3>
                    <ul className="sync-error-list">
                        {plan.fetchErrors.map((e) => (
                            <li key={e.sagaId}><strong>{e.sagaId}</strong>: {e.error}</li>
                        ))}
                    </ul>
                </section>
            )}

            <div className="sync-footer">
                <button className="btn-secondary" onClick={handleCancel} disabled={state.applying}>Cancel</button>
                <button
                    className="btn-primary"
                    onClick={handleApply}
                    disabled={state.applying || totalActionable === 0 || hasConflictsUnresolved}
                >
                    {state.applying ? 'Applying…' : `Apply Changes${totalActionable > 0 ? ` (${totalActionable})` : ''}`}
                </button>
            </div>
        </div>
    );
}

// ─── Row components ───────────────────────────────────────────────────────────

function EpicRow({ state, resolution, onChange }: {
    state: EpicSyncStateView & { kind: 'local-only' | 'remote-only' };
    resolution: Resolution;
    onChange: (r: Resolution) => void;
}) {
    const { local } = state;
    const remote = 'remote' in state ? state.remote : undefined;
    return (
        <div className="sync-row">
            <div className="sync-row-id">{local.id}</div>
            <div className="sync-row-title">{remote?.title ?? local.title}</div>
            {remote && remote.title !== local.title && (
                <div className="sync-diff">
                    <span className="diff-local">Local: {local.title}</span>
                    <span className="diff-remote">Remote: {remote.title}</span>
                </div>
            )}
            <ActionSelect value={resolution} options={state.kind === 'local-only' ? ['push', 'skip'] : ['pull', 'skip']} onChange={onChange} />
        </div>
    );
}

function StoryRow({ state, resolution, onChange }: {
    state: StorySyncStateView & { kind: 'local-only' | 'remote-only' };
    resolution: Resolution;
    onChange: (r: Resolution) => void;
}) {
    const { local } = state;
    const remote = 'remote' in state ? state.remote : undefined;
    return (
        <div className="sync-row">
            <div className="sync-row-id">{local.id}</div>
            <div className="sync-row-title">{remote?.title ?? local.title}</div>
            {remote && remote.title !== local.title && (
                <div className="sync-diff">
                    <span className="diff-local">Local: {local.title}</span>
                    <span className="diff-remote">Remote: {remote.title}</span>
                </div>
            )}
            <ActionSelect value={resolution} options={state.kind === 'local-only' ? ['push', 'skip'] : ['pull', 'skip']} onChange={onChange} />
        </div>
    );
}

function EpicConflictRow({ state, resolution, onChange }: {
    state: EpicSyncStateView & { kind: 'conflict' };
    resolution: Resolution;
    onChange: (r: Resolution) => void;
}) {
    return (
        <ConflictCard
            sagaId={state.local.id}
            localTitle={state.local.title}
            remoteTitle={state.remote.title}
            remoteUrl={state.remote.url}
            fields={[
                { label: 'Description', local: state.local.description, remote: state.remote.description },
                { label: 'Labels', local: state.local.labels.join(', '), remote: state.remote.labels.join(', ') },
            ]}
            resolution={resolution}
            onChange={onChange}
        />
    );
}

function StoryConflictRow({ state, resolution, onChange }: {
    state: StorySyncStateView & { kind: 'conflict' };
    resolution: Resolution;
    onChange: (r: Resolution) => void;
}) {
    return (
        <ConflictCard
            sagaId={state.local.id}
            localTitle={state.local.title}
            remoteTitle={state.remote.title}
            remoteUrl={state.remote.url}
            fields={[
                { label: 'As a', local: state.local.as_a, remote: state.remote.as_a },
                { label: 'I want', local: state.local.i_want, remote: state.remote.i_want },
                { label: 'So that', local: state.local.so_that, remote: state.remote.so_that },
                { label: 'Description', local: state.local.description, remote: state.remote.description },
                { label: 'Labels', local: state.local.labels.join(', '), remote: state.remote.labels.join(', ') },
            ]}
            resolution={resolution}
            onChange={onChange}
        />
    );
}

function SubtaskRow({ state, resolution, onChange }: {
    state: SubtaskSyncStateView & { kind: 'local-only' | 'remote-only' };
    resolution: Resolution;
    onChange: (r: Resolution) => void;
}) {
    const { local } = state;
    const remote = 'remote' in state ? state.remote : undefined;
    return (
        <div className="sync-row">
            <div className="sync-row-id">{local.storyId} · {local.id}</div>
            <div className="sync-row-title">{remote?.title ?? local.title}</div>
            {remote && remote.title !== local.title && (
                <div className="sync-diff">
                    <span className="diff-local">Local: {local.title}</span>
                    <span className="diff-remote">Remote: {remote.title}</span>
                </div>
            )}
            <ActionSelect value={resolution} options={state.kind === 'local-only' ? ['push', 'skip'] : ['pull', 'skip']} onChange={onChange} />
        </div>
    );
}

function SubtaskConflictRow({ state, resolution, onChange }: {
    state: SubtaskSyncStateView & { kind: 'conflict' };
    resolution: Resolution;
    onChange: (r: Resolution) => void;
}) {
    return (
        <ConflictCard
            sagaId={`${state.local.storyId} · ${state.local.id}`}
            localTitle={state.local.title}
            remoteTitle={state.remote.title}
            remoteUrl={state.remote.url}
            fields={[
                { label: 'Title', local: state.local.title, remote: state.remote.title },
                { label: 'Done', local: String(state.local.done), remote: String(state.remote.done) },
            ]}
            resolution={resolution}
            onChange={onChange}
        />
    );
}

function ConflictCard({ sagaId, localTitle, remoteTitle, remoteUrl, fields, resolution, onChange }: {
    sagaId: string;
    localTitle: string;
    remoteTitle: string;
    remoteUrl: string;
    fields: Array<{ label: string; local: string; remote: string }>;
    resolution: Resolution;
    onChange: (r: Resolution) => void;
}) {
    const changedFields = fields.filter((f) => f.local !== f.remote);
    return (
        <div className="conflict-card">
            <div className="conflict-header">
                <span className="sync-row-id">{sagaId}</span>
                <span className="conflict-title">{localTitle}</span>
                <a href={remoteUrl} className="conflict-remote-link">↗ {sagaId.replace(/^[A-Z]+-\d+$/, '') || 'Remote'}</a>
            </div>
            {changedFields.length > 0 && (
                <table className="conflict-table">
                    <thead><tr><th>Field</th><th>Local</th><th>Remote</th></tr></thead>
                    <tbody>
                        {changedFields.map((f) => (
                            <tr key={f.label}>
                                <td className="field-label">{f.label}</td>
                                <td className="field-local">{f.local || <em>(empty)</em>}</td>
                                <td className="field-remote">{f.remote || <em>(empty)</em>}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            <div className="conflict-resolution">
                <span className="resolution-label">Resolution:</span>
                <ActionSelect
                    value={resolution}
                    options={['keep-local', 'take-remote', 'skip']}
                    onChange={onChange}
                />
            </div>
        </div>
    );
}

function ActionSelect({ value, options, onChange }: {
    value: Resolution;
    options: Resolution[];
    onChange: (r: Resolution) => void;
}) {
    const labels: Record<Resolution, string> = {
        push: '→ Push to tracker',
        pull: '← Pull from tracker',
        'keep-local': 'Keep local',
        'take-remote': 'Take remote',
        skip: 'Skip',
    };
    return (
        <select className="action-select" value={value} onChange={(e) => onChange(e.target.value as Resolution)}>
            {options.map((o) => <option key={o} value={o}>{labels[o]}</option>)}
        </select>
    );
}
