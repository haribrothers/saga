import { useEffect, useReducer, useCallback } from 'react';
import vscodeApi, {
    SettingsExtensionToWebview,
    SettingsConfigData,
    ProviderId,
    ProviderStatus,
    ModelTier,
} from './vscode-settings';
import './settings.css';

// ─── State ────────────────────────────────────────────────────────────────────

interface SettingsState {
    config: SettingsConfigData | null;
    providerStatus: Record<ProviderId, ProviderStatus>;
    secretsPresent: Record<string, boolean>;
    dirty: boolean;
    saving: boolean;
    testingProvider: ProviderId | null;
}

type Action =
    | { type: 'LOAD'; config: SettingsConfigData; providerStatus: Record<ProviderId, ProviderStatus>; secretsPresent: Record<string, boolean> }
    | { type: 'UPDATE_CONFIG'; config: SettingsConfigData }
    | { type: 'SAVE_ACK' }
    | { type: 'SAVING' }
    | { type: 'TESTING'; provider: ProviderId }
    | { type: 'CONNECTION_RESULT'; provider: ProviderId; ok: boolean; message: string }
    | { type: 'SECRETS_UPDATED'; secretsPresent: Record<string, boolean> };

function reducer(state: SettingsState, action: Action): SettingsState {
    switch (action.type) {
        case 'LOAD':
            return { ...state, config: action.config, providerStatus: action.providerStatus, secretsPresent: action.secretsPresent, dirty: false, saving: false };
        case 'UPDATE_CONFIG':
            return { ...state, config: action.config, dirty: true };
        case 'SAVING':
            return { ...state, saving: true };
        case 'SAVE_ACK':
            return { ...state, saving: false, dirty: false };
        case 'TESTING':
            return { ...state, testingProvider: action.provider, providerStatus: { ...state.providerStatus, [action.provider]: 'testing' } };
        case 'CONNECTION_RESULT':
            return { ...state, testingProvider: null, providerStatus: { ...state.providerStatus, [action.provider]: action.ok ? 'connected' : 'unreachable' } };
        case 'SECRETS_UPDATED':
            return { ...state, secretsPresent: action.secretsPresent };
        default:
            return state;
    }
}

const PROVIDER_IDS: ProviderId[] = ['vscode-lm', 'anthropic', 'gemini', 'openai', 'local'];

const initial: SettingsState = {
    config: null,
    providerStatus: { 'vscode-lm': 'unknown', anthropic: 'unknown', gemini: 'unknown', openai: 'unknown', local: 'unknown' },
    secretsPresent: {},
    dirty: false,
    saving: false,
    testingProvider: null,
};

// ─── Root component ───────────────────────────────────────────────────────────

export function SettingsEditor() {
    const [state, dispatch] = useReducer(reducer, initial);

    useEffect(() => {
        const handler = (event: MessageEvent<SettingsExtensionToWebview>) => {
            const msg = event.data;
            if (msg.type === 'load') {
                dispatch({ type: 'LOAD', config: msg.config, providerStatus: msg.providerStatus, secretsPresent: msg.secretsPresent });
            } else if (msg.type === 'saveAck') {
                dispatch({ type: 'SAVE_ACK' });
            } else if (msg.type === 'connectionResult') {
                dispatch({ type: 'CONNECTION_RESULT', provider: msg.provider, ok: msg.ok, message: msg.message });
            }
        };
        window.addEventListener('message', handler);
        vscodeApi.postMessage({ type: 'ready' });
        return () => window.removeEventListener('message', handler);
    }, []);

    const setConfig = useCallback((config: SettingsConfigData) => {
        dispatch({ type: 'UPDATE_CONFIG', config });
    }, []);

    const handleSave = useCallback(() => {
        if (!state.config) { return; }
        dispatch({ type: 'SAVING' });
        vscodeApi.postMessage({ type: 'save', config: state.config });
    }, [state.config]);

    const handleTest = useCallback((provider: ProviderId) => {
        dispatch({ type: 'TESTING', provider });
        vscodeApi.postMessage({ type: 'testConnection', provider });
    }, []);

    const handleSaveSecret = useCallback((provider: ProviderId) => {
        vscodeApi.postMessage({ type: 'saveSecret', provider });
    }, []);

    if (!state.config) {
        return <div className="settings-loading">Loading settings…</div>;
    }

    return (
        <div className="settings-root">
            <header className="settings-header">
                <h1 className="settings-title">Saga Settings{state.dirty ? ' ●' : ''}</h1>
                <button
                    className="btn-primary"
                    onClick={handleSave}
                    disabled={state.saving || !state.dirty}
                >
                    {state.saving ? 'Saving…' : 'Save Settings'}
                </button>
            </header>

            <div className="settings-body">
                <ProviderSection
                    config={state.config}
                    providerStatus={state.providerStatus}
                    secretsPresent={state.secretsPresent}
                    testingProvider={state.testingProvider}
                    onChangeConfig={setConfig}
                    onTest={handleTest}
                    onSaveSecret={handleSaveSecret}
                />

                <RoutingSection config={state.config} onChangeConfig={setConfig} />

                <TrackerSection />

                <BudgetSection config={state.config} onChangeConfig={setConfig} />
            </div>
        </div>
    );
}

// ─── Provider section ─────────────────────────────────────────────────────────

const PROVIDER_META: Record<ProviderId, { label: string; description: string; hasKey: boolean; hasBaseUrl: boolean }> = {
    'vscode-lm': { label: 'VS Code LM API (Copilot)', description: 'Uses your existing Copilot subscription — no API key needed.', hasKey: false, hasBaseUrl: false },
    anthropic: { label: 'Anthropic (API Key)', description: 'Pay-per-token. Key stored in SecretStorage.', hasKey: true, hasBaseUrl: false },
    gemini: { label: 'Google Gemini (API Key)', description: 'Pay-per-token, free Flash tier available. Key stored in SecretStorage.', hasKey: true, hasBaseUrl: false },
    openai: { label: 'OpenAI (API Key)', description: 'Pay-per-token. Key stored in SecretStorage.', hasKey: true, hasBaseUrl: false },
    local: { label: 'Local (Ollama / LM Studio)', description: 'Free, fully offline. Needs a running instance at the base URL.', hasKey: false, hasBaseUrl: true },
};

function ProviderSection({
    config, providerStatus, secretsPresent, testingProvider,
    onChangeConfig, onTest, onSaveSecret,
}: {
    config: SettingsConfigData;
    providerStatus: Record<ProviderId, ProviderStatus>;
    secretsPresent: Record<string, boolean>;
    testingProvider: ProviderId | null;
    onChangeConfig: (c: SettingsConfigData) => void;
    onTest: (p: ProviderId) => void;
    onSaveSecret: (p: ProviderId) => void;
}) {
    const setActive = (id: ProviderId) => {
        onChangeConfig({
            ...config,
            ai: { ...config.ai, default_provider: id },
        });
    };

    const setProviderEnabled = (id: ProviderId, enabled: boolean) => {
        onChangeConfig({
            ...config,
            ai: {
                ...config.ai,
                providers: { ...config.ai.providers, [id]: { ...config.ai.providers[id], enabled } },
            },
        });
    };

    const setBaseUrl = (url: string) => {
        onChangeConfig({
            ...config,
            ai: {
                ...config.ai,
                providers: { ...config.ai.providers, local: { ...config.ai.providers.local, base_url: url } },
            },
        });
    };

    const setPromptCaching = (enabled: boolean) => {
        onChangeConfig({
            ...config,
            ai: {
                ...config.ai,
                providers: { ...config.ai.providers, anthropic: { ...config.ai.providers.anthropic, prompt_caching: enabled } },
            },
        });
    };

    return (
        <Section title="AI Provider">
            <p className="section-desc">Select your active provider. Enabled providers can be used as fallbacks.</p>
            <div className="provider-list">
                {PROVIDER_IDS.map((id) => {
                    const meta = PROVIDER_META[id];
                    const status = providerStatus[id];
                    const isActive = config.ai.default_provider === id;
                    const providerCfg = config.ai.providers[id] as { enabled: boolean; base_url?: string; prompt_caching?: boolean };

                    return (
                        <div key={id} className={`provider-card ${isActive ? 'provider-card--active' : ''}`}>
                            <div className="provider-card-header">
                                <label className="provider-radio-label">
                                    <input
                                        type="radio"
                                        name="active-provider"
                                        checked={isActive}
                                        onChange={() => { setActive(id); setProviderEnabled(id, true); }}
                                    />
                                    <span className="provider-name">{meta.label}</span>
                                    {isActive && <span className="badge badge--active">active</span>}
                                </label>
                                <div className="provider-actions">
                                    <StatusDot status={status} />
                                    <button
                                        className="btn-ghost"
                                        onClick={() => onTest(id)}
                                        disabled={testingProvider === id}
                                        title="Test connection"
                                    >
                                        {testingProvider === id ? 'Testing…' : 'Test'}
                                    </button>
                                </div>
                            </div>

                            <p className="provider-desc">{meta.description}</p>

                            {/* Connection status message */}
                            {status !== 'unknown' && status !== 'testing' && (
                                <p className={`provider-status-msg provider-status-msg--${status}`}>
                                    {status === 'connected' ? '✓ Connected' : '✗ Unreachable'}
                                </p>
                            )}

                            {/* Enabled toggle (for non-active providers) */}
                            {!isActive && (
                                <label className="toggle-label">
                                    <input
                                        type="checkbox"
                                        checked={providerCfg.enabled}
                                        onChange={(e) => setProviderEnabled(id, e.target.checked)}
                                    />
                                    Enable as fallback
                                </label>
                            )}

                            {/* API key entry for BYOK providers */}
                            {meta.hasKey && (
                                <div className="provider-key-row">
                                    <span className="key-status">
                                        {secretsPresent[id] ? '🔑 Key stored' : '⚠ No key stored'}
                                    </span>
                                    <button className="btn-ghost" onClick={() => onSaveSecret(id)}>
                                        {secretsPresent[id] ? 'Update Key' : 'Add Key'}
                                    </button>
                                </div>
                            )}

                            {/* Base URL for local */}
                            {meta.hasBaseUrl && (
                                <div className="provider-url-row">
                                    <label className="field-label">Base URL</label>
                                    <input
                                        className="input-text"
                                        value={(providerCfg as { enabled: boolean; base_url: string }).base_url}
                                        onChange={(e) => setBaseUrl(e.target.value)}
                                        placeholder="http://localhost:11434/v1"
                                    />
                                </div>
                            )}

                            {/* Prompt caching toggle for Anthropic */}
                            {id === 'anthropic' && providerCfg.enabled && (
                                <label className="toggle-label">
                                    <input
                                        type="checkbox"
                                        checked={(providerCfg as { enabled: boolean; prompt_caching: boolean }).prompt_caching}
                                        onChange={(e) => setPromptCaching(e.target.checked)}
                                    />
                                    Enable prompt caching (recommended — reduces cost ~90% on repeated context)
                                </label>
                            )}
                        </div>
                    );
                })}
            </div>
        </Section>
    );
}

function StatusDot({ status }: { status: ProviderStatus }) {
    const cls = {
        connected: 'dot dot--green',
        unreachable: 'dot dot--red',
        testing: 'dot dot--yellow dot--pulse',
        unknown: 'dot dot--grey',
    }[status];
    const title = { connected: 'Connected', unreachable: 'Unreachable', testing: 'Testing…', unknown: 'Not tested' }[status];
    return <span className={cls} title={title} />;
}

// ─── Routing section ──────────────────────────────────────────────────────────

const ROUTING_TASKS: Array<{ key: keyof SettingsConfigData['ai']['routing']; label: string }> = [
    { key: 'epic_generation', label: 'Epic generation' },
    { key: 'story_generation', label: 'Story generation' },
    { key: 'invest_validation', label: 'INVEST validation' },
    { key: 'story_splitting', label: 'Story splitting' },
    { key: 'agent_prompt', label: 'Agent prompt assembly' },
    { key: 'agents_md', label: 'AGENTS.md generation' },
];

function RoutingSection({ config, onChangeConfig }: { config: SettingsConfigData; onChangeConfig: (c: SettingsConfigData) => void }) {
    const setTier = (key: keyof SettingsConfigData['ai']['routing'], tier: ModelTier) => {
        onChangeConfig({
            ...config,
            ai: { ...config.ai, routing: { ...config.ai.routing, [key]: tier } },
        });
    };

    return (
        <Section title="Model Routing">
            <p className="section-desc">
                Choose the model tier per task. <strong>Quality</strong> (Sonnet / Gemini Pro) gives better story structure;
                <strong> Cheap</strong> (Haiku / Flash / local) is faster and cheaper for validation tasks.
            </p>
            <div className="routing-grid">
                {ROUTING_TASKS.map(({ key, label }) => (
                    <div key={key} className="routing-row">
                        <span className="routing-label">{label}</span>
                        <div className="tier-toggle">
                            {(['quality', 'cheap'] as ModelTier[]).map((tier) => (
                                <button
                                    key={tier}
                                    className={`tier-btn ${config.ai.routing[key] === tier ? 'tier-btn--active' : ''}`}
                                    onClick={() => setTier(key, tier)}
                                >
                                    {tier}
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </Section>
    );
}

// ─── Tracker section ──────────────────────────────────────────────────────────

function TrackerSection() {
    return (
        <Section title="Tracker">
            <div className="coming-soon-banner">
                <span className="badge badge--soon">Coming in M2</span>
                <p>Jira Cloud and Azure DevOps sync will be configurable here once the push adapter is implemented.</p>
            </div>
        </Section>
    );
}

// ─── Budget section ───────────────────────────────────────────────────────────

function BudgetSection({ config, onChangeConfig }: { config: SettingsConfigData; onChangeConfig: (c: SettingsConfigData) => void }) {
    const setBudget = (patch: Partial<SettingsConfigData['ai']['budget']>) => {
        onChangeConfig({ ...config, ai: { ...config.ai, budget: { ...config.ai.budget, ...patch } } });
    };

    return (
        <Section title="Budget">
            <p className="section-desc">Controls for BYOK providers. Has no effect when using Copilot or local models.</p>
            <div className="budget-grid">
                <div className="field">
                    <label className="field-label">Warn before runs estimated above (USD)</label>
                    <div className="input-with-prefix">
                        <span className="input-prefix">$</span>
                        <input
                            type="number"
                            min={0}
                            step={0.1}
                            className="input-text input-narrow"
                            value={config.ai.budget.confirm_above_usd}
                            onChange={(e) => setBudget({ confirm_above_usd: parseFloat(e.target.value) || 0 })}
                        />
                    </div>
                </div>
                <div className="field">
                    <label className="toggle-label">
                        <input
                            type="checkbox"
                            checked={config.ai.budget.show_token_preview}
                            onChange={(e) => setBudget({ show_token_preview: e.target.checked })}
                        />
                        Show token / cost preview before each generation run
                    </label>
                </div>
            </div>
        </Section>
    );
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="settings-section">
            <h2 className="section-title">{title}</h2>
            {children}
        </section>
    );
}
