export interface LLMMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface LLMRequestOptions {
    messages: LLMMessage[];
    /** Max tokens to generate. Provider-specific default if omitted. */
    maxTokens?: number;
    /** 0–1 temperature. Provider-specific default if omitted. */
    temperature?: number;
    /** Caller-supplied abort signal. */
    signal?: AbortSignal;
}

export interface LLMResponse {
    content: string;
    /** Tokens consumed, when the provider reports them. */
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
}

export interface LLMModelInfo {
    id: string;
    displayName: string;
    /** 'quality' maps to Sonnet-class; 'cheap' maps to Haiku/Flash-class. */
    tier: 'quality' | 'cheap' | 'unknown';
}

/**
 * Provider-agnostic LLM interface. All adapters (VS Code LM, local, BYOK)
 * implement this so the rest of the codebase never imports provider SDKs directly.
 */
export interface LLMProvider {
    readonly id: string;
    readonly displayName: string;

    /** Returns true if the provider is currently usable (credentials present, endpoint reachable). */
    isAvailable(): Promise<boolean>;

    /** List models available on this provider. */
    listModels(): Promise<LLMModelInfo[]>;

    /** Single-turn (or multi-turn) completion. */
    generate(options: LLMRequestOptions): Promise<LLMResponse>;

    /** Streaming completion — yields partial content strings. */
    stream(options: LLMRequestOptions): AsyncIterable<string>;

    /** Estimate token count for a set of messages without sending them. */
    countTokens(messages: LLMMessage[]): Promise<number>;
}

export type ProviderTier = 'quality' | 'cheap';

/** Picks the best available provider from an ordered list. */
export async function resolveProvider(
    ordered: LLMProvider[],
): Promise<LLMProvider | undefined> {
    for (const p of ordered) {
        if (await p.isAvailable()) {
            return p;
        }
    }
    return undefined;
}
