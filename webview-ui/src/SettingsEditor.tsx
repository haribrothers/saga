import { useEffect, useReducer, useCallback } from 'react';
import vscodeApi, {
    SettingsExtensionToWebview,
    SettingsConfigData,
    ProviderId,
    ProviderStatus,
    ModelOption,
} from './vscode-settings';
import './settings.css';

// ─── State ────────────────────────────────────────────────────────────────────

interface SettingsState {
    config: SettingsConfigData | null;
    providerStatus: Record<ProviderId, ProviderStatus>;
    secretsPresent: Record<string, boolean>;
    availableModels: ModelOption[];
    dirty: boolean;
    saving: boolean;
    testingProvider: ProviderId | null;
    testingTracker: 'jira' | 'ado' | null;
    trackerStatus: Partial<Record<'jira' | 'ado', { ok: boolean; message: string }>>;
}

type Action =
    | { type: 'LOAD'; config: SettingsConfigData; providerStatus: Record<ProviderId, ProviderStatus>; secretsPresent: Record<string, boolean>; availableModels: ModelOption[] }
    | { type: 'UPDATE_CONFIG'; config: SettingsConfigData }
    | { type: 'SAVE_ACK'; availableModels: ModelOption[] }
    | { type: 'SAVING' }
    | { type: 'TESTING'; provider: ProviderId }
    | { type: 'CONNECTION_RESULT'; provider: ProviderId; ok: boolean; message: string }
    | { type: 'TESTING_TRACKER'; tracker: 'jira' | 'ado' }
    | { type: 'TRACKER_CONNECTION_RESULT'; tracker: 'jira' | 'ado'; ok: boolean; message: string };

function reducer(state: SettingsState, action: Action): SettingsState {
    switch (action.type) {
        case 'LOAD':
            return { ...state, config: action.config, providerStatus: action.providerStatus, secretsPresent: action.secretsPresent, availableModels: action.availableModels, dirty: false, saving: false };
        case 'UPDATE_CONFIG':
            return { ...state, config: action.config, dirty: true };
        case 'SAVING':
            return { ...state, saving: true };
        case 'SAVE_ACK':
            return { ...state, saving: false, dirty: false, availableModels: action.availableModels };
        case 'TESTING':
            return { ...state, testingProvider: action.provider, providerStatus: { ...state.providerStatus, [action.provider]: 'testing' } };
        case 'CONNECTION_RESULT':
            return { ...state, testingProvider: null, providerStatus: { ...state.providerStatus, [action.provider]: action.ok ? 'connected' : 'unreachable' } };
        case 'TESTING_TRACKER':
            return { ...state, testingTracker: action.tracker };
        case 'TRACKER_CONNECTION_RESULT':
            return { ...state, testingTracker: null, trackerStatus: { ...state.trackerStatus, [action.tracker]: { ok: action.ok, message: action.message } } };
        default:
            return state;
    }
}

const PROVIDER_IDS: ProviderId[] = ['vscode-lm', 'anthropic', 'gemini', 'openai', 'openrouter', 'local'];

const initial: SettingsState = {
    config: null,
    providerStatus: { 'vscode-lm': 'unknown', anthropic: 'unknown', gemini: 'unknown', openai: 'unknown', openrouter: 'unknown', local: 'unknown' },
    secretsPresent: {},
    availableModels: [],
    dirty: false,
    saving: false,
    testingProvider: null,
    testingTracker: null,
    trackerStatus: {},
};

// ─── Root component ───────────────────────────────────────────────────────────

export function SettingsEditor() {
    const [state, dispatch] = useReducer(reducer, initial);

    useEffect(() => {
        const handler = (event: MessageEvent<SettingsExtensionToWebview>) => {
            const msg = event.data;
            if (msg.type === 'load') {
                dispatch({ type: 'LOAD', config: msg.config, providerStatus: msg.providerStatus, secretsPresent: msg.secretsPresent, availableModels: msg.availableModels });
            } else if (msg.type === 'saveAck') {
                dispatch({ type: 'SAVE_ACK', availableModels: msg.availableModels });
            } else if (msg.type === 'connectionResult') {
                dispatch({ type: 'CONNECTION_RESULT', provider: msg.provider, ok: msg.ok, message: msg.message });
            } else if (msg.type === 'trackerConnectionResult') {
                dispatch({ type: 'TRACKER_CONNECTION_RESULT', tracker: msg.tracker, ok: msg.ok, message: msg.message });
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

    const handleSaveTrackerSecret = useCallback((tracker: 'jira' | 'ado') => {
        vscodeApi.postMessage({ type: 'saveTrackerSecret', tracker });
    }, []);

    const handleTestTracker = useCallback((tracker: 'jira' | 'ado') => {
        dispatch({ type: 'TESTING_TRACKER', tracker });
        vscodeApi.postMessage({ type: 'testTrackerConnection', tracker });
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

                <RoutingSection config={state.config} availableModels={state.availableModels} onChangeConfig={setConfig} />

                <TrackerSection
                    config={state.config}
                    secretsPresent={state.secretsPresent}
                    testingTracker={state.testingTracker}
                    trackerStatus={state.trackerStatus}
                    onChangeConfig={setConfig}
                    onSaveTrackerSecret={handleSaveTrackerSecret}
                    onTestTracker={handleTestTracker}
                />

                <BudgetSection config={state.config} onChangeConfig={setConfig} />

                <TelemetrySection config={state.config} onChangeConfig={setConfig} />
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
    openrouter: { label: 'OpenRouter (API Key)', description: 'Access hundreds of models through one API. Live pricing shown in the model picker. Key stored in SecretStorage.', hasKey: true, hasBaseUrl: false },
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
        // Batch: mark as active AND ensure it is enabled, in a single update.
        onChangeConfig({
            ...config,
            ai: {
                ...config.ai,
                default_provider: id,
                providers: { ...config.ai.providers, [id]: { ...config.ai.providers[id], enabled: true } },
            },
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
                                        onChange={() => setActive(id)}
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

const ROUTING_TASKS: Array<{ key: keyof SettingsConfigData['ai']['routing']; label: string; defaultTier: 'quality' | 'cheap' }> = [
    { key: 'epic_generation',   label: 'Epic generation',       defaultTier: 'quality' },
    { key: 'story_generation',  label: 'Story generation',      defaultTier: 'quality' },
    { key: 'invest_validation', label: 'INVEST validation',     defaultTier: 'cheap'   },
    { key: 'story_splitting',   label: 'Story splitting',       defaultTier: 'cheap'   },
    { key: 'agent_prompt',      label: 'Agent prompt assembly', defaultTier: 'cheap'   },
    { key: 'agents_md',         label: 'AGENTS.md generation',  defaultTier: 'cheap'   },
];

function RoutingSection({
    config,
    availableModels,
    onChangeConfig,
}: {
    config: SettingsConfigData;
    availableModels: ModelOption[];
    onChangeConfig: (c: SettingsConfigData) => void;
}) {
    const setModel = (key: keyof SettingsConfigData['ai']['routing'], modelId: string) => {
        onChangeConfig({
            ...config,
            ai: { ...config.ai, routing: { ...config.ai.routing, [key]: modelId } },
        });
    };

    const hasModels = availableModels.length > 0;

    return (
        <Section title="Model Routing">
            <p className="section-desc">
                Choose a specific model for each task, or select <strong>auto</strong> to let Saga pick the best available model.
                Models are loaded from your enabled providers.
                {!hasModels && <span className="routing-no-models"> Enable at least one provider and save to see available models.</span>}
            </p>
            <div className="routing-grid">
                {ROUTING_TASKS.map(({ key, label }) => (
                    <div key={key} className="routing-row">
                        <label className="routing-label" htmlFor={`routing-${key}`}>{label}</label>
                        <select
                            id={`routing-${key}`}
                            className="input-select routing-select"
                            value={config.ai.routing[key]}
                            onChange={(e) => setModel(key, e.target.value)}
                        >
                            <option value="auto">auto — let Saga decide</option>
                            {availableModels.length > 0 && <option disabled>──────────</option>}
                            {availableModels.map((m) => (
                                <option key={`${m.provider}:${m.id}`} value={m.id}>
                                    {m.displayName}
                                </option>
                            ))}
                        </select>
                    </div>
                ))}
            </div>
        </Section>
    );
}

// ─── Tracker section ──────────────────────────────────────────────────────────

function TrackerSection({
    config,
    secretsPresent,
    testingTracker,
    trackerStatus,
    onChangeConfig,
    onSaveTrackerSecret,
    onTestTracker,
}: {
    config: SettingsConfigData;
    secretsPresent: Record<string, boolean>;
    testingTracker: 'jira' | 'ado' | null;
    trackerStatus: Partial<Record<'jira' | 'ado', { ok: boolean; message: string }>>;
    onChangeConfig: (c: SettingsConfigData) => void;
    onSaveTrackerSecret: (t: 'jira' | 'ado') => void;
    onTestTracker: (t: 'jira' | 'ado') => void;
}) {
    const setDefault = (value: 'jira' | 'ado' | 'none') => {
        onChangeConfig({ ...config, tracker: { ...config.tracker, default: value } });
    };
    const setJira = (patch: Partial<SettingsConfigData['tracker']['jira']>) => {
        onChangeConfig({ ...config, tracker: { ...config.tracker, jira: { ...config.tracker.jira, ...patch } } });
    };
    const setAdo = (patch: Partial<SettingsConfigData['tracker']['ado']>) => {
        onChangeConfig({ ...config, tracker: { ...config.tracker, ado: { ...config.tracker.ado, ...patch } } });
    };

    return (
        <Section title="Tracker">
            <p className="section-desc">Connect Saga to Jira Cloud or Azure DevOps to push epics and stories.</p>

            <div className="field">
                <label className="field-label">Default tracker</label>
                <select
                    className="input-select"
                    value={config.tracker.default}
                    onChange={(e) => setDefault(e.target.value as 'jira' | 'ado' | 'none')}
                >
                    <option value="none">None</option>
                    <option value="jira">Jira Cloud</option>
                    <option value="ado">Azure DevOps</option>
                </select>
            </div>

            {/* Jira config */}
            {config.tracker.default === 'jira' && (
                <div className="tracker-fields">
                    <h3 className="tracker-subheading">Jira Cloud</h3>
                    <TrackerField label="Base URL" placeholder="https://myorg.atlassian.net"
                        value={config.tracker.jira.base_url} onChange={(v) => setJira({ base_url: v })} />
                    <TrackerField label="Project Key" placeholder="PROJ"
                        value={config.tracker.jira.project_key} onChange={(v) => setJira({ project_key: v })} />
                    <TrackerField label="Email" placeholder="you@example.com"
                        value={config.tracker.jira.email} onChange={(v) => setJira({ email: v })} />

                    <div className="provider-key-row">
                        <span className="key-status">
                            {secretsPresent['jira'] ? '🔑 API token stored' : '⚠ No API token stored'}
                        </span>
                        <button className="btn-ghost" onClick={() => onSaveTrackerSecret('jira')}>
                            {secretsPresent['jira'] ? 'Update Token' : 'Add Token'}
                        </button>
                    </div>

                    <div className="field">
                        <label className="field-label">Epic link style</label>
                        <select className="input-select"
                            value={config.tracker.jira.epic_link_style}
                            onChange={(e) => setJira({ epic_link_style: e.target.value as 'parent' | 'customfield_10014' })}>
                            <option value="parent">Parent field (Next-Gen / Team-Managed)</option>
                            <option value="customfield_10014">Epic Link field (Classic)</option>
                        </select>
                    </div>

                    <div className="tracker-advanced">
                        <details>
                            <summary className="tracker-advanced-toggle">Advanced field settings</summary>
                            <div className="tracker-advanced-body">
                                <TrackerField label="Epic issue type" placeholder="Epic"
                                    value={config.tracker.jira.epic_issue_type} onChange={(v) => setJira({ epic_issue_type: v })} />
                                <TrackerField label="Story issue type" placeholder="Story"
                                    value={config.tracker.jira.story_issue_type} onChange={(v) => setJira({ story_issue_type: v })} />
                                <TrackerField label="Subtask issue type" placeholder="Sub-task"
                                    value={config.tracker.jira.subtask_issue_type} onChange={(v) => setJira({ subtask_issue_type: v })} />
                                <TrackerField label="Acceptance criteria field ID" placeholder="description"
                                    value={config.tracker.jira.ac_field_id} onChange={(v) => setJira({ ac_field_id: v })} />
                                <TrackerField
                                    label="Story points field ID (optional)"
                                    placeholder="e.g. customfield_10016 or customfield_10028"
                                    value={config.tracker.jira.story_points_field_id}
                                    onChange={(v) => setJira({ story_points_field_id: v })}
                                />
                            </div>
                        </details>
                    </div>

                    <TrackerTestButton tracker="jira" testing={testingTracker === 'jira'} status={trackerStatus['jira']} onTest={onTestTracker} />
                </div>
            )}

            {/* ADO config */}
            {config.tracker.default === 'ado' && (
                <div className="tracker-fields">
                    <h3 className="tracker-subheading">Azure DevOps</h3>
                    <TrackerField label="Organization URL" placeholder="https://dev.azure.com/myorg"
                        value={config.tracker.ado.org_url} onChange={(v) => setAdo({ org_url: v })} />
                    <TrackerField label="Project" placeholder="MyProject"
                        value={config.tracker.ado.project} onChange={(v) => setAdo({ project: v })} />
                    <TrackerField label="Area Path (optional)" placeholder="MyProject\\MyTeam"
                        value={config.tracker.ado.area_path} onChange={(v) => setAdo({ area_path: v })} />

                    <div className="provider-key-row">
                        <span className="key-status">
                            {secretsPresent['ado'] ? '🔑 PAT stored' : '⚠ No PAT stored'}
                        </span>
                        <button className="btn-ghost" onClick={() => onSaveTrackerSecret('ado')}>
                            {secretsPresent['ado'] ? 'Update PAT' : 'Add PAT'}
                        </button>
                    </div>

                    <div className="tracker-advanced">
                        <details>
                            <summary className="tracker-advanced-toggle">Advanced field settings</summary>
                            <div className="tracker-advanced-body">
                                <TrackerField label="Epic work item type" placeholder="Epic"
                                    value={config.tracker.ado.epic_work_item_type} onChange={(v) => setAdo({ epic_work_item_type: v })} />
                                <TrackerField label="Story work item type" placeholder="User Story"
                                    value={config.tracker.ado.story_work_item_type} onChange={(v) => setAdo({ story_work_item_type: v })} />
                            </div>
                        </details>
                    </div>

                    <TrackerTestButton tracker="ado" testing={testingTracker === 'ado'} status={trackerStatus['ado']} onTest={onTestTracker} />
                </div>
            )}
        </Section>
    );
}

function TrackerField({ label, placeholder, value, onChange }: {
    label: string; placeholder: string; value: string; onChange: (v: string) => void;
}) {
    return (
        <div className="field">
            <label className="field-label">{label}</label>
            <input className="input-text" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
        </div>
    );
}

function TrackerTestButton({ tracker, testing, status, onTest }: {
    tracker: 'jira' | 'ado';
    testing: boolean;
    status: { ok: boolean; message: string } | undefined;
    onTest: (t: 'jira' | 'ado') => void;
}) {
    return (
        <div className="tracker-test-row">
            <button className="btn-ghost" onClick={() => onTest(tracker)} disabled={testing}>
                {testing ? 'Testing…' : 'Test Connection'}
            </button>
            {status && (
                <span className={`provider-status-msg provider-status-msg--${status.ok ? 'connected' : 'unreachable'}`}>
                    {status.ok ? '✓' : '✗'} {status.message}
                </span>
            )}
        </div>
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

function TelemetrySection({ config, onChangeConfig }: { config: SettingsConfigData; onChangeConfig: (c: SettingsConfigData) => void }) {
    const setTelemetry = (enabled: boolean) => {
        onChangeConfig({ ...config, telemetry: { enabled } });
    };

    return (
        <Section title="Telemetry">
            <p className="section-desc">
                Anonymous local event logging — command name, provider type, story count. Never your story titles,
                descriptions, or context files. Off by default. Currently logs to the Saga Output Channel only —
                no data leaves your machine.
            </p>
            <div className="field">
                <label className="toggle-label">
                    <input
                        type="checkbox"
                        checked={config.telemetry.enabled}
                        onChange={(e) => setTelemetry(e.target.checked)}
                    />
                    Enable anonymous usage logging
                </label>
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
