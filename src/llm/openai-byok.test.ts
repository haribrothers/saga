import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIByokProvider } from './openai-byok';

// ─── SDK mock ─────────────────────────────────────────────────────────────────

const mockChatCreate = vi.fn();
const mockModelsList = vi.fn();

vi.mock('openai', () => ({
    default: function MockOpenAI() {
        return {
            chat: { completions: { create: mockChatCreate } },
            models: { list: mockModelsList },
        };
    },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const KEY = 'sk-test-key';
const withKey = () => Promise.resolve(KEY);
const noKey = () => Promise.resolve(undefined);

const userMsg = { role: 'user' as const, content: 'Hello' };
const systemMsg = { role: 'system' as const, content: 'Be concise' };
const assistantMsg = { role: 'assistant' as const, content: 'Hi' };

/** Builds a fake async-iterable page for models.list() */
async function* makeModelPage(ids: string[]) {
    for (const id of ids) {
        yield { id, object: 'model', created: 0, owned_by: 'openai' };
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OpenAIByokProvider', () => {
    beforeEach(() => vi.clearAllMocks());

    // isAvailable
    it('isAvailable returns true when key is present', async () => {
        const p = new OpenAIByokProvider(withKey);
        expect(await p.isAvailable()).toBe(true);
    });

    it('isAvailable returns false when key is absent', async () => {
        const p = new OpenAIByokProvider(noKey);
        expect(await p.isAvailable()).toBe(false);
    });

    it('isAvailable returns false for whitespace-only key', async () => {
        const p = new OpenAIByokProvider(() => Promise.resolve('  '));
        expect(await p.isAvailable()).toBe(false);
    });

    // listModels — filtering
    it('listModels includes gpt-4o and gpt-4o-mini', async () => {
        mockModelsList.mockReturnValue(makeModelPage(['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo']));
        const p = new OpenAIByokProvider(withKey);
        const models = await p.listModels();
        const ids = models.map((m) => m.id);
        expect(ids).toContain('gpt-4o');
        expect(ids).toContain('gpt-4o-mini');
    });

    it('listModels excludes non-chat models', async () => {
        mockModelsList.mockReturnValue(makeModelPage([
            'gpt-4o',
            'whisper-1',
            'tts-1',
            'dall-e-3',
            'text-embedding-ada-002',
            'babbage-002',
        ]));
        const p = new OpenAIByokProvider(withKey);
        const models = await p.listModels();
        const ids = models.map((m) => m.id);
        expect(ids).toContain('gpt-4o');
        expect(ids).not.toContain('whisper-1');
        expect(ids).not.toContain('tts-1');
        expect(ids).not.toContain('dall-e-3');
        expect(ids).not.toContain('text-embedding-ada-002');
        expect(ids).not.toContain('babbage-002');
    });

    it('listModels assigns quality tier to gpt-4o', async () => {
        mockModelsList.mockReturnValue(makeModelPage(['gpt-4o', 'gpt-4o-mini']));
        const p = new OpenAIByokProvider(withKey);
        const models = await p.listModels();
        expect(models.find((m) => m.id === 'gpt-4o')?.tier).toBe('quality');
        expect(models.find((m) => m.id === 'gpt-4o-mini')?.tier).toBe('cheap');
    });

    it('listModels returns quality models before cheap ones', async () => {
        mockModelsList.mockReturnValue(makeModelPage(['gpt-4o-mini', 'gpt-4o']));
        const p = new OpenAIByokProvider(withKey);
        const models = await p.listModels();
        expect(models[0].tier).toBe('quality');
        expect(models[1].tier).toBe('cheap');
    });

    // generate
    it('generate returns content and exact token usage', async () => {
        mockChatCreate.mockResolvedValue({
            choices: [{ message: { content: 'pong' } }],
            usage: { prompt_tokens: 10, completion_tokens: 4 },
        });
        const p = new OpenAIByokProvider(withKey, 'gpt-4o');
        const result = await p.generate({ messages: [userMsg] });

        expect(result.content).toBe('pong');
        expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 4, estimated: false });
    });

    it('generate handles missing usage gracefully', async () => {
        mockChatCreate.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });
        const p = new OpenAIByokProvider(withKey);
        const result = await p.generate({ messages: [userMsg] });
        expect(result.usage).toBeUndefined();
    });

    it('generate handles empty choices gracefully', async () => {
        mockChatCreate.mockResolvedValue({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 0 } });
        const p = new OpenAIByokProvider(withKey);
        const result = await p.generate({ messages: [userMsg] });
        expect(result.content).toBe('');
    });

    it('generate passes maxTokens and temperature', async () => {
        mockChatCreate.mockResolvedValue({ choices: [{ message: { content: '' } }] });
        const p = new OpenAIByokProvider(withKey);
        await p.generate({ messages: [userMsg], maxTokens: 256, temperature: 0.0 });

        const call = mockChatCreate.mock.calls[0][0];
        expect(call.max_tokens).toBe(256);
        expect(call.temperature).toBe(0.0);
    });

    it('generate passes all three message roles correctly', async () => {
        mockChatCreate.mockResolvedValue({ choices: [{ message: { content: '' } }] });
        const p = new OpenAIByokProvider(withKey);
        await p.generate({ messages: [systemMsg, userMsg, assistantMsg] });

        const sent = mockChatCreate.mock.calls[0][0].messages;
        expect(sent[0]).toEqual({ role: 'system', content: 'Be concise' });
        expect(sent[1]).toEqual({ role: 'user', content: 'Hello' });
        expect(sent[2]).toEqual({ role: 'assistant', content: 'Hi' });
    });

    it('generate uses preferred model when set', async () => {
        mockChatCreate.mockResolvedValue({ choices: [{ message: { content: '' } }] });
        const p = new OpenAIByokProvider(withKey, 'gpt-4o-mini');
        await p.generate({ messages: [userMsg] });
        expect(mockChatCreate.mock.calls[0][0].model).toBe('gpt-4o-mini');
    });

    it('generate throws when key is missing', async () => {
        const p = new OpenAIByokProvider(noKey);
        await expect(p.generate({ messages: [userMsg] })).rejects.toThrow('OpenAI API key not found');
    });

    // stream
    it('stream yields delta content chunks', async () => {
        async function* fakeStream() {
            yield { choices: [{ delta: { content: 'chunk1' } }] };
            yield { choices: [{ delta: { content: 'chunk2' } }] };
            yield { choices: [{ delta: {} }] };            // empty delta — skip
            yield { choices: [{ delta: { content: '' } }] }; // empty string — skip
        }
        mockChatCreate.mockResolvedValue(fakeStream());

        const p = new OpenAIByokProvider(withKey);
        const chunks: string[] = [];
        for await (const chunk of p.stream({ messages: [userMsg] })) {
            chunks.push(chunk);
        }
        expect(chunks).toEqual(['chunk1', 'chunk2']);
    });

    it('stream sends stream: true to the API', async () => {
        async function* empty() { /* no chunks */ }
        mockChatCreate.mockResolvedValue(empty());

        const p = new OpenAIByokProvider(withKey);
        const it = p.stream({ messages: [userMsg] });
        // Consume one item to trigger the underlying call
        await it[Symbol.asyncIterator]().next();
        expect(mockChatCreate.mock.calls[0][0].stream).toBe(true);
    });

    // countTokens
    it('countTokens approximates via char count', async () => {
        const p = new OpenAIByokProvider(withKey);
        // "Hello" = 5 chars → ceil(5/4) = 2
        const count = await p.countTokens([{ role: 'user', content: 'Hello' }]);
        expect(count).toBe(2);
    });

    it('countTokens sums across multiple messages', async () => {
        const p = new OpenAIByokProvider(withKey);
        // "Hello" (5) + "World" (5) = 10 chars → ceil(10/4) = 3
        const count = await p.countTokens([
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'World' },
        ]);
        expect(count).toBe(3);
    });
});
