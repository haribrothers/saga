import type {
    LLMMessage,
    LLMModelInfo,
    LLMProvider,
    LLMRequestOptions,
    LLMResponse,
} from './provider';

interface OpenAIModel {
    id: string;
}

interface OpenAIModelsResponse {
    data: OpenAIModel[];
}

interface OpenAIChatChoice {
    message: { content: string };
}

interface OpenAIChatResponse {
    choices: OpenAIChatChoice[];
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
    };
}

interface OpenAIChatStreamDelta {
    choices: Array<{ delta: { content?: string } }>;
}

/**
 * Local OpenAI-compatible adapter. Works with Ollama (default: http://localhost:11434/v1)
 * and LM Studio (default: http://localhost:1234/v1). No API key required in the normal case.
 */
export class LocalLmProvider implements LLMProvider {
    readonly id = 'local';
    readonly displayName: string;

    constructor(
        private readonly baseUrl: string = 'http://localhost:11434/v1',
        private readonly apiKey: string = 'ollama',
        private readonly preferredModel?: string,
    ) {
        this.displayName = `Local LM (${baseUrl})`;
    }

    async isAvailable(): Promise<boolean> {
        try {
            const res = await fetch(`${this.baseUrl}/models`, {
                headers: this.headers(),
                signal: AbortSignal.timeout(3000),
            });
            return res.ok;
        } catch {
            return false;
        }
    }

    async listModels(): Promise<LLMModelInfo[]> {
        const res = await fetch(`${this.baseUrl}/models`, {
            headers: this.headers(),
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
            throw new Error(`Local LM /models returned ${res.status}`);
        }
        const body = (await res.json()) as OpenAIModelsResponse;
        return body.data.map((m) => ({
            id: m.id,
            displayName: m.id,
            tier: inferLocalTier(m.id),
        }));
    }

    async generate(options: LLMRequestOptions): Promise<LLMResponse> {
        const model = await this.resolveModel();
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { ...this.headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: toOpenAIMessages(options.messages),
                max_tokens: options.maxTokens,
                temperature: options.temperature,
                stream: false,
            }),
            signal: options.signal ?? AbortSignal.timeout(120_000),
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Local LM error ${res.status}: ${text}`);
        }

        const body = (await res.json()) as OpenAIChatResponse;
        const content = body.choices[0]?.message.content ?? '';
        return {
            content,
            usage: body.usage
                ? {
                      inputTokens: body.usage.prompt_tokens,
                      outputTokens: body.usage.completion_tokens,
                  }
                : undefined,
        };
    }

    async *stream(options: LLMRequestOptions): AsyncIterable<string> {
        const model = await this.resolveModel();
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { ...this.headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: toOpenAIMessages(options.messages),
                max_tokens: options.maxTokens,
                temperature: options.temperature,
                stream: true,
            }),
            signal: options.signal ?? AbortSignal.timeout(120_000),
        });

        if (!res.ok || !res.body) {
            throw new Error(`Local LM stream error ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) {
                    continue;
                }
                const data = trimmed.slice(5).trim();
                if (data === '[DONE]') {
                    return;
                }
                try {
                    const parsed = JSON.parse(data) as OpenAIChatStreamDelta;
                    const chunk = parsed.choices[0]?.delta?.content;
                    if (chunk) {
                        yield chunk;
                    }
                } catch {
                    // malformed SSE line — skip
                }
            }
        }
    }

    async countTokens(messages: LLMMessage[]): Promise<number> {
        // Local models don't universally expose a token-counting endpoint.
        // Approximate: ~1 token per 4 characters (rough tiktoken heuristic).
        const total = messages.reduce((sum, m) => sum + m.content.length, 0);
        return Math.ceil(total / 4);
    }

    private headers(): Record<string, string> {
        return { Authorization: `Bearer ${this.apiKey}` };
    }

    private async resolveModel(): Promise<string> {
        if (this.preferredModel) {
            return this.preferredModel;
        }
        const models = await this.listModels();
        if (models.length === 0) {
            throw new Error(
                `No models found at ${this.baseUrl}. Pull a model first (e.g. ollama pull qwen2.5-coder).`,
            );
        }
        return models[0].id;
    }
}

function toOpenAIMessages(
    messages: LLMMessage[],
): Array<{ role: string; content: string }> {
    return messages.map((m) => ({ role: m.role, content: m.content }));
}

function inferLocalTier(modelId: string): LLMModelInfo['tier'] {
    const lower = modelId.toLowerCase();
    if (
        lower.includes('70b') ||
        lower.includes('72b') ||
        lower.includes('32b') ||
        lower.includes('pro') ||
        lower.includes('sonnet')
    ) {
        return 'quality';
    }
    if (
        lower.includes('7b') ||
        lower.includes('8b') ||
        lower.includes('3b') ||
        lower.includes('flash') ||
        lower.includes('mini')
    ) {
        return 'cheap';
    }
    return 'unknown';
}
