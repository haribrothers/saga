import * as vscode from 'vscode';
import type {
    LLMMessage,
    LLMModelInfo,
    LLMProvider,
    LLMRequestOptions,
    LLMResponse,
} from './provider';

/**
 * VS Code LM API adapter — uses the user's Copilot seat, so zero marginal cost
 * and no API key required. This is Saga's default provider.
 *
 * Docs: https://code.visualstudio.com/api/extension-guides/language-model
 */
export class VsCodeLmProvider implements LLMProvider {
    readonly id = 'vscode-lm';
    readonly displayName: string;

    constructor(
        /** Optional model ID hint (e.g. "copilot/claude-sonnet"). When set, selectModel prefers it. */
        private readonly preferredModelId?: string,
    ) {
        this.displayName = preferredModelId
            ? `VS Code LM (${preferredModelId})`
            : 'VS Code LM (Copilot)';
    }

    async isAvailable(): Promise<boolean> {
        try {
            const models = await vscode.lm.selectChatModels({});
            return models.length > 0;
        } catch {
            return false;
        }
    }

    async listModels(): Promise<LLMModelInfo[]> {
        const models = await vscode.lm.selectChatModels({});
        return models.map((m) => ({
            id: `${m.vendor}/${m.family}`,
            displayName: `${m.name} (${m.vendor})`,
            tier: inferTier(m.family),
        }));
    }

    async generate(options: LLMRequestOptions): Promise<LLMResponse> {
        const model = await this.selectModel(options);
        const vsMessages = toVsMessages(options.messages);
        const token = options.signal ? signalToToken(options.signal) : undefined;

        const response = await model.sendRequest(
            vsMessages,
            { justification: 'Saga: generating agile planning content' },
            token,
        );

        let content = '';
        for await (const chunk of response.text) {
            content += chunk;
        }

        return { content };
    }

    async *stream(options: LLMRequestOptions): AsyncIterable<string> {
        const model = await this.selectModel(options);
        const vsMessages = toVsMessages(options.messages);
        const token = options.signal ? signalToToken(options.signal) : undefined;

        const response = await model.sendRequest(
            vsMessages,
            { justification: 'Saga: generating agile planning content' },
            token,
        );

        for await (const chunk of response.text) {
            yield chunk;
        }
    }

    async countTokens(messages: LLMMessage[]): Promise<number> {
        const models = await vscode.lm.selectChatModels({});
        if (models.length === 0) {
            throw new Error('No VS Code LM models available');
        }
        // countTokens accepts a single message or string; sum each message.
        const vsMessages = toVsMessages(messages);
        let total = 0;
        for (const msg of vsMessages) {
            total += await models[0].countTokens(msg);
        }
        return total;
    }

    private async selectModel(options: LLMRequestOptions): Promise<vscode.LanguageModelChat> {
        const models = await vscode.lm.selectChatModels({});
        if (models.length === 0) {
            throw new Error(
                'No Copilot language models available. Make sure GitHub Copilot is installed and signed in.',
            );
        }

        // 1. Exact match on user-configured model ID (format: "vendor/family" or just family)
        if (this.preferredModelId) {
            const [vendor, family] = this.preferredModelId.includes('/')
                ? this.preferredModelId.split('/', 2)
                : [undefined, this.preferredModelId];
            const exact = models.find((m) =>
                (!vendor || m.vendor.toLowerCase() === vendor.toLowerCase()) &&
                m.family.toLowerCase().includes((family ?? '').toLowerCase()),
            );
            if (exact) { return exact; }
        }

        // 2. Prefer Claude families; otherwise take the first available.
        const preferred = models.find((m) => m.family.toLowerCase().includes('claude'));
        return preferred ?? models[0];
    }
}

function toVsMessages(messages: LLMMessage[]): vscode.LanguageModelChatMessage[] {
    return messages.map((m) => {
        switch (m.role) {
            case 'user':
                return vscode.LanguageModelChatMessage.User(m.content);
            case 'assistant':
                return vscode.LanguageModelChatMessage.Assistant(m.content);
            case 'system':
                // VS Code LM API doesn't have a dedicated system role;
                // prepend as a user turn labelled [SYSTEM].
                return vscode.LanguageModelChatMessage.User(`[SYSTEM]\n${m.content}`);
        }
    });
}

/**
 * Wrap an AbortSignal as a VS Code CancellationToken so callers can use
 * the standard Web API while sendRequest gets what it needs.
 */
function signalToToken(signal: AbortSignal): vscode.CancellationToken {
    const source = new vscode.CancellationTokenSource();
    if (signal.aborted) {
        source.cancel();
    } else {
        signal.addEventListener('abort', () => source.cancel(), { once: true });
    }
    return source.token;
}

function inferTier(family: string): LLMModelInfo['tier'] {
    const lower = family.toLowerCase();
    if (lower.includes('sonnet') || lower.includes('pro') || lower.includes('opus')) {
        return 'quality';
    }
    if (lower.includes('haiku') || lower.includes('flash') || lower.includes('mini')) {
        return 'cheap';
    }
    return 'unknown';
}
