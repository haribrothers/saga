import * as vscode from 'vscode';
import { LLMProvider, LLMModelInfo } from './provider';
import { VsCodeLmProvider } from './vscode-lm';
import { LocalLmProvider } from './local';
import { readConfig, getSagaRoot } from '../saga-repo';

export type RoutingTask =
    | 'epic_generation'
    | 'story_generation'
    | 'invest_validation'
    | 'story_splitting'
    | 'agent_prompt'
    | 'agents_md';

export interface ResolvedProvider {
    provider: LLMProvider;
    /** Human-readable label shown in progress notifications and panel headers. */
    modelLabel: string;
}

/**
 * Reads config.yaml and returns the provider + model label for the given task.
 * Falls back gracefully: configured model → auto-tier → first available.
 * Never throws — always returns something or undefined if no provider is reachable.
 */
export async function resolveProviderFromConfig(
    task: RoutingTask,
    workspaceRoot: vscode.Uri,
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
        const candidate = buildProvider(providerId, localBaseUrl, routingValue);
        if (!candidate) { continue; }

        const available = await candidate.provider.isAvailable();
        if (!available) { continue; }

        // If routing is a specific model ID (not "auto"), verify it exists
        if (routingValue !== 'auto' && providerId !== 'vscode-lm') {
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
): ResolvedProvider | undefined {
    switch (providerId) {
        case 'vscode-lm': {
            const p = new VsCodeLmProvider(modelHint !== 'auto' ? modelHint : undefined);
            const label = modelHint !== 'auto' ? `${modelHint} (Copilot)` : 'Copilot (auto)';
            return { provider: p, modelLabel: label };
        }
        case 'local': {
            const model = modelHint !== 'auto' ? modelHint : undefined;
            const p = new LocalLmProvider(localBaseUrl, 'ollama', model);
            const label = model ? `${model} (Local)` : 'Local (auto)';
            return { provider: p, modelLabel: label };
        }
        // BYOK providers not yet wired (M4) — skip silently
        case 'anthropic':
        case 'gemini':
        case 'openai':
            return undefined;
        default:
            return undefined;
    }
}

function dedupe(arr: string[]): string[] {
    return [...new Set(arr)];
}
