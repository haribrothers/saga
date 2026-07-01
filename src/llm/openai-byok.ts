import OpenAI from 'openai';
import type {
    LLMMessage,
    LLMModelInfo,
    LLMProvider,
    LLMRequestOptions,
    LLMResponse,
} from './provider';

/**
 * OpenAI BYOK adapter.
 * Fetches the live model list from /models so it stays current without code
 * changes. Key injected via callback — no VS Code dependency.
 */
export class OpenAIByokProvider implements LLMProvider {
    readonly id = 'openai';
    readonly displayName = 'OpenAI (API key)';

    constructor(
        private readonly getKey: () => Promise<string | undefined>,
        private readonly preferredModel?: string,
    ) {}

    async isAvailable(): Promise<boolean> {
        const key = await this.getKey();
        return typeof key === 'string' && key.trim().length > 0;
    }

    async listModels(): Promise<LLMModelInfo[]> {
        const client = await this.buildClient();
        const page = await client.models.list();
        const models: LLMModelInfo[] = [];
        for await (const m of page) {
            // Only surface chat-capable models (filter out embeddings, TTS, image gen, etc.)
            if (!isChatModel(m.id)) { continue; }
            models.push({ id: m.id, displayName: `${m.id} (OpenAI)`, tier: inferTier(m.id) });
        }
        // Stable sort: quality tier first, then alphabetically within tier.
        models.sort((a, b) => {
            if (a.tier === b.tier) { return a.id.localeCompare(b.id); }
            return a.tier === 'quality' ? -1 : 1;
        });
        return models;
    }

    async generate(options: LLMRequestOptions): Promise<LLMResponse> {
        const client = await this.buildClient();
        const model = this.preferredModel ?? 'gpt-4o';

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
        const model = this.preferredModel ?? 'gpt-4o';

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
        // OpenAI doesn't expose a standalone token-counting endpoint.
        // Approximate with ~4 chars/token (consistent with LocalLmProvider).
        const total = messages.reduce((sum, m) => sum + m.content.length, 0);
        return Math.ceil(total / 4);
    }

    private async buildClient(): Promise<OpenAI> {
        const key = await this.getKey();
        if (!key) {
            throw new Error(
                'OpenAI API key not found. Add your key via Saga Settings → AI Provider → OpenAI.',
            );
        }
        return new OpenAI({ apiKey: key });
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toOpenAIMessages(
    messages: LLMMessage[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map((m) => ({ role: m.role, content: m.content }));
}

function isChatModel(id: string): boolean {
    const lower = id.toLowerCase();
    // Exclude known non-chat model families by prefix/suffix
    const excluded = ['whisper', 'tts', 'dall-e', 'text-embedding', 'babbage', 'davinci', 'curie', 'ada'];
    return !excluded.some((ex) => lower.includes(ex));
}

function inferTier(modelId: string): LLMModelInfo['tier'] {
    const lower = modelId.toLowerCase();
    // Check mini/cheap variants first — they're substrings of quality names (e.g. "gpt-4o-mini" ⊃ "gpt-4o")
    if (lower.includes('gpt-4o-mini') || lower.includes('gpt-3.5') || lower.includes('o1-mini') || lower.includes('o3-mini')) {
        return 'cheap';
    }
    if (lower.includes('gpt-4o') || lower.includes('gpt-4') || lower.includes('o1') || lower.includes('o3')) {
        return 'quality';
    }
    return 'unknown';
}
