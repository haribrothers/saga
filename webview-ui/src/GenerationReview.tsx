import { useEffect, useReducer, useCallback, useState } from 'react';
import reviewApi, {
    ReviewExtensionToWebview,
    ReviewMode,
    EpicDraft,
    StoryDraft,
    InvestResult,
    InvestGrade,
} from './vscode-generation-review';
import './generation-review.css';

// ─── State ────────────────────────────────────────────────────────────────────

interface ReviewState {
    mode: ReviewMode;
    epics: EpicDraft[];
    stories: StoryDraft[];
    modelLabel: string;
    contextFileCount: number;
    investResults: Record<string, InvestResult>;
    validating: boolean;
    refining: boolean;
    saving: boolean;
    error: string | null;
    saved: boolean;
}

type Action =
    | { type: 'LOAD'; mode: ReviewMode; epics: EpicDraft[]; stories: StoryDraft[]; modelLabel: string; contextFileCount: number }
    | { type: 'UPDATE_EPIC'; idx: number; epic: EpicDraft }
    | { type: 'REMOVE_EPIC'; idx: number }
    | { type: 'UPDATE_STORY'; idx: number; story: StoryDraft }
    | { type: 'REMOVE_STORY'; idx: number }
    | { type: 'INVEST_RESULTS'; results: Record<string, InvestResult> }
    | { type: 'REFINED'; mode: ReviewMode; epics: EpicDraft[]; stories: StoryDraft[] }
    | { type: 'VALIDATING' }
    | { type: 'REFINING' }
    | { type: 'SAVING' }
    | { type: 'SAVE_ACK' }
    | { type: 'ERROR'; message: string }
    | { type: 'CLEAR_ERROR' };

const initial: ReviewState = {
    mode: 'epics', epics: [], stories: [], modelLabel: '', contextFileCount: 0,
    investResults: {}, validating: false, refining: false, saving: false,
    error: null, saved: false,
};

function reducer(state: ReviewState, action: Action): ReviewState {
    switch (action.type) {
        case 'LOAD':
            return { ...initial, mode: action.mode, epics: action.epics, stories: action.stories, modelLabel: action.modelLabel, contextFileCount: action.contextFileCount };
        case 'UPDATE_EPIC': {
            const epics = [...state.epics];
            epics[action.idx] = action.epic;
            return { ...state, epics };
        }
        case 'REMOVE_EPIC':
            return { ...state, epics: state.epics.filter((_, i) => i !== action.idx) };
        case 'UPDATE_STORY': {
            const stories = [...state.stories];
            stories[action.idx] = action.story;
            return { ...state, stories };
        }
        case 'REMOVE_STORY':
            return { ...state, stories: state.stories.filter((_, i) => i !== action.idx) };
        case 'INVEST_RESULTS': {
            const merged: Record<string, InvestResult> = { ...state.investResults, ...action.results };
            const stories = state.stories.map((s) => merged[s.id] ? { ...s, invest: merged[s.id] } : s);
            return { ...state, investResults: merged, stories, validating: false };
        }
        case 'REFINED':
            return {
                ...state,
                epics: action.mode === 'epics' ? action.epics : state.epics,
                stories: action.mode === 'stories' ? action.stories : state.stories,
                refining: false,
            };
        case 'VALIDATING': return { ...state, validating: true, error: null };
        case 'REFINING':   return { ...state, refining: true, error: null };
        case 'SAVING':     return { ...state, saving: true };
        case 'SAVE_ACK':   return { ...state, saving: false, saved: true };
        case 'ERROR':      return { ...state, validating: false, refining: false, saving: false, error: action.message };
        case 'CLEAR_ERROR': return { ...state, error: null };
        default: return state;
    }
}

// ─── Root component ───────────────────────────────────────────────────────────

export function GenerationReview() {
    const [state, dispatch] = useReducer(reducer, initial);
    const [refineText, setRefineText] = useState('');

    useEffect(() => {
        const handler = (event: MessageEvent<ReviewExtensionToWebview>) => {
            const msg = event.data;
            switch (msg.type) {
                case 'load':        dispatch({ type: 'LOAD', mode: msg.mode, epics: msg.epics, stories: msg.stories, modelLabel: msg.modelLabel, contextFileCount: msg.contextFileCount }); break;
                case 'investResults': dispatch({ type: 'INVEST_RESULTS', results: msg.results }); break;
                case 'refined':     dispatch({ type: 'REFINED', mode: msg.mode, epics: msg.epics, stories: msg.stories }); break;
                case 'saveAck':     dispatch({ type: 'SAVE_ACK' }); break;
                case 'error':       dispatch({ type: 'ERROR', message: msg.message }); break;
            }
        };
        window.addEventListener('message', handler);
        reviewApi.postMessage({ type: 'ready' });
        return () => window.removeEventListener('message', handler);
    }, []);

    const handleValidate = useCallback(() => {
        dispatch({ type: 'VALIDATING' });
        reviewApi.postMessage({ type: 'validate', stories: state.stories });
    }, [state.stories]);

    const handleRefineAll = useCallback(() => {
        if (!refineText.trim()) { return; }
        dispatch({ type: 'REFINING' });
        reviewApi.postMessage({
            type: 'refine',
            mode: state.mode,
            items: state.mode === 'epics' ? state.epics : state.stories,
            instructions: refineText,
        });
    }, [state.mode, state.epics, state.stories, refineText]);

    const handleRefineStory = useCallback((story: StoryDraft, instructions: string) => {
        dispatch({ type: 'REFINING' });
        reviewApi.postMessage({ type: 'refine', mode: 'stories', items: [story], instructions });
    }, []);

    const handleRegenerate = useCallback(() => {
        reviewApi.postMessage({ type: 'regenerate' });
    }, []);

    const handleSave = useCallback(() => {
        dispatch({ type: 'SAVING' });
        reviewApi.postMessage({ type: 'save', mode: state.mode, epics: state.epics, stories: state.stories });
    }, [state.mode, state.epics, state.stories]);

    const isEmpty = state.mode === 'epics' ? state.epics.length === 0 : state.stories.length === 0;

    if (state.saved) {
        return (
            <div className="review-root">
                <div className="review-saved">✓ Saved successfully. You can close this panel.</div>
            </div>
        );
    }

    if (!state.modelLabel) {
        return <div className="review-loading">Generating…</div>;
    }

    return (
        <div className="review-root">
            <header className="review-header">
                <div className="review-header-info">
                    <span className="review-title">
                        {state.mode === 'epics' ? 'Generated Epics' : 'Generated Stories'}
                    </span>
                    <span className="review-meta">
                        Model: <strong>{state.modelLabel}</strong>
                        {state.contextFileCount > 0 && ` · ${state.contextFileCount} context file${state.contextFileCount > 1 ? 's' : ''}`}
                    </span>
                </div>
                <div className="review-header-actions">
                    <button className="btn-ghost" onClick={handleRegenerate} title="Discard and regenerate">
                        ↺ Regenerate
                    </button>
                    <button className="btn-primary" onClick={handleSave} disabled={state.saving || isEmpty}>
                        {state.saving ? 'Saving…' : `Save ${state.mode === 'epics' ? 'Epics' : 'Stories'}`}
                    </button>
                </div>
            </header>

            {state.error && (
                <div className="review-error" onClick={() => dispatch({ type: 'CLEAR_ERROR' })}>
                    ✗ {state.error} <span className="dismiss">✕</span>
                </div>
            )}

            <main className="review-body">
                {state.mode === 'epics' ? (
                    <EpicsList
                        epics={state.epics}
                        onUpdate={(idx, epic) => dispatch({ type: 'UPDATE_EPIC', idx, epic })}
                        onRemove={(idx) => dispatch({ type: 'REMOVE_EPIC', idx })}
                    />
                ) : (
                    <StoriesList
                        stories={state.stories}
                        refining={state.refining}
                        onUpdate={(idx, story) => dispatch({ type: 'UPDATE_STORY', idx, story })}
                        onRemove={(idx) => dispatch({ type: 'REMOVE_STORY', idx })}
                        onRefineStory={handleRefineStory}
                    />
                )}

                {state.mode === 'stories' && (
                    <div className="validate-bar">
                        <button className="btn-secondary" onClick={handleValidate} disabled={state.validating || isEmpty}>
                            {state.validating ? 'Validating…' : '✓ Validate All (INVEST)'}
                        </button>
                    </div>
                )}

                <div className="refine-bar">
                    <input
                        className="refine-input"
                        placeholder={`Refine instructions — e.g. "${state.mode === 'epics' ? 'Make epics more granular' : 'Fix INVEST issues, keep stories under 5 points'}"`}
                        value={refineText}
                        onChange={(e) => setRefineText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleRefineAll()}
                    />
                    <button className="btn-secondary" onClick={handleRefineAll} disabled={state.refining || !refineText.trim() || isEmpty}>
                        {state.refining ? 'Refining…' : '↺ Refine All'}
                    </button>
                </div>
            </main>
        </div>
    );
}

// ─── Epics list ───────────────────────────────────────────────────────────────

function EpicsList({ epics, onUpdate, onRemove }: {
    epics: EpicDraft[];
    onUpdate: (idx: number, e: EpicDraft) => void;
    onRemove: (idx: number) => void;
}) {
    if (epics.length === 0) {
        return <p className="review-empty">No epics — click Regenerate to try again.</p>;
    }
    return (
        <div className="items-list">
            {epics.map((epic, idx) => (
                <EpicCard key={epic.id} epic={epic} idx={idx} onUpdate={onUpdate} onRemove={onRemove} />
            ))}
        </div>
    );
}

function EpicCard({ epic, idx, onUpdate, onRemove }: {
    epic: EpicDraft; idx: number;
    onUpdate: (idx: number, e: EpicDraft) => void;
    onRemove: (idx: number) => void;
}) {
    return (
        <div className="item-card">
            <div className="item-card-header">
                <span className="item-id">{epic.id}</span>
                <button className="btn-remove" onClick={() => onRemove(idx)} title="Remove">✕</button>
            </div>
            <div className="item-field">
                <label className="field-label">Title</label>
                <input className="input-text" value={epic.title}
                    onChange={(e) => onUpdate(idx, { ...epic, title: e.target.value })} />
            </div>
            <div className="item-field">
                <label className="field-label">Description</label>
                <textarea className="input-textarea" rows={3} value={epic.description}
                    onChange={(e) => onUpdate(idx, { ...epic, description: e.target.value })} />
            </div>
        </div>
    );
}

// ─── Stories list ─────────────────────────────────────────────────────────────

function StoriesList({ stories, refining, onUpdate, onRemove, onRefineStory }: {
    stories: StoryDraft[];
    refining: boolean;
    onUpdate: (idx: number, s: StoryDraft) => void;
    onRemove: (idx: number) => void;
    onRefineStory: (s: StoryDraft, instructions: string) => void;
}) {
    if (stories.length === 0) {
        return <p className="review-empty">No stories — click Regenerate to try again.</p>;
    }
    return (
        <div className="items-list">
            {stories.map((story, idx) => (
                <StoryCard key={story.id} story={story} idx={idx} refining={refining}
                    onUpdate={onUpdate} onRemove={onRemove} onRefine={onRefineStory} />
            ))}
        </div>
    );
}

function StoryCard({ story, idx, refining, onUpdate, onRemove, onRefine }: {
    story: StoryDraft; idx: number; refining: boolean;
    onUpdate: (idx: number, s: StoryDraft) => void;
    onRemove: (idx: number) => void;
    onRefine: (s: StoryDraft, instructions: string) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const [refineText, setRefineText] = useState('');
    const investGrade = overallInvestGrade(story.invest);

    return (
        <div className={`item-card ${investGrade === 'fail' ? 'item-card--fail' : investGrade === 'warn' ? 'item-card--warn' : ''}`}>
            <div className="item-card-header">
                <span className="item-id">{story.id}</span>
                {story.invest && <InvestBadgeRow invest={story.invest} />}
                <div className="item-card-actions">
                    <button className="btn-ghost-sm" onClick={() => setExpanded((v) => !v)}>
                        {expanded ? '▲ Collapse' : '▼ Edit'}
                    </button>
                    <button className="btn-remove" onClick={() => onRemove(idx)} title="Remove">✕</button>
                </div>
            </div>

            <p className="story-summary">
                <strong>{story.title}</strong>
                <span className="story-as-a"> · As a {story.as_a}, I want {story.i_want}</span>
            </p>

            {story.invest && <InvestIssues invest={story.invest} />}

            {expanded && (
                <div className="story-expanded">
                    <div className="item-field">
                        <label className="field-label">Title</label>
                        <input className="input-text" value={story.title}
                            onChange={(e) => onUpdate(idx, { ...story, title: e.target.value })} />
                    </div>
                    <div className="fields-row">
                        <div className="item-field">
                            <label className="field-label">As a</label>
                            <input className="input-text" value={story.as_a}
                                onChange={(e) => onUpdate(idx, { ...story, as_a: e.target.value })} />
                        </div>
                        <div className="item-field flex-1">
                            <label className="field-label">I want</label>
                            <input className="input-text" value={story.i_want}
                                onChange={(e) => onUpdate(idx, { ...story, i_want: e.target.value })} />
                        </div>
                    </div>
                    <div className="item-field">
                        <label className="field-label">So that</label>
                        <input className="input-text" value={story.so_that}
                            onChange={(e) => onUpdate(idx, { ...story, so_that: e.target.value })} />
                    </div>
                    <div className="item-field">
                        <label className="field-label">Acceptance Criteria</label>
                        <textarea className="input-textarea" rows={6} value={story.acceptance_criteria.join('\n---\n')}
                            onChange={(e) => onUpdate(idx, { ...story, acceptance_criteria: e.target.value.split('\n---\n') })} />
                        <p className="hint">Separate scenarios with a line containing only <code>---</code></p>
                    </div>
                    <div className="fields-row">
                        <div className="item-field">
                            <label className="field-label">Estimate</label>
                            <input type="number" min={1} max={99} className="input-text input-narrow"
                                value={story.estimate ?? ''} onChange={(e) =>
                                    onUpdate(idx, { ...story, estimate: e.target.value ? parseInt(e.target.value) : undefined })} />
                        </div>
                        <div className="item-field flex-1">
                            <label className="field-label">Labels</label>
                            <input className="input-text" value={story.labels.join(', ')}
                                onChange={(e) => onUpdate(idx, { ...story, labels: e.target.value.split(',').map((l) => l.trim()).filter(Boolean) })} />
                        </div>
                    </div>
                </div>
            )}

            <div className="story-refine-row">
                <input className="refine-input refine-input--sm" placeholder="Refine this story…"
                    value={refineText} onChange={(e) => setRefineText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && refineText.trim()) { onRefine(story, refineText); setRefineText(''); } }} />
                <button className="btn-ghost-sm" disabled={refining || !refineText.trim()}
                    onClick={() => { onRefine(story, refineText); setRefineText(''); }}>
                    ↺ Refine
                </button>
            </div>
        </div>
    );
}

// ─── INVEST helpers ───────────────────────────────────────────────────────────

const INVEST_KEYS = ['independent', 'negotiable', 'valuable', 'estimable', 'small', 'testable'] as const;

function InvestBadgeRow({ invest }: { invest: InvestResult }) {
    return (
        <div className="invest-badges">
            {INVEST_KEYS.map((k) => {
                const c = invest[k];
                return (
                    <span key={k} className={`invest-dot invest-dot--${c.result}`} title={`${k}: ${c.reason}`}>
                        {c.result === 'pass' ? '✓' : c.result === 'warn' ? '⚠' : '✗'}
                    </span>
                );
            })}
        </div>
    );
}

function InvestIssues({ invest }: { invest: InvestResult }) {
    const issues = INVEST_KEYS.filter((k) => invest[k].result !== 'pass');
    if (issues.length === 0) { return null; }
    return (
        <ul className="invest-issues">
            {issues.map((k) => (
                <li key={k} className={`invest-issue invest-issue--${invest[k].result}`}>
                    {invest[k].result === 'warn' ? '⚠' : '✗'} <strong>{k}</strong>: {invest[k].reason}
                </li>
            ))}
        </ul>
    );
}

function overallInvestGrade(invest?: InvestResult): InvestGrade | 'none' {
    if (!invest) { return 'none'; }
    const results = INVEST_KEYS.map((k) => invest[k].result);
    if (results.includes('fail')) { return 'fail'; }
    if (results.includes('warn')) { return 'warn'; }
    return 'pass';
}
