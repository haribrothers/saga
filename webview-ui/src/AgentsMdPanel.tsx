import { useState, useEffect, useCallback } from 'react';
import {
    sendReady, sendAccept, sendRegenerate, sendDiscard,
    onMessage, SerialTokenUsage,
} from './vscode-agents-md';
import './agents-md.css';

interface State {
    content: string;
    modelLabel: string;
    tokenUsage?: SerialTokenUsage;
    hasExisting: boolean;
    error?: string;
    regenerating: boolean;
}

export function AgentsMdPanel() {
    const [state, setState] = useState<State | null>(null);
    const [edited, setEdited] = useState(false);

    useEffect(() => {
        const unsub = onMessage((msg) => {
            if (msg.type === 'load') {
                setState({
                    content: msg.content,
                    modelLabel: msg.modelLabel,
                    tokenUsage: msg.tokenUsage,
                    hasExisting: msg.hasExisting,
                    error: undefined,
                    regenerating: false,
                });
                setEdited(false);
            } else if (msg.type === 'acceptAck') {
                // Panel is closed by the extension after accept
            } else if (msg.type === 'error') {
                setState((prev) => prev ? { ...prev, error: msg.message, regenerating: false } : null);
            }
        });
        sendReady();
        return unsub;
    }, []);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setState((prev) => prev ? { ...prev, content: e.target.value } : null);
        setEdited(true);
    }, []);

    const handleAccept = useCallback(() => {
        if (!state) { return; }
        sendAccept(state.content);
    }, [state]);

    const handleRegenerate = useCallback(() => {
        setState((prev) => prev ? { ...prev, regenerating: true, error: undefined } : null);
        sendRegenerate();
    }, []);

    const handleDiscard = useCallback(() => {
        sendDiscard();
    }, []);

    if (!state) {
        return <div className="amd-loading">Generating AGENTS.md…</div>;
    }

    const { content, modelLabel, tokenUsage, hasExisting, error, regenerating } = state;

    const tokenLine = tokenUsage
        ? `${tokenUsage.inputTokens.toLocaleString()} in / ${tokenUsage.outputTokens.toLocaleString()} out${tokenUsage.estimated ? ' (est.)' : ''}`
        : null;

    return (
        <div className="amd-root">
            <header className="amd-header">
                <div className="amd-header-left">
                    <span className="amd-title">AGENTS.md</span>
                    {hasExisting && (
                        <span className="amd-badge amd-badge-update">updating existing</span>
                    )}
                    {!hasExisting && (
                        <span className="amd-badge amd-badge-new">new file</span>
                    )}
                </div>
                <div className="amd-header-meta">
                    <span className="amd-model-label">{modelLabel}</span>
                    {tokenLine && <span className="amd-tokens">{tokenLine}</span>}
                </div>
            </header>

            {error && (
                <div className="amd-error">{error}</div>
            )}

            {regenerating && (
                <div className="amd-regenerating">Regenerating…</div>
            )}

            <div className="amd-editor-wrap">
                <textarea
                    className="amd-editor"
                    value={content}
                    onChange={handleChange}
                    spellCheck={false}
                    disabled={regenerating}
                    aria-label="AGENTS.md content"
                />
            </div>

            <footer className="amd-footer">
                <div className="amd-footer-left">
                    <button
                        className="amd-btn amd-btn-secondary"
                        onClick={handleRegenerate}
                        disabled={regenerating}
                    >
                        {regenerating ? 'Regenerating…' : 'Regenerate'}
                    </button>
                    <button
                        className="amd-btn amd-btn-ghost"
                        onClick={handleDiscard}
                        disabled={regenerating}
                    >
                        Discard
                    </button>
                </div>
                <button
                    className={`amd-btn amd-btn-primary${edited ? ' amd-btn-dirty' : ''}`}
                    onClick={handleAccept}
                    disabled={regenerating}
                >
                    {edited ? 'Accept & Save *' : 'Accept & Save'}
                </button>
            </footer>
        </div>
    );
}
