import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiProvider } from './gemini';

// ─── Fake client ──────────────────────────────────────────────────────────────
// We inject a fake GoogleGenAI client via the third constructor arg so the
// ESM dynamic import is never executed during tests.

const mockGenerateContent = vi.fn();
const mockGenerateContentStream = vi.fn();
const mockCountTokens = vi.fn();

const fakeClient = {
    models: {
        generateContent: mockGenerateContent,
        generateContentStream: mockGenerateContentStream,
        countTokens: mockCountTokens,
    },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const KEY = 'AIza-test-key';
const withKey = () => Promise.resolve(KEY);
const noKey = () => Promise.resolve(undefined);

const userMsg = { role: 'user' as const, content: 'Hello' };
const systemMsg = { role: 'system' as const, content: 'Be concise' };

/** Build a provider with the fake client pre-injected. */
const make = (model?: string) => new GeminiProvider(withKey, model, fakeClient);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GeminiProvider', () => {
    beforeEach(() => vi.clearAllMocks());

    // isAvailable — does NOT use the client (key-only check)
    it('isAvailable returns true when key is present', async () => {
        const p = new GeminiProvider(withKey);
        expect(await p.isAvailable()).toBe(true);
    });

    it('isAvailable returns false when key is absent', async () => {
        const p = new GeminiProvider(noKey);
        expect(await p.isAvailable()).toBe(false);
    });

    it('isAvailable returns false for whitespace-only key', async () => {
        const p = new GeminiProvider(() => Promise.resolve('   '));
        expect(await p.isAvailable()).toBe(false);
    });

    // listModels
    it('listModels returns curated Gemini models', async () => {
        const p = make();
        const models = await p.listModels();
        expect(models.length).toBeGreaterThan(0);
        const ids = models.map((m) => m.id);
        expect(ids).toContain('gemini-2.5-pro');
        expect(ids).toContain('gemini-2.5-flash');
    });

    it('listModels marks pro as quality and flash as cheap', async () => {
        const p = make();
        const models = await p.listModels();
        expect(models.find((m) => m.id === 'gemini-2.5-pro')?.tier).toBe('quality');
        expect(models.find((m) => m.id === 'gemini-2.5-flash')?.tier).toBe('cheap');
    });

    // generate — token usage
    it('generate returns content and token usage from usageMetadata', async () => {
        mockGenerateContent.mockResolvedValue({
            text: 'pong',
            usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4 },
        });
        const p = make();
        const result = await p.generate({ messages: [userMsg] });

        expect(result.content).toBe('pong');
        expect(result.usage).toEqual({ inputTokens: 8, outputTokens: 4, estimated: false });
    });

    it('generate handles missing usageMetadata gracefully', async () => {
        mockGenerateContent.mockResolvedValue({ text: 'ok' });
        const p = make();
        const result = await p.generate({ messages: [userMsg] });
        expect(result.usage).toBeUndefined();
    });

    it('generate handles undefined text gracefully', async () => {
        mockGenerateContent.mockResolvedValue({
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 0 },
        });
        const p = make();
        const result = await p.generate({ messages: [userMsg] });
        expect(result.content).toBe('');
    });

    // generate — message splitting
    it('generate passes system message as systemInstruction', async () => {
        mockGenerateContent.mockResolvedValue({ text: 'ok' });
        const p = make();
        await p.generate({ messages: [systemMsg, userMsg] });

        const call = mockGenerateContent.mock.calls[0][0];
        expect(call.config.systemInstruction).toBe('Be concise');
        expect(call.contents).toBe('Hello');
    });

    it('generate omits systemInstruction when no system message present', async () => {
        mockGenerateContent.mockResolvedValue({ text: 'ok' });
        const p = make();
        await p.generate({ messages: [userMsg] });

        const call = mockGenerateContent.mock.calls[0][0];
        expect(call.config.systemInstruction).toBeUndefined();
    });

    it('generate passes maxOutputTokens and temperature', async () => {
        mockGenerateContent.mockResolvedValue({ text: 'ok' });
        const p = make();
        await p.generate({ messages: [userMsg], maxTokens: 1024, temperature: 0.5 });

        const call = mockGenerateContent.mock.calls[0][0];
        expect(call.config.maxOutputTokens).toBe(1024);
        expect(call.config.temperature).toBe(0.5);
    });

    it('generate uses preferred model when set', async () => {
        mockGenerateContent.mockResolvedValue({ text: 'ok' });
        const p = make('gemini-2.0-flash');
        await p.generate({ messages: [userMsg] });
        expect(mockGenerateContent.mock.calls[0][0].model).toBe('gemini-2.0-flash');
    });

    it('generate defaults to gemini-2.5-flash when no model is set', async () => {
        mockGenerateContent.mockResolvedValue({ text: 'ok' });
        const p = make();
        await p.generate({ messages: [userMsg] });
        expect(mockGenerateContent.mock.calls[0][0].model).toBe('gemini-2.5-flash');
    });

    it('generate throws when key is missing and no client override', async () => {
        const p = new GeminiProvider(noKey);
        await expect(p.generate({ messages: [userMsg] })).rejects.toThrow('Gemini API key not found');
    });

    // stream
    it('stream yields text from each chunk', async () => {
        async function* fakeStream() {
            yield { text: 'chunk1' };
            yield { text: 'chunk2' };
            yield { text: undefined };
        }
        mockGenerateContentStream.mockResolvedValue(fakeStream());

        const p = make();
        const chunks: string[] = [];
        for await (const chunk of p.stream({ messages: [userMsg] })) {
            chunks.push(chunk);
        }
        expect(chunks).toEqual(['chunk1', 'chunk2']);
    });

    it('stream skips chunks with falsy text', async () => {
        async function* fakeStream() {
            yield { text: '' };
            yield { text: 'real' };
        }
        mockGenerateContentStream.mockResolvedValue(fakeStream());

        const p = make();
        const chunks: string[] = [];
        for await (const chunk of p.stream({ messages: [userMsg] })) {
            chunks.push(chunk);
        }
        expect(chunks).toEqual(['real']);
    });

    // countTokens
    it('countTokens returns totalTokens from SDK', async () => {
        mockCountTokens.mockResolvedValue({ totalTokens: 17 });
        const p = make();
        expect(await p.countTokens([userMsg])).toBe(17);
    });

    it('countTokens returns 0 when totalTokens is undefined', async () => {
        mockCountTokens.mockResolvedValue({});
        const p = make();
        expect(await p.countTokens([userMsg])).toBe(0);
    });
});
