import * as vscode from 'vscode';
import * as yaml from 'yaml';
import { z } from 'zod';
import { LLMProvider, TokenUsage } from '../llm/provider';
import { Epic, EpicSchema, Story, StorySchema, ContextEntry } from '../schema';
import { buildEpicGenPrompt, buildStoryGenPrompt, buildEpicRefinePrompt, buildStoryRefinePrompt, buildStorySplitPrompt } from './prompts';

const MAX_RETRIES = 2;

// ─── Raw LLM output schemas (looser than full schema — for parse+coerce) ───────

const RawEpicSchema = EpicSchema.partial({
    status: true,
    labels: true,
    local_hash: true,
});

const RawStorySchema = StorySchema.partial({
    status: true,
    labels: true,
    local_hash: true,
    description: true,
    invest: true,
    estimate: true,
});

// ─── Result types ─────────────────────────────────────────────────────────────

export interface GenerationResult<T> {
    items: T[];
    usage?: TokenUsage;
}

export class GenerationService {
    constructor(
        private readonly provider: LLMProvider,
        private readonly extensionUri: vscode.Uri,
        private readonly sagaRoot?: vscode.Uri,
    ) {}

    /**
     * Generate epics from context documents.
     * Returns parsed epics + token usage; does NOT write to disk — caller decides.
     */
    async generateEpics(
        context: Array<ContextEntry & { text: string }>,
        startId: string,
        additionalInstructions = '',
        signal?: AbortSignal,
    ): Promise<GenerationResult<Epic>> {
        const prompt = await buildEpicGenPrompt(this.extensionUri, this.sagaRoot, context, startId, 2, 8, additionalInstructions);
        const { text, usage } = await this.callWithRetry(prompt, 'epic', signal);
        return { items: this.parseEpicList(text), usage };
    }

    /**
     * Generate stories for a single epic.
     * siblingEpics — all OTHER epics; passed to the prompt to prevent scope bleed.
     * Returns parsed stories + token usage; does NOT write to disk — caller decides.
     */
    async generateStories(
        epic: Pick<Epic, 'id' | 'title' | 'description'>,
        siblingEpics: Array<{ id: string; title: string }>,
        context: Array<ContextEntry & { text: string }>,
        startId: string,
        additionalInstructions = '',
        signal?: AbortSignal,
    ): Promise<GenerationResult<Story>> {
        const prompt = await buildStoryGenPrompt(this.extensionUri, this.sagaRoot, epic, siblingEpics, context, startId, 3, 8, additionalInstructions);
        const { text, usage } = await this.callWithRetry(prompt, 'story', signal);
        return { items: this.parseStoryList(text, epic.id), usage };
    }

    /**
     * Refine existing epics based on user instructions.
     * Returns updated epics + token usage; does NOT write to disk.
     */
    async refineEpics(epics: Epic[], instructions: string, signal?: AbortSignal): Promise<GenerationResult<Epic>> {
        const prompt = buildEpicRefinePrompt(
            epics.map((e) => ({ id: e.id, title: e.title, description: e.description ?? '' })),
            instructions,
        );
        const { text, usage } = await this.callWithRetry(prompt, 'epic', signal);
        return { items: this.parseEpicList(text), usage };
    }

    /**
     * Refine existing stories based on user instructions (e.g. fixing INVEST issues).
     * Returns updated stories + token usage; does NOT write to disk.
     */
    async refineStories(stories: Story[], instructions: string, signal?: AbortSignal): Promise<GenerationResult<Story>> {
        if (stories.length === 0) { return { items: [] }; }
        const epicId = stories[0].epic;
        const prompt = await buildStoryRefinePrompt(
            this.extensionUri,
            this.sagaRoot,
            stories.map((s) => ({
                id: s.id,
                title: s.title,
                epic: s.epic,
                as_a: s.as_a,
                i_want: s.i_want,
                so_that: s.so_that,
                acceptance_criteria: s.acceptance_criteria,
                invest: s.invest as Record<string, { result: string; reason: string }> | undefined,
            })),
            instructions,
        );
        const { text, usage } = await this.callWithRetry(prompt, 'story', signal);
        return { items: this.parseStoryList(text, epicId), usage };
    }

    /**
     * Split a single story (that failed the INVEST "Small" check) into 2–3
     * smaller replacement stories covering the same scope. Returns fresh
     * stories with new sequential IDs starting from startId; does NOT write
     * to disk or delete the original — the caller owns that after review.
     */
    async splitStory(story: Story, startId: string, signal?: AbortSignal): Promise<GenerationResult<Story>> {
        const investReason = story.invest?.small?.result !== 'pass' ? story.invest?.small?.reason : undefined;
        const prompt = await buildStorySplitPrompt(
            this.extensionUri,
            this.sagaRoot,
            {
                id: story.id,
                title: story.title,
                epic: story.epic,
                as_a: story.as_a,
                i_want: story.i_want,
                so_that: story.so_that,
                description: story.description,
                acceptance_criteria: story.acceptance_criteria,
                estimate: story.estimate,
                investReason,
            },
            startId,
        );
        const { text, usage } = await this.callWithRetry(prompt, 'story', signal);
        return { items: this.parseStoryList(text, story.epic), usage };
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    private async callWithRetry(
        userPrompt: string,
        kind: 'epic' | 'story',
        signal?: AbortSignal,
    ): Promise<{ text: string; usage?: TokenUsage }> {
        const systemPrompt =
            `You are an expert agile coach. Return ONLY valid YAML — no markdown fences, no commentary. ` +
            `The output must be a YAML list of ${kind} objects matching the exact schema requested.`;

        let lastUsage: TokenUsage | undefined;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            // Surface cancellation before sending to avoid consuming tokens on a cancelled run.
            signal?.throwIfAborted();

            const response = await this.provider.generate({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: attempt === 1 ? userPrompt : this.stricter(userPrompt) },
                ],
                maxTokens: 4096,
                temperature: 0.3,
                signal,
            });

            lastUsage = response.usage;
            const text = this.stripFences(response.content.trim());
            if (text.startsWith('-')) {
                return { text, usage: lastUsage };
            }
            // Didn't start with a list — retry with tighter instruction
        }
        throw new Error(`LLM did not return a valid YAML list after ${MAX_RETRIES} attempts.`);
    }

    private parseEpicList(rawYaml: string): Epic[] {
        const parsed = yaml.parse(rawYaml);
        if (!Array.isArray(parsed)) {
            throw new Error('Expected a YAML list of epics.');
        }
        return parsed.map((item, i) => {
            const result = RawEpicSchema.safeParse(item);
            if (!result.success) {
                throw new Error(`Epic at index ${i} failed validation: ${result.error.message}`);
            }
            return result.data as Epic;
        });
    }

    private parseStoryList(rawYaml: string, epicId: string): Story[] {
        const parsed = yaml.parse(rawYaml);
        if (!Array.isArray(parsed)) {
            throw new Error('Expected a YAML list of stories.');
        }
        return parsed.map((item, i) => {
            item.epic = epicId;
            const result = RawStorySchema.safeParse(item);
            if (!result.success) {
                throw new Error(`Story at index ${i} failed validation: ${result.error.message}`);
            }
            return result.data as Story;
        });
    }

    private stripFences(text: string): string {
        return text
            .replace(/^```(?:yaml)?\s*/i, '')
            .replace(/\s*```$/, '')
            .trim();
    }

    private stricter(original: string): string {
        return (
            original +
            '\n\nCRITICAL: Return ONLY a YAML list starting with "- id:". ' +
            'No introductory text, no markdown fences, no trailing commentary.'
        );
    }
}

// ─── Zod re-export for callers that need it ───────────────────────────────────
export { z };
