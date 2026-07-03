import { z } from 'zod';

// ─── INVEST ───────────────────────────────────────────────────────────────────

// Accept either the full object form { result, reason } or a bare string shorthand
// "pass" | "warn" | "fail" that some LLM responses emit. Coerce the shorthand.
export const InvestCriterionResultSchema = z.union([
    z.object({
        result: z.enum(['pass', 'warn', 'fail']),
        reason: z.string(),
    }),
    z.enum(['pass', 'warn', 'fail']).transform((r) => ({ result: r, reason: '' })),
]);
export type InvestCriterionResult = { result: 'pass' | 'warn' | 'fail'; reason: string };

export const InvestResultSchema = z.object({
    independent: InvestCriterionResultSchema,
    negotiable: InvestCriterionResultSchema,
    valuable: InvestCriterionResultSchema,
    estimable: InvestCriterionResultSchema,
    small: InvestCriterionResultSchema,
    testable: InvestCriterionResultSchema,
});
export type InvestResult = z.infer<typeof InvestResultSchema>;

// ─── STORY ────────────────────────────────────────────────────────────────────

export const StoryStatusSchema = z.enum([
    'draft',
    'ready',
    'synced',
    'in-progress',
    'done',
]);
export type StoryStatus = z.infer<typeof StoryStatusSchema>;

export const RemoteRefSchema = z.object({
    provider: z.enum(['jira', 'ado']),
    key: z.string(),
    url: z.string().url(),
    last_synced_hash: z.string().optional(),
    last_synced_at: z.string().optional(),
});
export type RemoteRef = z.infer<typeof RemoteRefSchema>;

// ─── SUBTASK ──────────────────────────────────────────────────────────────────

export const SubtaskSchema = z.object({
    id: z.string().regex(/^SUB-\d+$/),
    title: z.string().min(1),
    type: z.enum(['task', 'test', 'chore']).default('task'),
    done: z.boolean().default(false),
    remote: RemoteRefSchema.optional(),
});
export type Subtask = z.infer<typeof SubtaskSchema>;

export const StorySchema = z.object({
    id: z.string().regex(/^STORY-\d+$/),
    type: z.literal('story'),
    title: z.string().min(1),
    epic: z.string().regex(/^EPIC-\d+$/),
    status: StoryStatusSchema.default('draft'),
    as_a: z.string().min(1),
    i_want: z.string().min(1),
    so_that: z.string().min(1),
    description: z.string().optional(),
    invest: InvestResultSchema.optional(),
    acceptance_criteria: z.array(z.string()).min(1),
    estimate: z.number().int().positive().optional(),
    labels: z.array(z.string()).default([]),
    subtasks: z.array(SubtaskSchema).default([]),
    remote: RemoteRefSchema.optional(),
    local_hash: z.string().optional(),
});
export type Story = z.infer<typeof StorySchema>;

// ─── EPIC ─────────────────────────────────────────────────────────────────────

export const EpicStatusSchema = z.enum(['draft', 'active', 'done']);
export type EpicStatus = z.infer<typeof EpicStatusSchema>;

export const EpicSchema = z.object({
    id: z.string().regex(/^EPIC-\d+$/),
    type: z.literal('epic'),
    title: z.string().min(1),
    description: z.string().optional(),
    status: EpicStatusSchema.default('draft'),
    labels: z.array(z.string()).default([]),
    remote: RemoteRefSchema.optional(),
    local_hash: z.string().optional(),
});
export type Epic = z.infer<typeof EpicSchema>;

// ─── CONTEXT ──────────────────────────────────────────────────────────────────

export const ContextRoleSchema = z.enum([
    'brief',
    'design',
    'standards',
    'reference',
]);
export type ContextRole = z.infer<typeof ContextRoleSchema>;

export const ContextEntrySchema = z.object({
    /** Absolute path to the original file. */
    path: z.string(),
    /** Filename as stored in .saga/context/ (may differ from original). */
    filename: z.string(),
    role: ContextRoleSchema,
    /** ISO timestamp of when it was registered. */
    added_at: z.string(),
    /** Character count of extracted text (informational). */
    char_count: z.number().int().nonnegative().optional(),
});
export type ContextEntry = z.infer<typeof ContextEntrySchema>;

export const ContextRegistrySchema = z.object({
    entries: z.array(ContextEntrySchema),
});
export type ContextRegistry = z.infer<typeof ContextRegistrySchema>;

// ─── CONFIG ───────────────────────────────────────────────────────────────────

/**
 * Per-task routing value: either a specific model ID string (e.g. "claude-sonnet-4-6")
 * or the literal "auto" which delegates to Saga's tier-based selection at runtime.
 * Accepts both the new string form and the legacy { tier: ... } object so that
 * existing config.yaml files parse without error.
 */
const RoutingValueSchema = z.union([
    z.string(),                                     // model ID or "auto"
    z.object({ tier: z.enum(['quality', 'cheap']) }) // legacy tier object — coerced to "auto"
        .transform(() => 'auto' as const),
]).default('auto');

export type RoutingValue = string; // "auto" or a model ID

export const ConfigSchema = z.object({
    ai: z.object({
        default_provider: z.enum(['vscode-lm', 'anthropic', 'gemini', 'openai', 'openrouter', 'local']),
        fallback_order: z.array(z.string()).default([]),
        providers: z.object({
            'vscode-lm': z.object({ enabled: z.boolean() }).optional(),
            anthropic: z.object({ enabled: z.boolean(), prompt_caching: z.boolean().optional() }).optional(),
            gemini: z.object({ enabled: z.boolean() }).optional(),
            openai: z.object({ enabled: z.boolean() }).optional(),
            openrouter: z.object({ enabled: z.boolean() }).optional(),
            local: z.object({
                enabled: z.boolean(),
                base_url: z.string().optional(),
                api_key: z.string().optional(),
            }).optional(),
        }),
        routing: z.object({
            epic_generation: RoutingValueSchema,
            story_generation: RoutingValueSchema,
            invest_validation: RoutingValueSchema,
            story_splitting: RoutingValueSchema,
            agent_prompt: RoutingValueSchema,
            agents_md: RoutingValueSchema,
            subtask_generation: RoutingValueSchema,
        }).partial(),
        budget: z.object({
            confirm_above_usd: z.number().optional(),
            show_token_preview: z.boolean().optional(),
        }).optional(),
    }),
    tracker: z.object({
        default: z.enum(['jira', 'ado', 'none']).default('none'),
        jira: z.object({
            base_url: z.string(),
            project_key: z.string(),
            email: z.string(),
            /** Jira issue type name for epics. Default: "Epic". */
            epic_issue_type: z.string().default('Epic'),
            /** Jira issue type name for stories. Default: "Story". */
            story_issue_type: z.string().default('Story'),
            /**
             * Jira issue type name for subtasks. Default: "Sub-task".
             * Some projects use "Subtask" (no hyphen) or don't support the
             * sub-task hierarchy at all — check Project Settings → Issue Types.
             */
            subtask_issue_type: z.string().default('Sub-task'),
            /**
             * Field ID for acceptance criteria.
             * Use "description" (default) to append AC to the description block,
             * or a custom field ID (e.g. "customfield_10020") for a dedicated field.
             */
            ac_field_id: z.string().default('description'),
            /**
             * How to link a story to its parent epic.
             * "parent" = Next-Gen / Team-Managed projects (Jira Cloud default since 2022).
             * "customfield_10014" = classic projects using the legacy Epic Link field.
             */
            epic_link_style: z.enum(['parent', 'customfield_10014']).default('parent'),
            /**
             * Custom field ID for story points. Omit to skip story points on push
             * (avoids 400 on projects where the field isn't on the create screen).
             * Common values: "customfield_10016" (classic), "customfield_10028" (next-gen).
             */
            story_points_field_id: z.string().optional(),
        }).optional(),
        ado: z.object({
            org_url: z.string(),
            project: z.string(),
            /** ADO area path for new work items, e.g. "MyProject\\MyTeam". Optional. */
            area_path: z.string().optional(),
            /** Work item type for epics. Default: "Epic". */
            epic_work_item_type: z.string().default('Epic'),
            /**
             * Work item type for stories.
             * "User Story" for Agile, "Product Backlog Item" for Scrum, "Issue" for Basic.
             */
            story_work_item_type: z.string().default('User Story'),
            /**
             * Work item type for subtasks. Default: "Task".
             * Standard across Agile/Scrum/CMMI process templates; override for custom
             * process templates that rename or don't support the Task type.
             */
            subtask_work_item_type: z.string().default('Task'),
            /**
             * Field reference for acceptance criteria.
             * Default is the standard Agile/Scrum/CMMI field; override for custom
             * process templates that use a different field.
             */
            ac_field_id: z.string().default('Microsoft.VSTS.Common.AcceptanceCriteria'),
            /**
             * Field reference for story points. Omit to fall back to the standard
             * Microsoft.VSTS.Scheduling.StoryPoints field; override for custom process
             * templates (e.g. Basic, which has no story points field by default).
             */
            story_points_field_id: z.string().optional(),
        }).optional(),
    }),
    telemetry: z.object({
        /**
         * Anonymous local event logging (command name, provider type, story
         * count — never content). Off by default. Currently logs to the Saga
         * Output Channel only — no network calls, no external service.
         */
        enabled: z.boolean().default(false),
    }).default({ enabled: false }),
});
export type Config = z.infer<typeof ConfigSchema>;
