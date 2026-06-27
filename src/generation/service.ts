import * as yaml from 'yaml';
import { z } from 'zod';
import { LLMProvider } from '../llm/provider';
import { Epic, EpicSchema, Story, StorySchema, ContextEntry } from '../schema';
import { buildEpicGenPrompt, buildStoryGenPrompt, buildEpicRefinePrompt, buildStoryRefinePrompt } from './prompts';

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

export class GenerationService {
    constructor(private readonly provider: LLMProvider) {}

    /**
     * Generate epics from context documents.
     * Returns parsed epics; does NOT write to disk — caller decides.
     */
    async generateEpics(
        context: Array<ContextEntry & { text: string }>,
        startId: string,
        additionalInstructions = '',
    ): Promise<Epic[]> {
        const prompt = buildEpicGenPrompt(context, startId, 2, 8, additionalInstructions);
        const rawYaml = await this.callWithRetry(prompt, 'epic');
        return this.parseEpicList(rawYaml);
    }

    /**
     * Generate stories for a single epic.
     * Returns parsed stories; does NOT write to disk — caller decides.
     */
    async generateStories(
        epic: Pick<Epic, 'id' | 'title' | 'description'>,
        context: Array<ContextEntry & { text: string }>,
        startId: string,
        additionalInstructions = '',
    ): Promise<Story[]> {
        const prompt = buildStoryGenPrompt(epic, context, startId, 3, 8, additionalInstructions);
        const rawYaml = await this.callWithRetry(prompt, 'story');
        return this.parseStoryList(rawYaml, epic.id);
    }

    /**
     * Refine existing epics based on user instructions.
     * Returns updated epics; does NOT write to disk.
     */
    async refineEpics(epics: Epic[], instructions: string): Promise<Epic[]> {
        const prompt = buildEpicRefinePrompt(
            epics.map((e) => ({ id: e.id, title: e.title, description: e.description ?? '' })),
            instructions,
        );
        const rawYaml = await this.callWithRetry(prompt, 'epic');
        return this.parseEpicList(rawYaml);
    }

    /**
     * Refine existing stories based on user instructions (e.g. fixing INVEST issues).
     * Returns updated stories; does NOT write to disk.
     */
    async refineStories(stories: Story[], instructions: string): Promise<Story[]> {
        if (stories.length === 0) { return []; }
        const epicId = stories[0].epic;
        const prompt = buildStoryRefinePrompt(
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
        const rawYaml = await this.callWithRetry(prompt, 'story');
        return this.parseStoryList(rawYaml, epicId);
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    private async callWithRetry(userPrompt: string, kind: 'epic' | 'story'): Promise<string> {
        const systemPrompt =
            `You are an expert agile coach. Return ONLY valid YAML — no markdown fences, no commentary. ` +
            `The output must be a YAML list of ${kind} objects matching the exact schema requested.`;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            const response = await this.provider.generate({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: attempt === 1 ? userPrompt : this.stricter(userPrompt) },
                ],
                maxTokens: 4096,
                temperature: 0.3,
            });

            const text = this.stripFences(response.content.trim());
            if (text.startsWith('-')) {
                return text;
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
            // Enforce epic linkage
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
