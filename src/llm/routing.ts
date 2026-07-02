import * as vscode from 'vscode';
import { LLMProvider, LLMModelInfo } from './provider';
import { VsCodeLmProvider } from './vscode-lm';
import { LocalLmProvider } from './local';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { OpenAIByokProvider } from './openai-byok';
import { OpenRouterProvider } from './openrouter';
import { SecretsManager, SecretKey } from '../secrets';
import { readConfig, getSagaRoot } from '../saga-repo';

export type RoutingTask =
    | 'epic_generation'
    | 'story_generation'
    | 'invest_validation'
    | 'story_splitting'
    | 'agent_prompt'
    | 'agents_md'
    | 'subtask_generation';

export interface ResolvedProvider {
    provider: LLMProvider;
    /** Human-readable label shown in progress notifications and panel headers. */
    modelLabel: string;
}

/**
 * Reads config.yaml and returns the provider + model label for the given task.
 * Falls back gracefully: configured model → auto-tier → first available.
 * Never throws — always returns something or undefined if no provider is reachable.
 *
 * Pass `secrets` so BYOK providers (Anthropic, Gemini, OpenAI) can retrieve
 * their keys from SecretStorage. Without it, only VS Code LM and local work.
 */
export async function resolveProviderFromConfig(
    task: RoutingTask,
    workspaceRoot: vscode.Uri,
    secrets?: SecretsManager,
): Promise<ResolvedProvider | undefined> {
    const sagaRoot = getSagaRoot(workspaceRoot);

    let config;
    try {
        config = await readConfig(sagaRoot);
    } catch {
        // config.yaml missing or malformed — fall back to defaults
    }

    const defaultProviderId = config?.ai.default_provider ?? 'vscode-lm';
    const routingValue = config?.ai.routing?.[task] ?? 'auto'; // model ID or "auto"
    const localBaseUrl = config?.ai.providers?.local?.base_url ?? 'http://localhost:11434/v1';

    // Build candidates in config-defined fallback order
    const fallbackOrder: string[] = config?.ai.fallback_order?.length
        ? config.ai.fallback_order
        : [defaultProviderId, 'vscode-lm', 'local'];

    // Deduplicate while keeping order, always trying defaultProvider first
    const ordered = dedupe([defaultProviderId, ...fallbackOrder]);

    for (const providerId of ordered) {
        const candidate = buildProvider(providerId, localBaseUrl, routingValue, secrets);
        if (!candidate) { continue; }

        const available = await candidate.provider.isAvailable();
        if (!available) { continue; }

        // If routing is a specific model ID (not "auto"), verify it exists.
        // Skip verification for vscode-lm (family matching, not exact IDs)
        // and for OpenAI/OpenRouter whose listModels() is network-only and may be slow.
        if (routingValue !== 'auto' && providerId !== 'vscode-lm' && providerId !== 'openai' && providerId !== 'openrouter') {
            try {
                const models: LLMModelInfo[] = await candidate.provider.listModels();
                const match = models.find((m) => m.id === routingValue);
                if (!match) {
                    // Model not found on this provider — try next
                    continue;
                }
            } catch {
                // listModels failed — proceed anyway with the model hint
            }
        }

        return candidate;
    }

    return undefined;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildProvider(
    providerId: string,
    localBaseUrl: string,
    modelHint: string,
    secrets?: SecretsManager,
): ResolvedProvider | undefined {
    const model = modelHint !== 'auto' ? modelHint : undefined;

    switch (providerId) {
        case 'vscode-lm': {
            const p = new VsCodeLmProvider(model);
            const label = model ? `${model} (Copilot)` : 'Copilot (auto)';
            return { provider: p, modelLabel: label };
        }
        case 'local': {
            const p = new LocalLmProvider(localBaseUrl, 'ollama', model);
            const label = model ? `${model} (Local)` : 'Local (auto)';
            return { provider: p, modelLabel: label };
        }
        case 'anthropic': {
            if (!secrets) { return undefined; }
            const getKey = () => secrets.get(SecretKey.ANTHROPIC_API_KEY);
            const p = new AnthropicProvider(getKey, model);
            const label = model ? `${model} (Anthropic)` : 'Anthropic (auto)';
            return { provider: p, modelLabel: label };
        }
        case 'gemini': {
            if (!secrets) { return undefined; }
            const getKey = () => secrets.get(SecretKey.GEMINI_API_KEY);
            const p = new GeminiProvider(getKey, model);
            const label = model ? `${model} (Gemini)` : 'Gemini (auto)';
            return { provider: p, modelLabel: label };
        }
        case 'openai': {
            if (!secrets) { return undefined; }
            const getKey = () => secrets.get(SecretKey.OPENAI_API_KEY);
            const p = new OpenAIByokProvider(getKey, model);
            const label = model ? `${model} (OpenAI)` : 'OpenAI (auto)';
            return { provider: p, modelLabel: label };
        }
        case 'openrouter': {
            if (!secrets) { return undefined; }
            const getKey = () => secrets.get(SecretKey.OPENROUTER_API_KEY);
            const p = new OpenRouterProvider(getKey, model);
            const label = model ? `${model} (OpenRouter)` : 'OpenRouter (auto)';
            return { provider: p, modelLabel: label };
        }
        default:
            return undefined;
    }
}

function dedupe(arr: string[]): string[] {
    return [...new Set(arr)];
}
