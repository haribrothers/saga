import { LLMProvider, TokenUsage } from '../llm/provider';
import { ContextEntry } from '../schema';
import { StackInfo, DirectoryLayout } from '../context/workspace-scanner';
import { buildAgentsMdPrompt } from './prompts';

export interface AgentsMdResult {
    content: string;
    usage?: TokenUsage;
}

/**
 * Generate AGENTS.md content for the workspace.
 *
 * Produces a self-contained markdown document that helps AI coding agents
 * understand the project structure, conventions, and working patterns.
 */
export async function generateAgentsMd(
    provider: LLMProvider,
    stack: StackInfo,
    layout: DirectoryLayout,
    context: Array<ContextEntry & { text: string }>,
    existingAgentsMd?: string,
    signal?: AbortSignal,
): Promise<AgentsMdResult> {
    signal?.throwIfAborted();

    const userPrompt = buildAgentsMdPrompt({ stack, layout, existingAgentsMd, context });

    const systemPrompt =
        'You are an expert software engineer writing documentation for AI coding agents. ' +
        'Generate a clear, concise AGENTS.md file in markdown format. ' +
        'Be specific and actionable — name exact commands, file paths, and conventions. ' +
        'Output only the AGENTS.md content with no meta-commentary.';

    const response = await provider.generate({
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
        maxTokens: 4096,
        temperature: 0.2,
        signal,
    });

    return {
        content: response.content.trim(),
        usage: response.usage,
    };
}
