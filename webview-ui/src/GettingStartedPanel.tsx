import { useState, useEffect } from 'react';
import { sendReady, sendRunStep, sendSkip, sendFinish, onMessage, GettingStartedState } from './vscode-getting-started';
import './getting-started.css';

export function GettingStartedPanel() {
    const [state, setState] = useState<GettingStartedState | null>(null);

    useEffect(() => {
        const unsub = onMessage((msg) => {
            if (msg.type === 'load') {
                setState(msg.state);
            }
        });
        sendReady();
        return unsub;
    }, []);

    if (!state) {
        return <div className="gs-loading">Loading…</div>;
    }

    const allDone = state.hasProvider && state.hasContext && state.hasEpic;

    return (
        <div className="gs-root">
            <header className="gs-header">
                <h1 className="gs-title">Welcome to Saga</h1>
                <p className="gs-subtitle">Three steps to your first set of AI-generated stories. Skip any step and come back later — the sidebar always has these actions.</p>
            </header>

            <ol className="gs-steps">
                <GsStep
                    number={1}
                    title="Choose an AI provider"
                    description="VS Code LM (Copilot), or bring your own key for Anthropic, Gemini, OpenAI, OpenRouter, or a local model."
                    done={state.hasProvider}
                    actionLabel="Open Settings"
                    onAction={() => sendRunStep('provider')}
                />
                <GsStep
                    number={2}
                    title="Add a context file"
                    description="A product brief, design doc, or spec Saga will read when generating epics and stories."
                    done={state.hasContext}
                    actionLabel="Add Context File"
                    onAction={() => sendRunStep('context')}
                />
                <GsStep
                    number={3}
                    title="Generate your first epic"
                    description="Saga reads your context and proposes epics you can review and edit before saving."
                    done={state.hasEpic}
                    actionLabel="Generate Epics"
                    onAction={() => sendRunStep('epic')}
                />
            </ol>

            <footer className="gs-footer">
                <button className="gs-btn gs-btn-ghost" onClick={sendSkip}>Skip for now</button>
                <button className="gs-btn gs-btn-primary" onClick={sendFinish} disabled={!allDone}>
                    {allDone ? "Let's go" : 'Finish'}
                </button>
            </footer>
        </div>
    );
}

function GsStep({
    number, title, description, done, actionLabel, onAction,
}: {
    number: number;
    title: string;
    description: string;
    done: boolean;
    actionLabel: string;
    onAction: () => void;
}) {
    return (
        <li className={`gs-step${done ? ' gs-step--done' : ''}`}>
            <div className="gs-step-marker">{done ? '✓' : number}</div>
            <div className="gs-step-body">
                <div className="gs-step-title">{title}</div>
                <div className="gs-step-desc">{description}</div>
            </div>
            <button className="gs-btn gs-btn-secondary" onClick={onAction}>
                {done ? 'Done — do again' : actionLabel}
            </button>
        </li>
    );
}
