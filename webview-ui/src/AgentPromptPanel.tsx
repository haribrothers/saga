import { useState, useEffect, useCallback } from 'react';
import { sendReady, sendSave, sendCopy, onMessage, SerialTokenUsage } from './vscode-agent-prompt';
import './agent-prompt.css';

interface State {
    storyId: string;
    storyTitle: string;
    content: string;
    modelLabel: string;
    tokenUsage?: SerialTokenUsage;
    error?: string;
}

export function AgentPromptPanel() {
    const [state, setState] = useState<State | null>(null);
    const [edited, setEdited] = useState(false);

    useEffect(() => {
        const unsub = onMessage((msg) => {
            if (msg.type === 'load') {
                setState({
                    storyId: msg.storyId,
                    storyTitle: msg.storyTitle,
                    content: msg.content,
                    modelLabel: msg.modelLabel,
                    tokenUsage: msg.tokenUsage,
                });
                setEdited(false);
            } else if (msg.type === 'error') {
                setState((prev) => prev ? { ...prev, error: msg.message } : null);
            }
        });
        sendReady();
        return unsub;
    }, []);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setState((prev) => prev ? { ...prev, content: e.target.value } : null);
        setEdited(true);
    }, []);

    const handleSave = useCallback(() => {
        sendSave();
        setEdited(false);
    }, []);

    const handleCopy = useCallback(() => {
        sendCopy();
    }, []);

    if (!state) {
        return <div className="ap-loading">Generating agent prompt…</div>;
    }

    const { storyId, storyTitle, content, modelLabel, tokenUsage, error } = state;

    const tokenLine = tokenUsage
        ? `${tokenUsage.inputTokens.toLocaleString()} in / ${tokenUsage.outputTokens.toLocaleString()} out${tokenUsage.estimated ? ' (est.)' : ''}`
        : null;

    return (
        <div className="ap-root">
            <header className="ap-header">
                <div className="ap-header-left">
                    <span className="ap-story-id">{storyId}</span>
                    <span className="ap-story-title">{storyTitle}</span>
                </div>
                <div className="ap-header-meta">
                    <span className="ap-model-label">{modelLabel}</span>
                    {tokenLine && <span className="ap-tokens">{tokenLine}</span>}
                </div>
            </header>

            {error && (
                <div className="ap-error">{error}</div>
            )}

            <div className="ap-editor-wrap">
                <textarea
                    className="ap-editor"
                    value={content}
                    onChange={handleChange}
                    spellCheck={false}
                    aria-label="Agent prompt content"
                />
            </div>

            <footer className="ap-footer">
                <button className="ap-btn ap-btn-secondary" onClick={handleCopy}>
                    Copy to Clipboard
                </button>
                <button
                    className={`ap-btn ap-btn-primary${edited ? ' ap-btn-dirty' : ''}`}
                    onClick={handleSave}
                >
                    {edited ? 'Save *' : 'Save'}
                </button>
            </footer>
        </div>
    );
}
