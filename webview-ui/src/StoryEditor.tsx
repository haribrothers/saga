import { useEffect, useReducer, useCallback } from 'react';
import vscode, {
    ExtensionToWebview,
    StoryData,
    SubtaskData,
    EpicSummary,
    InvestData,
    InvestGrade,
} from './vscode';
import './editor.css';

// ─── State ────────────────────────────────────────────────────────────────────

type Tab = 'form' | 'subtasks' | 'yaml';

interface EditorState {
    story: StoryData | null;
    epics: EpicSummary[];
    invest: InvestData | null;
    activeTab: Tab;
    dirty: boolean;
    saving: boolean;
    validating: boolean;
    generatingSubtasks: boolean;
}

type Action =
    | { type: 'LOAD'; story: StoryData; epics: EpicSummary[] }
    | { type: 'UPDATE'; patch: Partial<StoryData> }
    | { type: 'INVEST_RESULT'; invest: InvestData }
    | { type: 'SET_TAB'; tab: Tab }
    | { type: 'SAVING' }
    | { type: 'SAVE_ACK' }
    | { type: 'VALIDATING' }
    | { type: 'GENERATING_SUBTASKS' }
    | { type: 'SUBTASKS_GENERATED'; subtasks: SubtaskData[] };

function reducer(state: EditorState, action: Action): EditorState {
    switch (action.type) {
        case 'LOAD':
            return {
                ...state,
                story: action.story,
                epics: action.epics,
                invest: action.story.invest ?? null,
                dirty: false,
            };
        case 'UPDATE':
            return state.story
                ? { ...state, story: { ...state.story, ...action.patch }, dirty: true }
                : state;
        case 'INVEST_RESULT':
            return { ...state, invest: action.invest, validating: false };
        case 'SET_TAB':
            return { ...state, activeTab: action.tab };
        case 'SAVING':
            return { ...state, saving: true };
        case 'SAVE_ACK':
            return { ...state, saving: false, dirty: false };
        case 'VALIDATING':
            return { ...state, validating: true };
        case 'GENERATING_SUBTASKS':
            return { ...state, generatingSubtasks: true };
        case 'SUBTASKS_GENERATED':
            return state.story
                ? { ...state, story: { ...state.story, subtasks: action.subtasks }, generatingSubtasks: false }
                : { ...state, generatingSubtasks: false };
        default:
            return state;
    }
}

const initial: EditorState = {
    story: null,
    epics: [],
    invest: null,
    activeTab: 'form',
    dirty: false,
    saving: false,
    validating: false,
    generatingSubtasks: false,
};

// ─── Component ────────────────────────────────────────────────────────────────

export function StoryEditor() {
    const [state, dispatch] = useReducer(reducer, initial);

    // Listen for messages from the extension host
    useEffect(() => {
        const handler = (event: MessageEvent<ExtensionToWebview>) => {
            const msg = event.data;
            if (msg.type === 'load') {
                dispatch({ type: 'LOAD', story: msg.story, epics: msg.epics });
            } else if (msg.type === 'investResult') {
                dispatch({ type: 'INVEST_RESULT', invest: msg.invest });
            } else if (msg.type === 'saveAck') {
                dispatch({ type: 'SAVE_ACK' });
            } else if (msg.type === 'generatingSubtasks') {
                dispatch({ type: 'GENERATING_SUBTASKS' });
            } else if (msg.type === 'subtasksGenerated') {
                dispatch({ type: 'SUBTASKS_GENERATED', subtasks: msg.subtasks });
            }
        };
        window.addEventListener('message', handler);
        // Signal ready — extension host sends the story data in response
        vscode.postMessage({ type: 'ready' });
        return () => window.removeEventListener('message', handler);
    }, []);

    const handleSave = useCallback(() => {
        if (!state.story) return;
        dispatch({ type: 'SAVING' });
        vscode.postMessage({ type: 'save', story: state.story });
    }, [state.story]);

    const handleValidate = useCallback(() => {
        dispatch({ type: 'VALIDATING' });
        vscode.postMessage({ type: 'validate' });
    }, []);

    const handleGenerateSubtasks = useCallback(() => {
        dispatch({ type: 'GENERATING_SUBTASKS' });
        vscode.postMessage({ type: 'generateSubtasks' });
    }, []);

    if (!state.story) {
        return <div className="loading">Loading story…</div>;
    }

    const { story, invest } = state;

    return (
        <div className="editor-root">
            <header className="editor-header">
                <span className="story-id">{story.id}</span>
                <span className="story-title-header">{story.title || 'Untitled'}</span>
                <div className="header-actions">
                    <button onClick={handleValidate} disabled={state.validating} className="btn-secondary">
                        {state.validating ? 'Validating…' : '✓ Validate'}
                    </button>
                    <button onClick={handleSave} disabled={state.saving || !state.dirty} className="btn-primary">
                        {state.saving ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </header>

            <nav className="tabs">
                <button
                    className={state.activeTab === 'form' ? 'tab active' : 'tab'}
                    onClick={() => dispatch({ type: 'SET_TAB', tab: 'form' })}
                >
                    Form
                </button>
                <button
                    className={state.activeTab === 'subtasks' ? 'tab active' : 'tab'}
                    onClick={() => dispatch({ type: 'SET_TAB', tab: 'subtasks' })}
                >
                    Subtasks{story.subtasks.length ? ` (${story.subtasks.length})` : ''}
                </button>
                <button
                    className={state.activeTab === 'yaml' ? 'tab active' : 'tab'}
                    onClick={() => dispatch({ type: 'SET_TAB', tab: 'yaml' })}
                >
                    YAML
                </button>
            </nav>

            <main className="editor-body">
                {state.activeTab === 'form' ? (
                    <FormView story={story} epics={state.epics} invest={invest} dispatch={dispatch} />
                ) : state.activeTab === 'subtasks' ? (
                    <SubtasksView
                        story={story}
                        generating={state.generatingSubtasks}
                        dispatch={dispatch}
                        onGenerate={handleGenerateSubtasks}
                    />
                ) : (
                    <YamlView story={story} />
                )}
            </main>
        </div>
    );
}

// ─── Form view ────────────────────────────────────────────────────────────────

function FormView({
    story,
    epics,
    invest,
    dispatch,
}: {
    story: StoryData;
    epics: EpicSummary[];
    invest: InvestData | null;
    dispatch: React.Dispatch<Action>;
}) {
    const set = (patch: Partial<StoryData>) => dispatch({ type: 'UPDATE', patch });

    return (
        <div className="form-view">
            <Field label="Title">
                <input
                    value={story.title}
                    onChange={(e) => set({ title: e.target.value })}
                    className="input-text"
                    placeholder="Story title"
                />
            </Field>

            <Field label="Epic">
                <select value={story.epic} onChange={(e) => set({ epic: e.target.value })} className="input-select">
                    {epics.map((ep) => (
                        <option key={ep.id} value={ep.id}>
                            {ep.id} — {ep.title}
                        </option>
                    ))}
                </select>
            </Field>

            <Field label="Status">
                <select value={story.status} onChange={(e) => set({ status: e.target.value })} className="input-select">
                    {['draft', 'ready', 'synced', 'in-progress', 'done'].map((s) => (
                        <option key={s} value={s}>{s}</option>
                    ))}
                </select>
            </Field>

            <div className="user-story-group">
                <Field label="As a">
                    <input value={story.as_a} onChange={(e) => set({ as_a: e.target.value })} className="input-text" placeholder="persona" />
                </Field>
                <Field label="I want">
                    <input value={story.i_want} onChange={(e) => set({ i_want: e.target.value })} className="input-text" placeholder="goal" />
                </Field>
                <Field label="So that">
                    <input value={story.so_that} onChange={(e) => set({ so_that: e.target.value })} className="input-text" placeholder="benefit" />
                </Field>
            </div>

            {invest && <InvestBadges invest={invest} />}

            <Field label="Acceptance Criteria">
                <textarea
                    value={story.acceptance_criteria.join('\n---\n')}
                    onChange={(e) => set({ acceptance_criteria: e.target.value.split('\n---\n') })}
                    className="input-textarea ac-editor"
                    rows={12}
                    placeholder={"Scenario: …\n  Given …\n  When …\n  Then …"}
                />
                <p className="hint">Separate multiple scenarios with a line containing only <code>---</code></p>
            </Field>

            <div className="row-2">
                <Field label="Estimate (points)">
                    <input
                        type="number"
                        min={1}
                        max={99}
                        value={story.estimate ?? ''}
                        onChange={(e) => set({ estimate: e.target.value ? parseInt(e.target.value) : undefined })}
                        className="input-text input-narrow"
                    />
                </Field>
                <Field label="Labels">
                    <input
                        value={story.labels.join(', ')}
                        onChange={(e) => set({ labels: e.target.value.split(',').map((l) => l.trim()).filter(Boolean) })}
                        className="input-text"
                        placeholder="tag1, tag2"
                    />
                </Field>
            </div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="field">
            <label className="field-label">{label}</label>
            {children}
        </div>
    );
}

// ─── Subtasks tab ─────────────────────────────────────────────────────────────

function SubtasksView({
    story,
    generating,
    dispatch,
    onGenerate,
}: {
    story: StoryData;
    generating: boolean;
    dispatch: React.Dispatch<Action>;
    onGenerate: () => void;
}) {
    const setSubtasks = (subtasks: SubtaskData[]) => dispatch({ type: 'UPDATE', patch: { subtasks } });

    const toggleDone = (id: string) => {
        setSubtasks(story.subtasks.map((s) => (s.id === id ? { ...s, done: !s.done } : s)));
    };

    const updateTitle = (id: string, title: string) => {
        setSubtasks(story.subtasks.map((s) => (s.id === id ? { ...s, title } : s)));
    };

    const updateType = (id: string, type: SubtaskData['type']) => {
        setSubtasks(story.subtasks.map((s) => (s.id === id ? { ...s, type } : s)));
    };

    const removeSubtask = (id: string) => {
        setSubtasks(story.subtasks.filter((s) => s.id !== id));
    };

    const addSubtask = () => {
        const nums = story.subtasks
            .map((s) => parseInt(s.id.replace(/^SUB-(\d+)$/, '$1'), 10))
            .filter((n) => !isNaN(n));
        const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
        const id = `SUB-${String(next).padStart(3, '0')}`;
        setSubtasks([...story.subtasks, { id, title: '', type: 'task', done: false }]);
    };

    return (
        <div className="subtasks-view">
            <div className="subtasks-toolbar">
                <button onClick={onGenerate} disabled={generating} className="btn-secondary">
                    {generating ? 'Generating…' : '✨ Generate Subtasks'}
                </button>
                <button onClick={addSubtask} className="btn-secondary">+ Add Subtask</button>
            </div>

            {story.subtasks.length === 0 ? (
                <p className="hint">No subtasks yet. Generate a checklist or add one manually.</p>
            ) : (
                <ul className="subtask-list">
                    {story.subtasks.map((s) => (
                        <li key={s.id} className="subtask-row">
                            <input
                                type="checkbox"
                                checked={s.done}
                                onChange={() => toggleDone(s.id)}
                                className="subtask-checkbox"
                            />
                            <input
                                value={s.title}
                                onChange={(e) => updateTitle(s.id, e.target.value)}
                                className={s.done ? 'input-text subtask-title done' : 'input-text subtask-title'}
                                placeholder="Subtask title"
                            />
                            <select
                                value={s.type}
                                onChange={(e) => updateType(s.id, e.target.value as SubtaskData['type'])}
                                className="input-select subtask-type"
                            >
                                <option value="task">task</option>
                                <option value="test">test</option>
                                <option value="chore">chore</option>
                            </select>
                            <button onClick={() => removeSubtask(s.id)} className="btn-secondary subtask-remove" title="Remove">✕</button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

// ─── INVEST badges ────────────────────────────────────────────────────────────

const INVEST_KEYS = ['independent', 'negotiable', 'valuable', 'estimable', 'small', 'testable'] as const;
type InvestKey = typeof INVEST_KEYS[number];

function InvestBadges({ invest }: { invest: InvestData }) {
    return (
        <div className="invest-section">
            <p className="field-label">INVEST</p>
            <div className="invest-badges">
                {INVEST_KEYS.map((key) => {
                    const c = invest[key as InvestKey];
                    return (
                        <span
                            key={key}
                            className={`invest-badge invest-${c.result}`}
                            title={c.reason}
                        >
                            {gradeIcon(c.result)} {key.charAt(0).toUpperCase() + key.slice(1)}
                        </span>
                    );
                })}
            </div>
        </div>
    );
}

function gradeIcon(grade: InvestGrade): string {
    return grade === 'pass' ? '✓' : grade === 'warn' ? '⚠' : '✗';
}

// ─── YAML view ────────────────────────────────────────────────────────────────

function YamlView({ story }: { story: StoryData }) {
    const text = storyToYaml(story);
    return (
        <pre className="yaml-view">{text}</pre>
    );
}

function storyToYaml(story: StoryData): string {
    // Minimal serializer — full YAML is written by the extension host on save.
    const lines: string[] = [
        `id: ${story.id}`,
        `type: story`,
        `title: ${story.title}`,
        `epic: ${story.epic}`,
        `status: ${story.status}`,
        `as_a: ${story.as_a}`,
        `i_want: ${story.i_want}`,
        `so_that: ${story.so_that}`,
    ];
    if (story.description) {
        lines.push(`description: |`, `  ${story.description.replace(/\n/g, '\n  ')}`);
    }
    lines.push(`acceptance_criteria:`);
    for (const ac of story.acceptance_criteria) {
        lines.push(`  - |`, ...ac.split('\n').map((l) => `    ${l}`));
    }
    if (story.estimate) lines.push(`estimate: ${story.estimate}`);
    if (story.labels.length) lines.push(`labels: [${story.labels.join(', ')}]`);
    if (story.subtasks.length) {
        lines.push(`subtasks:`);
        for (const s of story.subtasks) {
            lines.push(`  - id: ${s.id}`, `    title: ${s.title}`, `    type: ${s.type}`, `    done: ${s.done}`);
        }
    }
    return lines.join('\n');
}
