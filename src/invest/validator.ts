import { Story, InvestResult, InvestCriterionResult } from '../schema';
import { LLMProvider } from '../llm/provider';

// These phrases in so_that indicate no real business value was stated.
const FILLER_PHRASES = [
    'to be able to',
    'i can do',
    'it works',
    'it is done',
    'it is complete',
    'nothing breaks',
];

// Stories with more than this many ACs or this many points are flagged as too large.
const MAX_AC_COUNT = 5;
const MAX_ESTIMATE = 8;

export class InvestValidator {
    /** provider is optional; without it, LLM-based criteria fall back to heuristics. */
    constructor(private readonly provider?: LLMProvider) {}

    async validate(story: Story): Promise<InvestResult> {
        const [independent, negotiable] = await Promise.all([
            this.checkIndependent(story),
            this.checkNegotiable(story),
        ]);

        return {
            independent,
            negotiable,
            valuable: this.checkValuable(story),
            estimable: this.checkEstimable(story),
            small: this.checkSmall(story),
            testable: await this.checkTestable(story),
        };
    }

    // ─── Heuristic checks ─────────────────────────────────────────────────────

    private checkValuable(story: Story): InvestCriterionResult {
        const soThat = story.so_that.trim().toLowerCase();
        if (!soThat || soThat.length < 10) {
            return { result: 'fail', reason: '"so_that" is missing or too short to describe business value.' };
        }
        const isFiller = FILLER_PHRASES.some((f) => soThat.includes(f));
        if (isFiller) {
            return { result: 'warn', reason: '"so_that" reads as filler rather than a concrete business benefit.' };
        }
        return { result: 'pass', reason: 'Business value is stated.' };
    }

    private checkEstimable(story: Story): InvestCriterionResult {
        if (!story.estimate) {
            return { result: 'warn', reason: 'No story-point estimate provided.' };
        }
        if (story.acceptance_criteria.length === 0) {
            return { result: 'warn', reason: 'No acceptance criteria — hard to estimate without knowing done means done.' };
        }
        return { result: 'pass', reason: 'Estimate present and acceptance criteria defined.' };
    }

    private checkSmall(story: Story): InvestCriterionResult {
        const acCount = story.acceptance_criteria.length;
        const estimate = story.estimate ?? 0;

        if (estimate > MAX_ESTIMATE) {
            return {
                result: 'warn',
                reason: `Estimate of ${estimate} points is high — consider splitting into smaller stories.`,
            };
        }
        if (acCount > MAX_AC_COUNT) {
            return {
                result: 'warn',
                reason: `${acCount} acceptance criteria is a lot — consider splitting.`,
            };
        }
        return { result: 'pass', reason: 'Story appears appropriately sized.' };
    }

    private async checkTestable(story: Story): Promise<InvestCriterionResult> {
        if (story.acceptance_criteria.length === 0) {
            return { result: 'fail', reason: 'No acceptance criteria defined.' };
        }

        const parseErrors: string[] = [];
        for (const ac of story.acceptance_criteria) {
            const err = lintGherkin(ac);
            if (err) {
                parseErrors.push(err);
            }
        }

        if (parseErrors.length > 0) {
            return {
                result: 'warn',
                reason: `Some acceptance criteria do not follow Gherkin structure: ${parseErrors[0]}`,
            };
        }
        return { result: 'pass', reason: 'All acceptance criteria are Gherkin-structured.' };
    }

    // ─── LLM-assisted checks (fall back to pass if no provider) ──────────────

    private async checkIndependent(story: Story): Promise<InvestCriterionResult> {
        if (!this.provider) {
            return story.invest?.independent ?? { result: 'pass', reason: 'Not assessed (no LLM provider).' };
        }

        const prompt =
            `Does the following user story have a strong dependency on another story being completed first?\n\n` +
            `Title: ${story.title}\n` +
            `As a ${story.as_a}, I want ${story.i_want}, so that ${story.so_that}\n\n` +
            `Answer in this exact YAML format:\n` +
            `result: pass  # or warn or fail\n` +
            `reason: "<one sentence explanation>"`;

        try {
            const response = await this.provider.generate({
                messages: [
                    { role: 'system', content: 'You are an agile coach evaluating user stories. Reply only in YAML.' },
                    { role: 'user', content: prompt },
                ],
                maxTokens: 100,
                temperature: 0,
            });
            return parseCriterionYaml(response.content);
        } catch {
            return { result: 'pass', reason: 'Could not assess (LLM error).' };
        }
    }

    private async checkNegotiable(story: Story): Promise<InvestCriterionResult> {
        if (!this.provider) {
            return story.invest?.negotiable ?? { result: 'pass', reason: 'Not assessed (no LLM provider).' };
        }

        const prompt =
            `Does the following user story over-specify implementation details (rather than describing what the user needs)?\n\n` +
            `Title: ${story.title}\n` +
            `As a ${story.as_a}, I want ${story.i_want}, so that ${story.so_that}\n\n` +
            `Answer in this exact YAML format:\n` +
            `result: pass  # or warn or fail\n` +
            `reason: "<one sentence explanation>"`;

        try {
            const response = await this.provider.generate({
                messages: [
                    { role: 'system', content: 'You are an agile coach evaluating user stories. Reply only in YAML.' },
                    { role: 'user', content: prompt },
                ],
                maxTokens: 100,
                temperature: 0,
            });
            return parseCriterionYaml(response.content);
        } catch {
            return { result: 'pass', reason: 'Could not assess (LLM error).' };
        }
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal Gherkin linter — checks that the scenario has Given/When/Then keywords. */
function lintGherkin(text: string): string | null {
    const normalized = text.replace(/\s+/g, ' ').toLowerCase();
    if (!normalized.includes('scenario')) {
        return 'Missing "Scenario:" keyword.';
    }
    if (!normalized.includes('given') && !normalized.includes('when') && !normalized.includes('then')) {
        return 'Missing Given/When/Then structure.';
    }
    return null;
}

function parseCriterionYaml(text: string): InvestCriterionResult {
    // Simple regex parse — avoids importing the full yaml package just for this tiny response.
    const resultMatch = text.match(/result:\s*(pass|warn|fail)/i);
    const reasonMatch = text.match(/reason:\s*["']?(.+?)["']?\s*$/m);

    if (!resultMatch) {
        return { result: 'pass', reason: 'Could not parse LLM response.' };
    }

    return {
        result: resultMatch[1].toLowerCase() as 'pass' | 'warn' | 'fail',
        reason: reasonMatch ? reasonMatch[1].trim().replace(/^["']|["']$/g, '') : '',
    };
}
