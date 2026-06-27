import Handlebars from 'handlebars';
import { ContextEntry } from '../schema';

// ─── Epic generation prompt ───────────────────────────────────────────────────

const EPIC_GEN_TEMPLATE = Handlebars.compile(`
You are an expert agile coach. Your task is to analyse the provided context documents and generate a structured list of epics.

## Context documents

{{#each context}}
### [{{role}}] {{filename}}
{{text}}

{{/each}}

## Instructions

Generate a list of epics that fully cover the work described in the context above.
Each epic should represent a coherent, independently-valuable area of work.

Return ONLY a YAML list — no prose, no markdown fences — in exactly this format:

- id: EPIC-001
  type: epic
  title: <concise epic title>
  description: |
    <2–4 sentence description of what this epic covers and why it is valuable>
  status: draft
  labels: [<tag1>, <tag2>]

- id: EPIC-002
  ...

Generate between {{minEpics}} and {{maxEpics}} epics. Use sequential IDs starting from {{startId}}.
`.trim());

export function buildEpicGenPrompt(
    context: Array<ContextEntry & { text: string }>,
    startId: string,
    minEpics = 2,
    maxEpics = 8,
    additionalInstructions = '',
): string {
    const base = EPIC_GEN_TEMPLATE({ context, startId, minEpics, maxEpics });
    return additionalInstructions.trim()
        ? `${base}\n\n## Additional Instructions\n${additionalInstructions.trim()}`
        : base;
}

// ─── Story generation prompt ──────────────────────────────────────────────────

const STORY_GEN_TEMPLATE = Handlebars.compile(`
You are an expert agile coach. Your task is to generate INVEST-compliant user stories with Gherkin acceptance criteria for the given epic.

## Epic

Title: {{epic.title}}
Description: {{epic.description}}

## Context documents

{{#each context}}
### [{{role}}] {{filename}}
{{text}}

{{/each}}

## Instructions

Generate user stories that together fully cover the scope of the epic above.
Each story must:
- Follow the "As a / I want / So that" format
- Be Independent, Negotiable, Valuable, Estimable, Small, and Testable (INVEST)
- Include at least one Gherkin scenario (happy path) and one negative/edge scenario
- Have a story-point estimate (1, 2, 3, 5, 8 — flag anything needing splitting if >5)

Return ONLY a YAML list — no prose, no markdown fences — in exactly this format:

- id: STORY-001
  type: story
  title: <concise story title>
  epic: {{epic.id}}
  status: draft
  as_a: <persona>
  i_want: <goal>
  so_that: <benefit>
  description: |
    <optional extra context>
  invest:
    independent: { result: pass, reason: "<one line>" }
    negotiable:  { result: pass, reason: "<one line>" }
    valuable:    { result: pass, reason: "<one line>" }
    estimable:   { result: pass, reason: "<one line>" }
    small:       { result: pass, reason: "<one line>" }
    testable:    { result: pass, reason: "<one line>" }
  acceptance_criteria:
    - |
      Scenario: <happy path title>
        Given <precondition>
        When <action>
        Then <outcome>
    - |
      Scenario: <edge/negative title>
        Given <precondition>
        When <action>
        Then <outcome>
  estimate: <number>
  labels: [<tag1>, <tag2>]

- id: STORY-002
  ...

Generate between {{minStories}} and {{maxStories}} stories. Use sequential IDs starting from {{startId}}.
`.trim());

export function buildStoryGenPrompt(
    epic: { id: string; title: string; description?: string },
    context: Array<ContextEntry & { text: string }>,
    startId: string,
    minStories = 3,
    maxStories = 8,
    additionalInstructions = '',
): string {
    const base = STORY_GEN_TEMPLATE({ epic, context, startId, minStories, maxStories });
    return additionalInstructions.trim()
        ? `${base}\n\n## Additional Instructions\n${additionalInstructions.trim()}`
        : base;
}

// ─── Refine prompts ───────────────────────────────────────────────────────────

export function buildEpicRefinePrompt(
    epics: Array<{ id: string; title: string; description: string }>,
    instructions: string,
): string {
    const epicList = epics.map((e) =>
        `- id: ${e.id}\n  title: ${e.title}\n  description: |\n    ${e.description.replace(/\n/g, '\n    ')}`,
    ).join('\n');

    return `You are an expert agile coach. Refine the following epics based on the instructions below.
Preserve each epic's ID. Return ONLY a YAML list — no prose, no markdown fences.

## Current Epics
${epicList}

## Refinement Instructions
${instructions}

Return the full refined list in the same YAML format:
- id: EPIC-001
  type: epic
  title: <title>
  description: |
    <description>
  status: draft
  labels: []`;
}

export function buildStoryRefinePrompt(
    stories: Array<{
        id: string; title: string; epic: string; as_a: string;
        i_want: string; so_that: string; acceptance_criteria: string[];
        invest?: Record<string, { result: string; reason: string }>;
    }>,
    instructions: string,
): string {
    const storyList = stories.map((s) => {
        const investIssues = s.invest
            ? Object.entries(s.invest)
                .filter(([, v]) => v.result !== 'pass')
                .map(([k, v]) => `  - ${k}: ${v.result} — ${v.reason}`)
                .join('\n')
            : '';
        return `- id: ${s.id}
  title: ${s.title}
  as_a: ${s.as_a}
  i_want: ${s.i_want}
  so_that: ${s.so_that}${investIssues ? `\n  invest_issues:\n${investIssues}` : ''}`;
    }).join('\n');

    return `You are an expert agile coach. Refine the following user stories based on the instructions.
Preserve each story's ID and epic linkage. Fix any INVEST issues listed. Return ONLY a YAML list — no prose, no markdown fences.

## Current Stories
${storyList}

## Refinement Instructions
${instructions}

Return the full refined list. Each story must keep its original id and epic value.
DO NOT include an invest block — INVEST scoring is handled separately.
Use this exact format:

- id: STORY-001
  type: story
  title: <title>
  epic: <epic-id>
  status: draft
  as_a: <persona>
  i_want: <goal>
  so_that: <benefit>
  acceptance_criteria:
    - |
      Scenario: <title>
        Given <precondition>
        When <action>
        Then <outcome>
  estimate: <number>
  labels: []`;
}
