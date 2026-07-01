import Anthropic from '@anthropic-ai/sdk';
import type {
    LLMMessage,
    LLMModelInfo,
    LLMProvider,
    LLMRequestOptions,
    LLMResponse,
} from './provider';

// Curated list — Anthropic's /models endpoint exists but is account-gated.
// We list the current production models; users can override the routing config with any ID.
const KNOWN_MODELS: LLMModelInfo[] = [
    { id: 'claude-opus-4-8',      displayName: 'Claude Opus 4.8 (Anthropic)',   tier: 'quality' },
    { id: 'claude-sonnet-4-6',    displayName: 'Claude Sonnet 4.6 (Anthropic)', tier: 'quality' },
    { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5 (Anthropic)', tier: 'cheap' },
];

/**
 * Anthropic BYOK adapter.
 * The key-getter callback is injected at construction so the adapter stays
 * decoupled from VS Code APIs and is fully testable without SecretStorage.
 */
export class AnthropicProvider implements LLMProvider {
    readonly id = 'anthropic';
    readonly displayName = 'Anthropic (API key)';

    constructor(
        private readonly getKey: () => Promise<string | undefined>,
        private readonly preferredModel?: string,
    ) {}

    async isAvailable(): Promise<boolean> {
        const key = await this.getKey();
        return typeof key === 'string' && key.trim().length > 0;
    }

    async listModels(): Promise<LLMModelInfo[]> {
        return KNOWN_MODELS;
    }

    async generate(options: LLMRequestOptions): Promise<LLMResponse> {
        const client = await this.buildClient();
        const model = this.preferredModel ?? 'claude-sonnet-4-6';

        const response = await client.messages.create(
            {
                model,
                max_tokens: options.maxTokens ?? 4096,
                temperature: options.temperature,
                messages: toAnthropicMessages(options.messages),
            },
            { signal: options.signal },
        );

        const content = response.content
            .filter((b) => b.type === 'text')
            .map((b) => (b as { type: 'text'; text: string }).text)
            .join('');

        return {
            content,
            usage: response.usage
                ? {
                      inputTokens: response.usage.input_tokens ?? 0,
                      outputTokens: response.usage.output_tokens,
                      estimated: false,
                  }
                : undefined,
        };
    }

    async *stream(options: LLMRequestOptions): AsyncIterable<string> {
        const client = await this.buildClient();
        const model = this.preferredModel ?? 'claude-sonnet-4-6';

        const stream = await client.messages.stream(
            {
                model,
                max_tokens: options.maxTokens ?? 4096,
                temperature: options.temperature,
                messages: toAnthropicMessages(options.messages),
            },
            { signal: options.signal },
        );

        for await (const event of stream) {
            if (
                event.type === 'content_block_delta' &&
                event.delta.type === 'text_delta'
            ) {
                yield event.delta.text;
            }
        }
    }

    async countTokens(messages: LLMMessage[]): Promise<number> {
        const client = await this.buildClient();
        const model = this.preferredModel ?? 'claude-sonnet-4-6';
        const result = await client.messages.countTokens({
            model,
            messages: toAnthropicMessages(messages),
        });
        return result.input_tokens;
    }

    private async buildClient(): Promise<Anthropic> {
        const key = await this.getKey();
        if (!key) {
            throw new Error(
                'Anthropic API key not found. Add your key via Saga Settings → AI Provider → Anthropic.',
            );
        }
        return new Anthropic({ apiKey: key });
    }
}

function toAnthropicMessages(
    messages: LLMMessage[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
    const result: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const m of messages) {
        if (m.role === 'system') {
            // Anthropic doesn't have a system message in the messages array;
            // prepend as a user turn so the instruction still reaches the model.
            result.push({ role: 'user', content: `[SYSTEM]\n${m.content}` });
        } else {
            result.push({ role: m.role, content: m.content });
        }
    }
    return result;
}
