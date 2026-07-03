import { LLMProvider, TokenUsage } from '../llm/provider';
import { Story } from '../schema';

const MAX_RETRIES = 2;

export interface ProposedSubtask {
    title: string;
    type: 'task' | 'test' | 'chore';
}

export interface SubtaskResult {
    items: ProposedSubtask[];
    usage?: TokenUsage;
}

const SYSTEM_PROMPT =
    'You are an expert software engineer breaking a user story into concrete implementation subtasks. ' +
    'Return ONLY valid JSON — no markdown fences, no commentary.';

function buildPrompt(story: Story): string {
    return `Break the following user story into a short checklist of concrete implementation subtasks.

## Story

Title: ${story.title}
As a ${story.as_a}, I want ${story.i_want}, so that ${story.so_that}
${story.description ? `\nDescription:\n${story.description}\n` : ''}
Acceptance Criteria:
${story.acceptance_criteria.join('\n\n')}

## Instructions

Propose between 3 and 8 subtasks that together implement this story. Each subtask should be a
single concrete unit of work (e.g. "Add X endpoint", "Write unit tests for Y", "Update schema for Z").
Use "type": "test" for subtasks that are purely about writing tests, "type": "chore" for non-functional
work (docs, config, cleanup), and "type": "task" for everything else.

Return ONLY a JSON array — no prose, no markdown fences — in exactly this format (standard JSON
string escaping applies, so titles may safely contain colons, quotes, etc.):

[
  { "title": "<concise subtask title>", "type": "task" },
  { "title": "<concise subtask title>", "type": "test" }
]
`;
}

/**
 * Propose a checklist of subtasks for a story via LLM. Does not assign IDs or
 * persist anything — the caller merges the proposals into story.subtasks[]
 * using nextSubtaskId() for ID allocation.
 */
export async function generateSubtasks(
    provider: LLMProvider,
    story: Story,
    signal?: AbortSignal,
): Promise<SubtaskResult> {
    signal?.throwIfAborted();

    const userPrompt = buildPrompt(story);
    let lastUsage: TokenUsage | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        signal?.throwIfAborted();

        const response = await provider.generate({
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: attempt === 1
                        ? userPrompt
                        : `${userPrompt}\n\nCRITICAL: Return ONLY a JSON array starting with "[". No introductory text, no markdown fences.`,
                },
            ],
            maxTokens: 1024,
            temperature: 0.3,
            signal,
        });

        lastUsage = response.usage;
        const text = stripFences(response.content.trim());
        if (text.startsWith('[')) {
            try {
                const items = parseSubtaskList(text);
                if (items.length > 0) {
                    return { items, usage: lastUsage };
                }
            } catch {
                // Malformed JSON or no usable titles — retry with a stricter prompt.
            }
        }
    }

    throw new Error(`LLM did not return a valid JSON list after ${MAX_RETRIES} attempts.`);
}

function stripFences(text: string): string {
    return text
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
}

function parseSubtaskList(rawJson: string): ProposedSubtask[] {
    const parsed: unknown = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) {
        throw new Error('Expected a JSON array of subtasks.');
    }
    return parsed.map((item: unknown) => {
        const obj = item as { title?: unknown; type?: unknown };
        return {
            title: String(obj.title ?? '').trim(),
            type: (['task', 'test', 'chore'].includes(obj.type as string) ? obj.type : 'task') as ProposedSubtask['type'],
        };
    }).filter((s) => s.title.length > 0);
}
