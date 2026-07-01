import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicProvider } from './anthropic';

// ─── SDK mock ─────────────────────────────────────────────────────────────────

const mockCreate = vi.fn();
const mockStream = vi.fn();
const mockCountTokens = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
    default: function MockAnthropic() {
        return {
            messages: {
                create: mockCreate,
                stream: mockStream,
                countTokens: mockCountTokens,
            },
        };
    },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const KEY = 'sk-ant-test-key';
const withKey = () => Promise.resolve(KEY);
const noKey = () => Promise.resolve(undefined);

const userMsg = { role: 'user' as const, content: 'Hello' };
const systemMsg = { role: 'system' as const, content: 'Be concise' };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AnthropicProvider', () => {
    beforeEach(() => vi.clearAllMocks());

    // isAvailable
    it('isAvailable returns true when key is present', async () => {
        const p = new AnthropicProvider(withKey);
        expect(await p.isAvailable()).toBe(true);
    });

    it('isAvailable returns false when key is absent', async () => {
        const p = new AnthropicProvider(noKey);
        expect(await p.isAvailable()).toBe(false);
    });

    it('isAvailable returns false for empty-string key', async () => {
        const p = new AnthropicProvider(() => Promise.resolve('   '));
        expect(await p.isAvailable()).toBe(false);
    });

    // listModels
    it('listModels returns the curated model list', async () => {
        const p = new AnthropicProvider(withKey);
        const models = await p.listModels();
        expect(models.length).toBeGreaterThan(0);
        expect(models.every((m) => m.id && m.displayName && m.tier)).toBe(true);
        const ids = models.map((m) => m.id);
        expect(ids).toContain('claude-sonnet-4-6');
        expect(ids).toContain('claude-haiku-4-5-20251001');
    });

    it('listModels contains only quality and cheap tiers', async () => {
        const p = new AnthropicProvider(withKey);
        const models = await p.listModels();
        expect(models.every((m) => m.tier === 'quality' || m.tier === 'cheap')).toBe(true);
    });

    // generate
    it('generate returns content and exact token usage', async () => {
        mockCreate.mockResolvedValue({
            content: [{ type: 'text', text: 'pong' }],
            usage: { input_tokens: 10, output_tokens: 5 },
        });
        const p = new AnthropicProvider(withKey, 'claude-sonnet-4-6');
        const result = await p.generate({ messages: [userMsg] });

        expect(result.content).toBe('pong');
        expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, estimated: false });
    });

    it('generate concatenates multiple text blocks', async () => {
        mockCreate.mockResolvedValue({
            content: [
                { type: 'text', text: 'Hello ' },
                { type: 'text', text: 'world' },
            ],
            usage: { input_tokens: 5, output_tokens: 3 },
        });
        const p = new AnthropicProvider(withKey);
        const result = await p.generate({ messages: [userMsg] });
        expect(result.content).toBe('Hello world');
    });

    it('generate skips non-text blocks', async () => {
        mockCreate.mockResolvedValue({
            content: [
                { type: 'tool_use', id: 't1', name: 'fn', input: {} },
                { type: 'text', text: 'answer' },
            ],
            usage: { input_tokens: 8, output_tokens: 2 },
        });
        const p = new AnthropicProvider(withKey);
        const result = await p.generate({ messages: [userMsg] });
        expect(result.content).toBe('answer');
    });

    it('generate omits usage when API returns none', async () => {
        mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
        const p = new AnthropicProvider(withKey);
        const result = await p.generate({ messages: [userMsg] });
        expect(result.usage).toBeUndefined();
    });

    it('generate converts system messages to user turns', async () => {
        mockCreate.mockResolvedValue({
            content: [{ type: 'text', text: 'ok' }],
            usage: { input_tokens: 1, output_tokens: 1 },
        });
        const p = new AnthropicProvider(withKey);
        await p.generate({ messages: [systemMsg, userMsg] });

        const sentMessages = mockCreate.mock.calls[0][0].messages as Array<{ role: string; content: string }>;
        expect(sentMessages[0].role).toBe('user');
        expect(sentMessages[0].content).toContain('[SYSTEM]');
        expect(sentMessages[0].content).toContain('Be concise');
        expect(sentMessages[1].role).toBe('user');
    });

    it('generate passes maxTokens and temperature', async () => {
        mockCreate.mockResolvedValue({ content: [{ type: 'text', text: '' }], usage: { input_tokens: 1, output_tokens: 0 } });
        const p = new AnthropicProvider(withKey);
        await p.generate({ messages: [userMsg], maxTokens: 512, temperature: 0.2 });

        const call = mockCreate.mock.calls[0][0];
        expect(call.max_tokens).toBe(512);
        expect(call.temperature).toBe(0.2);
    });

    it('generate throws when key is missing', async () => {
        const p = new AnthropicProvider(noKey);
        await expect(p.generate({ messages: [userMsg] })).rejects.toThrow('Anthropic API key not found');
    });

    it('generate uses preferred model when set', async () => {
        mockCreate.mockResolvedValue({ content: [{ type: 'text', text: '' }], usage: { input_tokens: 1, output_tokens: 0 } });
        const p = new AnthropicProvider(withKey, 'claude-haiku-4-5-20251001');
        await p.generate({ messages: [userMsg] });
        expect(mockCreate.mock.calls[0][0].model).toBe('claude-haiku-4-5-20251001');
    });

    // stream
    it('stream yields text delta events', async () => {
        async function* fakeStream() {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'chunk1' } };
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'chunk2' } };
            yield { type: 'message_stop' };
        }
        mockStream.mockReturnValue(fakeStream());

        const p = new AnthropicProvider(withKey);
        const chunks: string[] = [];
        for await (const chunk of p.stream({ messages: [userMsg] })) {
            chunks.push(chunk);
        }
        expect(chunks).toEqual(['chunk1', 'chunk2']);
    });

    it('stream skips non-text-delta events', async () => {
        async function* fakeStream() {
            yield { type: 'message_start', message: {} };
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } };
            yield { type: 'content_block_stop' };
        }
        mockStream.mockReturnValue(fakeStream());

        const p = new AnthropicProvider(withKey);
        const chunks: string[] = [];
        for await (const chunk of p.stream({ messages: [userMsg] })) {
            chunks.push(chunk);
        }
        expect(chunks).toEqual(['hi']);
    });

    // countTokens
    it('countTokens returns the SDK result', async () => {
        mockCountTokens.mockResolvedValue({ input_tokens: 42 });
        const p = new AnthropicProvider(withKey);
        expect(await p.countTokens([userMsg])).toBe(42);
    });
});
