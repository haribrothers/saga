import * as vscode from 'vscode';
import Handlebars from 'handlebars';
import { ContextEntry } from '../schema';
import type { RelevantFile, StackInfo, DirectoryLayout } from '../context/workspace-scanner';
import { loadTemplateSource, TemplateName } from './template-loader';

// Register Handlebars helper for joining arrays
Handlebars.registerHelper('join', (arr: unknown[], sep: string) =>
    Array.isArray(arr) ? arr.join(sep) : '',
);

// ─── Compiled-template cache ──────────────────────────────────────────────────
// Keyed by the raw template source string so an edited .saga/templates/ override
// is picked up on the next generation run without needing to restart the extension.
const compiledCache = new Map<string, HandlebarsTemplateDelegate>();

async function compileTemplate(
    name: TemplateName,
    extensionUri: vscode.Uri,
    sagaRoot?: vscode.Uri,
): Promise<HandlebarsTemplateDelegate> {
    const source = await loadTemplateSource(name, extensionUri, sagaRoot);
    const cached = compiledCache.get(source);
    if (cached) { return cached; }
    const compiled = Handlebars.compile(source);
    compiledCache.set(source, compiled);
    return compiled;
}

// ─── Epic generation prompt ───────────────────────────────────────────────────

export async function buildEpicGenPrompt(
    extensionUri: vscode.Uri,
    sagaRoot: vscode.Uri | undefined,
    context: Array<ContextEntry & { text: string }>,
    startId: string,
    minEpics = 2,
    maxEpics = 8,
    additionalInstructions = '',
): Promise<string> {
    const template = await compileTemplate('epic-generation', extensionUri, sagaRoot);
    const base = template({ context, startId, minEpics, maxEpics });
    return additionalInstructions.trim()
        ? `${base}\n\n## Additional Instructions\n${additionalInstructions.trim()}`
        : base;
}

// ─── Story generation prompt ──────────────────────────────────────────────────

export async function buildStoryGenPrompt(
    extensionUri: vscode.Uri,
    sagaRoot: vscode.Uri | undefined,
    epic: { id: string; title: string; description?: string },
    siblings: Array<{ id: string; title: string }>,
    context: Array<ContextEntry & { text: string }>,
    startId: string,
    minStories = 3,
    maxStories = 8,
    additionalInstructions = '',
): Promise<string> {
    const template = await compileTemplate('story-generation', extensionUri, sagaRoot);
    const base = template({ epic, siblings, context, startId, minStories, maxStories });
    return additionalInstructions.trim()
        ? `${base}\n\n## Additional Instructions\n${additionalInstructions.trim()}`
        : base;
}

// ─── Refine prompts ───────────────────────────────────────────────────────────
// Epic refine has no bundled override file (P2 — kept as plain string assembly,
// matching its narrow single-purpose usage in the review panel's "refine all" flow).

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

export async function buildStoryRefinePrompt(
    extensionUri: vscode.Uri,
    sagaRoot: vscode.Uri | undefined,
    stories: Array<{
        id: string; title: string; epic: string; as_a: string;
        i_want: string; so_that: string; acceptance_criteria: string[];
        invest?: Record<string, { result: string; reason: string }>;
    }>,
    instructions: string,
): Promise<string> {
    const template = await compileTemplate('story-refine', extensionUri, sagaRoot);
    const storiesForTemplate = stories.map((s) => ({
        id: s.id,
        title: s.title,
        as_a: s.as_a,
        i_want: s.i_want,
        so_that: s.so_that,
        investIssues: s.invest
            ? Object.entries(s.invest)
                .filter(([, v]) => v.result !== 'pass')
                .map(([k, v]) => `${k}: ${v.result} — ${v.reason}`)
            : [],
    }));
    return template({ stories: storiesForTemplate, instructions });
}

// ─── Agent prompt generation ──────────────────────────────────────────────────

export async function buildAgentPromptGenPrompt(
    extensionUri: vscode.Uri,
    sagaRoot: vscode.Uri | undefined,
    story: {
        id: string;
        title: string;
        epic: string;
        as_a: string;
        i_want: string;
        so_that: string;
        description?: string;
        acceptance_criteria: string[];
        labels?: string[];
        subtasks?: Array<{ title: string; type: string; done: boolean }>;
    },
    stack: StackInfo,
    relevantFiles: RelevantFile[],
    context: Array<ContextEntry & { text: string }>,
    relevantFileContents?: Array<{ relativePath: string; content: string }>,
): Promise<string> {
    const template = await compileTemplate('agent-prompt', extensionUri, sagaRoot);
    return template({ story, stack, relevantFiles, context, relevantFileContents });
}

// ─── AGENTS.md generation ─────────────────────────────────────────────────────

export interface AgentsMdInput {
    stack: StackInfo;
    layout: DirectoryLayout;
    existingAgentsMd?: string;
    context: Array<ContextEntry & { text: string }>;
}

export async function buildAgentsMdPrompt(
    extensionUri: vscode.Uri,
    sagaRoot: vscode.Uri | undefined,
    input: AgentsMdInput,
): Promise<string> {
    const template = await compileTemplate('agents-md', extensionUri, sagaRoot);
    return template(input);
}
