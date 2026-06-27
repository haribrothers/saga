import { z } from 'zod';

// ─── INVEST ───────────────────────────────────────────────────────────────────

export const InvestCriterionResultSchema = z.object({
    result: z.enum(['pass', 'warn', 'fail']),
    reason: z.string(),
});
export type InvestCriterionResult = z.infer<typeof InvestCriterionResultSchema>;

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

const ModelTierSchema = z.record(z.string(), z.union([z.string(), z.record(z.string(), z.string())]));

const ProviderRoutingEntrySchema = z.object({
    tier: z.enum(['quality', 'cheap']),
});

export const ConfigSchema = z.object({
    ai: z.object({
        default_provider: z.enum(['vscode-lm', 'anthropic', 'gemini', 'openai', 'local']),
        fallback_order: z.array(z.string()).default([]),
        providers: z.object({
            'vscode-lm': z.object({ enabled: z.boolean() }).optional(),
            anthropic: z.object({ enabled: z.boolean(), prompt_caching: z.boolean().optional() }).optional(),
            gemini: z.object({ enabled: z.boolean() }).optional(),
            openai: z.object({ enabled: z.boolean() }).optional(),
            local: z.object({
                enabled: z.boolean(),
                base_url: z.string().optional(),
                api_key: z.string().optional(),
            }).optional(),
        }),
        routing: z.object({
            epic_generation: ProviderRoutingEntrySchema,
            story_generation: ProviderRoutingEntrySchema,
            invest_validation: ProviderRoutingEntrySchema,
            story_splitting: ProviderRoutingEntrySchema,
            agent_prompt: ProviderRoutingEntrySchema,
            agents_md: ProviderRoutingEntrySchema,
        }).partial(),
        models: z.object({
            quality: ModelTierSchema.optional(),
            cheap: ModelTierSchema.optional(),
        }).optional(),
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
        }).optional(),
        ado: z.object({
            org_url: z.string(),
            project: z.string(),
        }).optional(),
    }),
});
export type Config = z.infer<typeof ConfigSchema>;
