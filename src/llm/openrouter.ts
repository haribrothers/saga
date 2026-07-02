import OpenAI from 'openai';
import type {
    LLMMessage,
    LLMModelInfo,
    LLMProvider,
    LLMRequestOptions,
    LLMResponse,
} from './provider';

const BASE_URL = 'https://openrouter.ai/api/v1';

/** OpenRouter model list response — richer than OpenAI's, includes pricing. */
interface OpenRouterModel {
    id: string;
    name?: string;
    pricing?: { prompt?: string; completion?: string };
}

interface OpenRouterModelsResponse {
    data: OpenRouterModel[];
}

/**
 * OpenRouter BYOK adapter. OpenAI-compatible chat completions API at
 * https://openrouter.ai/api/v1, proxying to hundreds of underlying models.
 * Requires HTTP-Referer + X-Title headers per OpenRouter's app attribution policy.
 * Key injected via callback — no VS Code dependency, matching the other BYOK adapters.
 */
export class OpenRouterProvider implements LLMProvider {
    readonly id = 'openrouter';
    readonly displayName = 'OpenRouter (API key)';

    constructor(
        private readonly getKey: () => Promise<string | undefined>,
        private readonly preferredModel?: string,
    ) {}

    async isAvailable(): Promise<boolean> {
        const key = await this.getKey();
        return typeof key === 'string' && key.trim().length > 0;
    }

    /**
     * Live model list with pricing metadata. Uses fetch() directly rather than
     * the OpenAI SDK's models.list() because OpenRouter's response includes a
     * `pricing` field the SDK's typed client doesn't surface.
     */
    async listModels(): Promise<LLMModelInfo[]> {
        const key = await this.getKey();
        if (!key) { return []; }

        const res = await fetch(`${BASE_URL}/models`, {
            headers: this.headers(key),
        });
        if (!res.ok) {
            throw new Error(`OpenRouter models list failed: ${res.status} ${res.statusText}`);
        }
        const body = (await res.json()) as OpenRouterModelsResponse;

        return body.data.map((m) => {
            const promptPrice = m.pricing?.prompt ? Number(m.pricing.prompt) : undefined;
            const priceLabel = promptPrice !== undefined && !Number.isNaN(promptPrice)
                ? ` — $${(promptPrice * 1_000_000).toFixed(2)}/M in`
                : '';
            return {
                id: m.id,
                displayName: `${m.name ?? m.id} (OpenRouter)${priceLabel}`,
                tier: inferTier(m.id),
            };
        });
    }

    async generate(options: LLMRequestOptions): Promise<LLMResponse> {
        const client = await this.buildClient();
        const model = this.preferredModel ?? 'openai/gpt-4o';

        const completion = await client.chat.completions.create(
            {
                model,
                messages: toOpenAIMessages(options.messages),
                max_tokens: options.maxTokens,
                temperature: options.temperature,
            },
            { signal: options.signal },
        );

        const content = completion.choices[0]?.message.content ?? '';
        const usage = completion.usage;

        return {
            content,
            usage: usage
                ? {
                      inputTokens: usage.prompt_tokens,
                      outputTokens: usage.completion_tokens,
                      estimated: false,
                  }
                : undefined,
        };
    }

    async *stream(options: LLMRequestOptions): AsyncIterable<string> {
        const client = await this.buildClient();
        const model = this.preferredModel ?? 'openai/gpt-4o';

        const stream = await client.chat.completions.create(
            {
                model,
                messages: toOpenAIMessages(options.messages),
                max_tokens: options.maxTokens,
                temperature: options.temperature,
                stream: true,
            },
            { signal: options.signal },
        );

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta.content;
            if (delta) {
                yield delta;
            }
        }
    }

    async countTokens(messages: LLMMessage[]): Promise<number> {
        // OpenRouter doesn't expose a standalone token-counting endpoint.
        // Approximate with ~4 chars/token (consistent with the other BYOK adapters).
        const total = messages.reduce((sum, m) => sum + m.content.length, 0);
        return Math.ceil(total / 4);
    }

    private async buildClient(): Promise<OpenAI> {
        const key = await this.getKey();
        if (!key) {
            throw new Error(
                'OpenRouter API key not found. Add your key via Saga Settings → AI Provider → OpenRouter.',
            );
        }
        return new OpenAI({
            apiKey: key,
            baseURL: BASE_URL,
            defaultHeaders: {
                'HTTP-Referer': 'vscode-saga',
                'X-Title': 'Saga',
            },
        });
    }

    private headers(key: string): Record<string, string> {
        return {
            'Authorization': `Bearer ${key}`,
            'HTTP-Referer': 'vscode-saga',
            'X-Title': 'Saga',
        };
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toOpenAIMessages(
    messages: LLMMessage[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map((m) => ({ role: m.role, content: m.content }));
}

function inferTier(modelId: string): LLMModelInfo['tier'] {
    const lower = modelId.toLowerCase();
    if (lower.includes('mini') || lower.includes('haiku') || lower.includes('flash') || lower.includes('small')) {
        return 'cheap';
    }
    if (lower.includes('opus') || lower.includes('sonnet') || lower.includes('gpt-4') || lower.includes('o1') || lower.includes('o3') || lower.includes('pro')) {
        return 'quality';
    }
    return 'unknown';
}
