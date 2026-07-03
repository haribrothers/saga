import { useEffect, useReducer, useCallback } from 'react';
import vscode, { ExtensionToWebview, EpicData } from './vscode-epic';
import './editor.css';

// ─── State ────────────────────────────────────────────────────────────────────

interface EditorState {
    epic: EpicData | null;
    storyCount: number;
    dirty: boolean;
    saving: boolean;
}

type Action =
    | { type: 'LOAD'; epic: EpicData; storyCount: number }
    | { type: 'UPDATE'; patch: Partial<EpicData> }
    | { type: 'SAVING' }
    | { type: 'SAVE_ACK' };

function reducer(state: EditorState, action: Action): EditorState {
    switch (action.type) {
        case 'LOAD':
            return { ...state, epic: action.epic, storyCount: action.storyCount, dirty: false };
        case 'UPDATE':
            return state.epic ? { ...state, epic: { ...state.epic, ...action.patch }, dirty: true } : state;
        case 'SAVING':
            return { ...state, saving: true };
        case 'SAVE_ACK':
            return { ...state, saving: false, dirty: false };
        default:
            return state;
    }
}

const initial: EditorState = {
    epic: null,
    storyCount: 0,
    dirty: false,
    saving: false,
};

// ─── Component ────────────────────────────────────────────────────────────────

export function EpicEditor() {
    const [state, dispatch] = useReducer(reducer, initial);

    useEffect(() => {
        const handler = (event: MessageEvent<ExtensionToWebview>) => {
            const msg = event.data;
            if (msg.type === 'load') {
                dispatch({ type: 'LOAD', epic: msg.epic, storyCount: msg.storyCount });
            } else if (msg.type === 'saveAck') {
                dispatch({ type: 'SAVE_ACK' });
            }
        };
        window.addEventListener('message', handler);
        vscode.postMessage({ type: 'ready' });
        return () => window.removeEventListener('message', handler);
    }, []);

    const handleSave = useCallback(() => {
        if (!state.epic) return;
        dispatch({ type: 'SAVING' });
        vscode.postMessage({ type: 'save', epic: state.epic });
    }, [state.epic]);

    if (!state.epic) {
        return <div className="loading">Loading epic…</div>;
    }

    const { epic } = state;
    const set = (patch: Partial<EpicData>) => dispatch({ type: 'UPDATE', patch });

    return (
        <div className="editor-root">
            <header className="editor-header">
                <span className="story-id">{epic.id}</span>
                <span className="story-title-header">{epic.title || 'Untitled'}</span>
                <div className="header-actions">
                    <button onClick={handleSave} disabled={state.saving || !state.dirty} className="btn-primary">
                        {state.saving ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </header>

            <main className="editor-body">
                <div className="form-view">
                    <Field label="Title">
                        <input
                            value={epic.title}
                            onChange={(e) => set({ title: e.target.value })}
                            className="input-text"
                            placeholder="Epic title"
                        />
                    </Field>

                    <Field label="Description">
                        <textarea
                            value={epic.description ?? ''}
                            onChange={(e) => set({ description: e.target.value })}
                            className="input-textarea"
                            rows={8}
                            placeholder="What is this epic about?"
                        />
                    </Field>

                    <Field label="Labels">
                        <input
                            value={epic.labels.join(', ')}
                            onChange={(e) => set({ labels: e.target.value.split(',').map((l) => l.trim()).filter(Boolean) })}
                            className="input-text"
                            placeholder="tag1, tag2"
                        />
                    </Field>

                    <p className="hint">
                        {state.storyCount} {state.storyCount === 1 ? 'story' : 'stories'} under this epic.
                        {state.storyCount > 0 && ' Changing the title or description may make existing stories out of date — you\'ll be offered a chance to regenerate them after saving.'}
                    </p>
                </div>
            </main>
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
