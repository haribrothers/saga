import type {
    LLMMessage,
    LLMModelInfo,
    LLMProvider,
    LLMRequestOptions,
    LLMResponse,
} from './provider';

// @google/genai is an ESM-only package; use a dynamic import to avoid the
// CommonJS/ESM mismatch that a static import produces.
// Typed as `any` — the call shapes are validated at runtime by the SDK.
type GoogleGenAI = any;
async function loadGenAI(apiKey: string): Promise<GoogleGenAI> {
    // Function() wrapping prevents esbuild/tsc from rewriting this to a static require().
    const mod = await (Function('return import("@google/genai")')() as Promise<any>);
    return new mod.GoogleGenAI({ apiKey });
}

// Curated list of current production Gemini models.
const KNOWN_MODELS: LLMModelInfo[] = [
    { id: 'gemini-2.5-pro',   displayName: 'Gemini 2.5 Pro (Google)',   tier: 'quality' },
    { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash (Google)', tier: 'cheap'   },
    { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash (Google)', tier: 'cheap'   },
];

/**
 * Google Gemini BYOK adapter.
 * Uses the @google/genai SDK (v2+). Key injected via callback — no VS Code
 * dependency so the adapter is fully testable in isolation.
 */
export class GeminiProvider implements LLMProvider {
    readonly id = 'gemini';
    readonly displayName = 'Google Gemini (API key)';

    constructor(
        private readonly getKey: () => Promise<string | undefined>,
        private readonly preferredModel?: string,
        /** Injected client — used in tests to avoid the ESM dynamic import. */
        private readonly clientOverride?: GoogleGenAI,
    ) {}

    async isAvailable(): Promise<boolean> {
        const key = await this.getKey();
        return typeof key === 'string' && key.trim().length > 0;
    }

    async listModels(): Promise<LLMModelInfo[]> {
        return KNOWN_MODELS;
    }

    async generate(options: LLMRequestOptions): Promise<LLMResponse> {
        const ai = await this.buildClient();
        const model = this.preferredModel ?? 'gemini-2.5-flash';

        const { systemInstruction, userContents } = splitMessages(options.messages);

        const response = await ai.models.generateContent({
            model,
            contents: userContents,
            config: {
                ...(systemInstruction ? { systemInstruction } : {}),
                maxOutputTokens: options.maxTokens,
                temperature: options.temperature,
                abortSignal: options.signal,
            },
        });

        const content = response.text ?? '';
        const meta = response.usageMetadata;

        return {
            content,
            usage: meta
                ? {
                      inputTokens: meta.promptTokenCount ?? 0,
                      outputTokens: meta.candidatesTokenCount ?? 0,
                      estimated: false,
                  }
                : undefined,
        };
    }

    async *stream(options: LLMRequestOptions): AsyncIterable<string> {
        const ai = await this.buildClient();
        const model = this.preferredModel ?? 'gemini-2.5-flash';

        const { systemInstruction, userContents } = splitMessages(options.messages);

        const streamGen = await ai.models.generateContentStream({
            model,
            contents: userContents,
            config: {
                ...(systemInstruction ? { systemInstruction } : {}),
                maxOutputTokens: options.maxTokens,
                temperature: options.temperature,
                abortSignal: options.signal,
            },
        });

        for await (const chunk of streamGen) {
            const text = chunk.text;
            if (text) {
                yield text;
            }
        }
    }

    async countTokens(messages: LLMMessage[]): Promise<number> {
        const ai = await this.buildClient();
        const model = this.preferredModel ?? 'gemini-2.5-flash';
        const { userContents } = splitMessages(messages);
        const result = await ai.models.countTokens({ model, contents: userContents });
        return result.totalTokens ?? 0;
    }

    private async buildClient(): Promise<GoogleGenAI> {
        if (this.clientOverride) { return this.clientOverride; }
        const key = await this.getKey();
        if (!key) {
            throw new Error(
                'Gemini API key not found. Add your key via Saga Settings → AI Provider → Google Gemini.',
            );
        }
        return loadGenAI(key);
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface SplitResult {
    systemInstruction: string | undefined;
    userContents: string;
}

/**
 * Gemini separates system instructions from the conversation contents.
 * We concatenate all system messages into the systemInstruction field and
 * join the remaining turns into a single user string (Saga uses single-turn
 * prompts so multi-turn interleaving is not needed here).
 */
function splitMessages(messages: LLMMessage[]): SplitResult {
    const systemParts: string[] = [];
    const otherParts: string[] = [];

    for (const m of messages) {
        if (m.role === 'system') {
            systemParts.push(m.content);
        } else {
            otherParts.push(m.content);
        }
    }

    return {
        systemInstruction: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
        userContents: otherParts.join('\n\n'),
    };
}
