import { LLMProvider, TokenUsage } from '../llm/provider';
import { Story, ContextEntry } from '../schema';
import { StackInfo, RelevantFile, RelevantFileContent } from '../context/workspace-scanner';
import { buildAgentPromptGenPrompt } from './prompts';

export interface AgentPromptResult {
    content: string;
    usage?: TokenUsage;
}

/**
 * Generate an agent prompt for a single story.
 *
 * The prompt instructs the LLM to produce a self-contained markdown document
 * a coding agent can use to implement the story — including implementation
 * guidance, relevant file hints, and a testable checklist from the AC.
 */
export async function generateAgentPrompt(
    provider: LLMProvider,
    story: Story,
    stack: StackInfo,
    relevantFiles: RelevantFile[],
    context: Array<ContextEntry & { text: string }>,
    signal?: AbortSignal,
    relevantFileContents?: RelevantFileContent[],
): Promise<AgentPromptResult> {
    signal?.throwIfAborted();

    const userPrompt = buildAgentPromptGenPrompt(story, stack, relevantFiles, context, relevantFileContents);

    const systemPrompt =
        'You are an expert software engineer. Generate a detailed, self-contained agent prompt ' +
        'in markdown format that a coding agent can follow to implement the given user story. ' +
        'Be precise and concrete — name specific files, functions, and data structures. ' +
        'Do not add meta-commentary about the prompt itself; output only the agent prompt document.';

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
