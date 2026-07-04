import * as vscode from 'vscode';
import { SecretsManager } from './secrets';
import { initSagaFolder, getWorkspaceRoot, isSagaInitialized } from './saga-fs';
import { getSagaRoot, listEpics, listStories, readEpic, readStory, writeEpic, writeStory, nextEpicId, nextStoryId, nextSubtaskId, writePrompt, readContextRegistry, getContextDir } from './saga-repo';
import { openTemplate, resetTemplate } from './template-manager';
import { collectBacklog } from './export/collect';
import { GettingStartedPanel } from './webview/getting-started-panel';
import { TelemetryReporter } from './telemetry';
import { ContextManager } from './context/manager';
import { detectStack, findRelevantFiles, getDirectoryLayout, getRelevantFileContents } from './context/workspace-scanner';
import { generateAgentPrompt } from './generation/agent-prompt';
import { generateAgentsMd } from './generation/agents-md';
import { generateSubtasks } from './generation/subtasks';
import { readLock, writeLock, sha256 } from './agents-md-lock';
import { AgentPromptPanel } from './webview/agent-prompt-panel';
import { AgentsMdPanel } from './webview/agents-md-panel';
import { GenerationService } from './generation/service';
import { InvestValidator } from './invest/validator';
import { SagaTreeProvider, ContextTreeProvider } from './tree/saga-tree';
import { StoryPanel } from './webview/story-panel';
import { EpicPanel } from './webview/epic-panel';
import { SettingsPanel } from './webview/settings-panel';
import { GenerationReviewPanel } from './webview/generation-review-panel';
import { resolveProviderFromConfig } from './llm/routing';
import { buildTrackerAdapter } from './tracker/factory';
import { hashEpic, hashComparableStory } from './tracker/hash';
import { setMapping, readMappings, writeMappings } from './tracker/sync-store';
import { buildSyncPlan } from './tracker/sync-engine';
import { writeConflicts } from './tracker/conflicts-store';
import { SyncReviewPanel } from './webview/sync-review-panel';
import type { TrackerAdapter, RemoteEpic, RemoteStory, RemoteSubtask } from './tracker/adapter';
import type { Epic, Story } from './schema';

// ─── Module-level helpers ─────────────────────────────────────────────────────

let sagaOutputChannel: vscode.OutputChannel | undefined;

function getSagaChannel(): vscode.OutputChannel {
    if (!sagaOutputChannel) {
        sagaOutputChannel = vscode.window.createOutputChannel('Saga');
    }
    return sagaOutputChannel;
}

function getTelemetry(workspaceRoot: vscode.Uri): TelemetryReporter {
    return new TelemetryReporter(workspaceRoot, getSagaChannel());
}

function logTokenUsage(
    task: string,
    modelLabel: string,
    usage: { inputTokens: number; outputTokens: number; estimated?: boolean } | undefined,
): void {
    if (!usage) { return; }
    const est = usage.estimated ? ' (est.)' : '';
    const channel = getSagaChannel();
    channel.appendLine(
        `✓ ${task}: ${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out tokens${est} · ${modelLabel}`,
    );
}

function isAbortError(err: unknown): boolean {
    return (
        err instanceof Error &&
        (err.name === 'AbortError' || err.message.includes('aborted') || err.message.includes('Cancelled'))
    );
}

/**
 * Shared tracker-aware delete flow (F15d).
 * Asks the user whether to delete from the tracker too, attempts it, and falls
 * back gracefully if the remote delete fails or the user opts out.
 *
 * Returns true if the local file should be deleted, false if the user cancelled.
 */
async function trackerAwareDelete(opts: {
    itemId: string;
    remoteKey: string;
    provider: 'jira' | 'ado';
    deleteRemote: () => Promise<void>;
    sagaRoot: vscode.Uri;
}): Promise<boolean> {
    const { itemId, remoteKey, provider, deleteRemote, sagaRoot } = opts;

    const choice = await vscode.window.showWarningMessage(
        `${itemId} is synced to ${remoteKey} in ${provider}. What should be deleted?`,
        { modal: true },
        `Delete from ${provider} & locally`,
        'Delete locally only',
    );

    if (!choice) { return false; } // cancelled

    if (choice === 'Delete locally only') { return true; }

    // Attempt remote delete
    try {
        await deleteRemote();
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        const fallback = await vscode.window.showWarningMessage(
            `Remote delete failed: ${reason}\n\nDelete ${itemId} locally anyway?`,
            { modal: true },
            'Delete Locally',
        );
        if (fallback !== 'Delete Locally') { return false; }
        // Proceed with local delete even though remote failed
        return true;
    }

    // Remote delete succeeded — clean the entry out of the sync store too
    try {
        const store = await readMappings(sagaRoot);
        if (store[itemId]) {
            delete store[itemId][provider];
            if (Object.keys(store[itemId]).length === 0) { delete store[itemId]; }
            await writeMappings(sagaRoot, store);
        }
    } catch { /* sync store cleanup is best-effort */ }

    return true;
}

export async function activate(context: vscode.ExtensionContext) {
    const secrets = new SecretsManager(context.secrets);

    // ── Workspace helpers ──────────────────────────────────────────────────────
    function requireRoot(): vscode.Uri | undefined {
        const root = getWorkspaceRoot();
        if (!root) { vscode.window.showErrorMessage('Saga: Open a workspace folder first.'); }
        return root;
    }

    async function requireInit(root: vscode.Uri): Promise<boolean> {
        if (!(await isSagaInitialized(root))) {
            const choice = await vscode.window.showWarningMessage(
                'Saga is not initialized in this workspace.', 'Run Saga: Init',
            );
            if (choice === 'Run Saga: Init') { await vscode.commands.executeCommand('saga.init'); }
            return false;
        }
        return true;
    }

    // ── Tree providers + saga.initialized context ──────────────────────────────
    const root = getWorkspaceRoot();
    let sagaTree: SagaTreeProvider | undefined;
    let contextTree: ContextTreeProvider | undefined;

    async function initTreeProviders(workspaceRoot: vscode.Uri) {
        if (sagaTree) { return; }
        const sagaRoot = getSagaRoot(workspaceRoot);
        sagaTree = new SagaTreeProvider(sagaRoot);
        contextTree = new ContextTreeProvider(sagaRoot);
        context.subscriptions.push(sagaTree, contextTree);
        vscode.window.createTreeView('saga.storiesView', { treeDataProvider: sagaTree, showCollapseAll: true });
        vscode.window.createTreeView('saga.contextView', { treeDataProvider: contextTree });
    }

    async function setSagaContext(workspaceRoot: vscode.Uri) {
        const initialized = await isSagaInitialized(workspaceRoot);
        await vscode.commands.executeCommand('setContext', 'saga.initialized', initialized);
    }

    if (root) {
        await initTreeProviders(root);
        await setSagaContext(root);
    }

    // ── saga.init ──────────────────────────────────────────────────────────────
    const initCmd = vscode.commands.registerCommand('saga.init', async () => {
        const root = requireRoot();
        if (!root) { return; }
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Saga: Initializing .saga/ folder…', cancellable: false },
            async () => { await initSagaFolder(root); },
        );
        await initTreeProviders(root);
        await setSagaContext(root);
        await GettingStartedPanel.open(root, context.extensionUri);
    });

    // ── saga.gettingStarted ────────────────────────────────────────────────────
    const gettingStartedCmd = vscode.commands.registerCommand('saga.gettingStarted', async () => {
        const root = requireRoot();
        if (!root || !(await requireInit(root))) { return; }
        await GettingStartedPanel.open(root, context.extensionUri);
    });

    // ── saga.addContextFile ────────────────────────────────────────────────────
    const addContextFileCmd = vscode.commands.registerCommand(
        'saga.addContextFile',
        async (fileUri?: vscode.Uri) => {
            const root = requireRoot();
            if (!root || !(await requireInit(root))) { return; }
            const manager = new ContextManager(getSagaRoot(root));
            const entry = await manager.addContextFile(fileUri);
            if (entry) {
                contextTree?.refresh();
                vscode.window.showInformationMessage(`Added "${entry.filename}" as [${entry.role}] context.`);
            }
        },
    );

    // ── saga.addInlineContext (F24) ────────────────────────────────────────────
    const addInlineContextCmd = vscode.commands.registerCommand('saga.addInlineContext', async () => {
        const root = requireRoot();
        if (!root || !(await requireInit(root))) { return; }
        const text = await vscode.window.showInputBox({
            title: 'Add Inline Context',
            prompt: 'Enter free-form text to include as context (constraints, notes, quick briefs…)',
            placeHolder: 'e.g. "Focus on mobile users. Keep stories under 5 points."',
            ignoreFocusOut: true,
        });
        if (!text?.trim()) { return; }
        const manager = new ContextManager(getSagaRoot(root));
        const entry = await manager.addInlineContext(text.trim());
        if (entry) {
            contextTree?.refresh();
            vscode.window.showInformationMessage('Inline context added.');
        }
    });

    // ── saga.generateEpics ─────────────────────────────────────────────────────
    const generateEpicsCmd = vscode.commands.registerCommand('saga.generateEpics', async () => {
        const root = requireRoot();
        if (!root || !(await requireInit(root))) { return; }

        const sagaRoot = getSagaRoot(root);
        const manager = new ContextManager(sagaRoot);
        const contextTexts = await manager.loadContextTexts();

        if (contextTexts.length === 0) {
            const add = 'Add Context File';
            const choice = await vscode.window.showWarningMessage(
                'No context files registered. Add a product brief or design doc first.', add,
            );
            if (choice === add) { await vscode.commands.executeCommand('saga.addContextFile'); }
            return;
        }

        // Pre-generation instructions
        const instructions = await vscode.window.showInputBox({
            title: 'Generate Epics — Additional Instructions',
            prompt: 'Optional: add instructions to guide the AI (press Enter to skip)',
            placeHolder: 'e.g. "Focus on checkout and payments" or "Keep epics broad"',
            ignoreFocusOut: true,
        });
        if (instructions === undefined) { return; } // Escape pressed

        const resolved = await resolveProviderFromConfig('epic_generation', root, secrets);
        if (!resolved) {
            vscode.window.showErrorMessage('Saga: No AI provider available. Check Settings.');
            return;
        }

        let result: Awaited<ReturnType<GenerationService['generateEpics']>> = { items: [] };
        let cancelled = false;

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Saga: Generating epics via ${resolved.modelLabel}…`, cancellable: true },
            async (_progress, token) => {
                const abort = new AbortController();
                token.onCancellationRequested(() => abort.abort());
                try {
                    const service = new GenerationService(resolved.provider, context.extensionUri, sagaRoot);
                    const startId = await nextEpicId(sagaRoot);
                    result = await service.generateEpics(contextTexts, startId, instructions, abort.signal);
                } catch (err) {
                    if (isAbortError(err)) { cancelled = true; }
                    else { throw err; }
                }
            },
        );

        if (cancelled) { vscode.window.showInformationMessage('Saga: Generation cancelled.'); return; }

        logTokenUsage('epic_generation', resolved.modelLabel, result.usage);
        void getTelemetry(root).track({ command: 'saga.generateEpics', provider: resolved.modelLabel, storyCount: result.items.length });

        await GenerationReviewPanel.open({
            mode: 'epics',
            epics: result.items,
            stories: [],
            modelLabel: resolved.modelLabel,
            contextFileCount: contextTexts.length,
            tokenUsage: result.usage,
            workspaceRoot: root,
            extensionUri: context.extensionUri,
            onRegenerate: async (signal) => {
                const r = await resolveProviderFromConfig('epic_generation', root, secrets) ?? resolved;
                const service = new GenerationService(r.provider, context.extensionUri, sagaRoot);
                const startId = await nextEpicId(sagaRoot);
                const fresh = await service.generateEpics(contextTexts, startId, instructions, signal);
                logTokenUsage('epic_generation', r.modelLabel, fresh.usage);
                return { epics: fresh.items, stories: [], modelLabel: r.modelLabel, tokenUsage: fresh.usage };
            },
        });
        sagaTree?.refresh();
    });

    // ── saga.generateStoriesForEpic ────────────────────────────────────────────
    const generateStoriesCmd = vscode.commands.registerCommand(
        'saga.generateStoriesForEpic',
        async (arg?: string | { id?: string; epic?: { id: string } }) => {
            const root = requireRoot();
            if (!root || !(await requireInit(root))) { return; }
            const sagaRoot = getSagaRoot(root);

            let epicId: string | undefined;
            if (typeof arg === 'string') {
                epicId = arg;
            } else if (arg && typeof arg === 'object') {
                epicId = (arg as { epic?: { id: string } }).epic?.id ?? (arg as { id?: string }).id;
            }

            if (!epicId) {
                const epics = await listEpics(sagaRoot);
                if (epics.length === 0) { vscode.window.showWarningMessage('No epics found. Generate epics first.'); return; }
                const picked = await vscode.window.showQuickPick(
                    epics.map((ep) => ({ label: ep.id, description: ep.title })),
                    { placeHolder: 'Select an epic to generate stories for' },
                );
                if (!picked) { return; }
                epicId = picked.label;
            }

            const epic = await readEpic(sagaRoot, epicId);
            const existingStories = await listStories(sagaRoot, epicId);

            // If the epic already has stories, ask whether to add to them or replace them.
            // Replacement is save-gated below (via onSaved) — the originals are only
            // deleted once the newly generated stories are confirmed written.
            let replaceExisting = false;
            if (existingStories.length > 0) {
                const choice = await vscode.window.showQuickPick(
                    [
                        { label: 'Add new stories', description: `Keep the ${existingStories.length} existing stories`, value: 'add' as const },
                        { label: 'Replace all existing stories', description: `Delete the ${existingStories.length} existing stories once new ones are saved`, value: 'replace' as const },
                    ],
                    { placeHolder: `${epicId} already has ${existingStories.length} stor${existingStories.length === 1 ? 'y' : 'ies'} — how should generation proceed?` },
                );
                if (!choice) { return; }
                replaceExisting = choice.value === 'replace';
            }

            // Pre-generation instructions
            const instructions = await vscode.window.showInputBox({
                title: `Generate Stories for ${epicId} — Additional Instructions`,
                prompt: 'Optional: add instructions to guide the AI (press Enter to skip)',
                placeHolder: 'e.g. "Keep stories under 5 points" or "Focus on mobile UX"',
                ignoreFocusOut: true,
            });
            if (instructions === undefined) { return; }

            const resolved = await resolveProviderFromConfig('story_generation', root, secrets);
            if (!resolved) {
                vscode.window.showErrorMessage('Saga: No AI provider available. Check Settings.');
                return;
            }

            const manager = new ContextManager(sagaRoot);
            const contextTexts = await manager.loadContextTexts();

            // Load sibling epics so the prompt can tell the LLM what NOT to cover
            const allEpics = await listEpics(sagaRoot);
            const siblingEpics = allEpics
                .filter((e) => e.id !== epicId)
                .map((e) => ({ id: e.id, title: e.title }));

            let storyResult: Awaited<ReturnType<GenerationService['generateStories']>> = { items: [] };
            let storyCancelled = false;

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Saga: Generating stories via ${resolved.modelLabel}…`, cancellable: true },
                async (_progress, token) => {
                    const abort = new AbortController();
                    token.onCancellationRequested(() => abort.abort());
                    try {
                        const service = new GenerationService(resolved.provider, context.extensionUri, sagaRoot);
                        const startId = await nextStoryId(sagaRoot);
                        storyResult = await service.generateStories(epic, siblingEpics, contextTexts, startId, instructions, abort.signal);
                    } catch (err) {
                        if (isAbortError(err)) { storyCancelled = true; }
                        else { throw err; }
                    }
                },
            );

            if (storyCancelled) { vscode.window.showInformationMessage('Saga: Generation cancelled.'); return; }

            logTokenUsage('story_generation', resolved.modelLabel, storyResult.usage);
            void getTelemetry(root).track({ command: 'saga.generateStoriesForEpic', provider: resolved.modelLabel, storyCount: storyResult.items.length });

            await GenerationReviewPanel.open({
                mode: 'stories',
                epics: [],
                stories: storyResult.items,
                modelLabel: resolved.modelLabel,
                contextFileCount: contextTexts.length,
                tokenUsage: storyResult.usage,
                workspaceRoot: root,
                extensionUri: context.extensionUri,
                onRegenerate: async (signal) => {
                    const r = await resolveProviderFromConfig('story_generation', root, secrets) ?? resolved;
                    const service = new GenerationService(r.provider, context.extensionUri, sagaRoot);
                    const startId = await nextStoryId(sagaRoot);
                    const fresh = await service.generateStories(epic, siblingEpics, contextTexts, startId, instructions, signal);
                    logTokenUsage('story_generation', r.modelLabel, fresh.usage);
                    return { epics: [], stories: fresh.items, modelLabel: r.modelLabel, tokenUsage: fresh.usage };
                },
                // Only delete the originals once the newly generated stories are safely persisted.
                onSaved: replaceExisting
                    ? async () => {
                        for (const s of existingStories) {
                            await vscode.commands.executeCommand('saga.deleteStory', s.id);
                        }
                    }
                    : undefined,
            });
            sagaTree?.refresh();
        },
    );

    // ── saga.validateStories ───────────────────────────────────────────────────
    const validateStoriesCmd = vscode.commands.registerCommand('saga.validateStories', async () => {
        const root = requireRoot();
        if (!root || !(await requireInit(root))) { return; }
        const sagaRoot = getSagaRoot(root);
        const stories = await listStories(sagaRoot);
        if (stories.length === 0) { vscode.window.showInformationMessage('No stories to validate yet.'); return; }

        const resolved = await resolveProviderFromConfig('invest_validation', root, secrets);
        const validator = new InvestValidator(resolved?.provider);

        const channel = getSagaChannel();
        channel.show();
        channel.appendLine(`INVEST Validation — ${stories.length} story(ies)\n${'─'.repeat(50)}`);

        let passCount = 0, warnCount = 0, failCount = 0;
        for (const story of stories) {
            const result = await validator.validate(story);
            const criteria = Object.entries(result) as [string, { result: string; reason: string }][];
            const worst = criteria.some(([, v]) => v.result === 'fail') ? 'FAIL'
                : criteria.some(([, v]) => v.result === 'warn') ? 'WARN' : 'PASS';
            channel.appendLine(`\n${story.id}: ${story.title}  [${worst}]`);
            for (const [key, val] of criteria) {
                const icon = val.result === 'pass' ? '✓' : val.result === 'warn' ? '⚠' : '✗';
                channel.appendLine(`  ${icon} ${key.padEnd(12)} ${val.reason}`);
                if (val.result === 'pass') { passCount++; }
                else if (val.result === 'warn') { warnCount++; }
                else { failCount++; }
            }
        }
        channel.appendLine(`\n${'─'.repeat(50)}\nSummary: ${passCount} pass  ${warnCount} warn  ${failCount} fail`);
    });

    // ── saga.openStory ─────────────────────────────────────────────────────────
    const openStoryCmd = vscode.commands.registerCommand(
        'saga.openStory',
        async (storyId: string) => {
            const root = requireRoot();
            if (!root || !(await requireInit(root))) { return; }
            const resolved = await resolveProviderFromConfig('invest_validation', root, secrets);
            await StoryPanel.open(storyId, root, context.extensionUri, resolved?.provider, secrets);
        },
    );

    // ── saga.editEpic (F40) ────────────────────────────────────────────────────
    const editEpicCmd = vscode.commands.registerCommand(
        'saga.editEpic',
        async (arg?: string | { epic?: { id: string }; id?: string }) => {
            const root = requireRoot();
            if (!root || !(await requireInit(root))) { return; }
            const sagaRoot = getSagaRoot(root);

            let epicId: string | undefined;
            if (typeof arg === 'string') { epicId = arg; }
            else if (arg && typeof arg === 'object') {
                epicId = (arg as { epic?: { id: string } }).epic?.id ?? (arg as { id?: string }).id;
            }

            if (!epicId) {
                const epics = await listEpics(sagaRoot);
                if (epics.length === 0) { vscode.window.showWarningMessage('No epics found. Generate epics first.'); return; }
                const picked = await vscode.window.showQuickPick(
                    epics.map((ep) => ({ label: ep.id, description: ep.title })),
                    { placeHolder: 'Select an epic to edit' },
                );
                if (!picked) { return; }
                epicId = picked.label;
            }

            await EpicPanel.open(epicId, root, context.extensionUri);
        },
    );

    // ── saga.deleteEpic (F25 + F15d) ──────────────────────────────────────────
    const deleteEpicCmd = vscode.commands.registerCommand(
        'saga.deleteEpic',
        async (arg?: string | { epic?: { id: string }; id?: string }) => {
            const root = requireRoot();
            if (!root || !(await requireInit(root))) { return; }
            const sagaRoot = getSagaRoot(root);

            let epicId: string | undefined;
            if (typeof arg === 'string') { epicId = arg; }
            else if (arg && typeof arg === 'object') {
                epicId = (arg as { epic?: { id: string } }).epic?.id ?? (arg as { id?: string }).id;
            }
            if (!epicId) { return; }

            const epic = await readEpic(sagaRoot, epicId);
            const stories = await listStories(sagaRoot, epicId);
            const storyNote = stories.length > 0
                ? ` This will also offer to delete ${stories.length} child story(ies).`
                : '';

            // Tracker-aware path (F15d)
            if (epic.remote?.key && epic.remote.provider) {
                const adapter = await buildTrackerAdapter(root, secrets);
                if (adapter?.provider === epic.remote.provider) {
                    const proceed = await trackerAwareDelete({
                        itemId: epicId,
                        remoteKey: epic.remote.key,
                        provider: epic.remote.provider,
                        deleteRemote: () => adapter.deleteEpic(epic),
                        sagaRoot,
                    });
                    if (!proceed) { return; }
                    await vscode.workspace.fs.delete(
                        vscode.Uri.joinPath(sagaRoot, 'epics', `${epicId}.yaml`),
                        { useTrash: true },
                    );
                    if (stories.length > 0) {
                        const ds = await vscode.window.showWarningMessage(
                            `Also delete ${stories.length} story(ies) under ${epicId}?`,
                            { modal: true }, 'Delete Stories', 'Keep Stories',
                        );
                        if (ds === 'Delete Stories') {
                            for (const story of stories) {
                                await vscode.workspace.fs.delete(
                                    vscode.Uri.joinPath(sagaRoot, 'stories', `${story.id}.yaml`),
                                    { useTrash: true },
                                );
                            }
                        }
                    }
                    sagaTree?.refresh();
                    vscode.window.showInformationMessage(`${epicId} deleted.`);
                    return;
                }
            }

            // Standard path (no tracker configured or epic never pushed)
            const confirm = await vscode.window.showWarningMessage(
                `Delete ${epicId}?${storyNote} This cannot be undone.`,
                { modal: true }, 'Delete Epic',
            );
            if (confirm !== 'Delete Epic') { return; }

            await vscode.workspace.fs.delete(
                vscode.Uri.joinPath(sagaRoot, 'epics', `${epicId}.yaml`),
                { useTrash: true },
            );

            if (stories.length > 0) {
                const ds = await vscode.window.showWarningMessage(
                    `Also delete ${stories.length} story(ies) under ${epicId}?`,
                    { modal: true }, 'Delete Stories', 'Keep Stories',
                );
                if (ds === 'Delete Stories') {
                    for (const story of stories) {
                        await vscode.workspace.fs.delete(
                            vscode.Uri.joinPath(sagaRoot, 'stories', `${story.id}.yaml`),
                            { useTrash: true },
                        );
                    }
                }
            }
            sagaTree?.refresh();
            vscode.window.showInformationMessage(`${epicId} deleted.`);
        },
    );

    // ── saga.deleteStory (F25 + F15d) ─────────────────────────────────────────
    const deleteStoryCmd = vscode.commands.registerCommand(
        'saga.deleteStory',
        async (arg?: string | { story?: { id: string }; id?: string }) => {
            const root = requireRoot();
            if (!root || !(await requireInit(root))) { return; }
            const sagaRoot = getSagaRoot(root);

            let storyId: string | undefined;
            if (typeof arg === 'string') { storyId = arg; }
            else if (arg && typeof arg === 'object') {
                storyId = (arg as { story?: { id: string } }).story?.id ?? (arg as { id?: string }).id;
            }
            if (!storyId) { return; }

            const story = await readStory(sagaRoot, storyId);

            // Tracker-aware path (F15d)
            if (story.remote?.key && story.remote.provider) {
                const adapter = await buildTrackerAdapter(root, secrets);
                if (adapter?.provider === story.remote.provider) {
                    const proceed = await trackerAwareDelete({
                        itemId: storyId,
                        remoteKey: story.remote.key,
                        provider: story.remote.provider,
                        deleteRemote: () => adapter.deleteStory(story),
                        sagaRoot,
                    });
                    if (!proceed) { return; }
                    await vscode.workspace.fs.delete(
                        vscode.Uri.joinPath(sagaRoot, 'stories', `${storyId}.yaml`),
                        { useTrash: true },
                    );
                    sagaTree?.refresh();
                    vscode.window.showInformationMessage(`${storyId} deleted.`);
                    return;
                }
            }

            // Standard path
            const confirm = await vscode.window.showWarningMessage(
                `Delete ${storyId}? This cannot be undone.`,
                { modal: true }, 'Delete Story',
            );
            if (confirm !== 'Delete Story') { return; }

            await vscode.workspace.fs.delete(
                vscode.Uri.joinPath(sagaRoot, 'stories', `${storyId}.yaml`),
                { useTrash: true },
            );
            sagaTree?.refresh();
            vscode.window.showInformationMessage(`${storyId} deleted.`);
        },
    );

    // ── saga.cleanUp (F25) ────────────────────────────────────────────────────
    const cleanUpCmd = vscode.commands.registerCommand('saga.cleanUp', async () => {
        const root = requireRoot();
        if (!root || !(await requireInit(root))) { return; }

        const confirm = await vscode.window.showWarningMessage(
            'This will delete ALL generated epics, stories, prompts, and context files. config.yaml and templates are preserved. This cannot be undone.',
            { modal: true }, 'Delete All',
        );
        if (confirm !== 'Delete All') { return; }

        const typed = await vscode.window.showInputBox({
            title: 'Confirm Clean Up',
            prompt: 'Type "delete all" to confirm',
            placeHolder: 'delete all',
            ignoreFocusOut: true,
            validateInput: (v) => v !== 'delete all' ? 'Type exactly: delete all' : undefined,
        });
        if (typed !== 'delete all') { return; }

        const sagaRoot = getSagaRoot(root);
        for (const dir of ['epics', 'stories', 'prompts', 'context']) {
            const dirUri = vscode.Uri.joinPath(sagaRoot, dir);
            try {
                const entries = await vscode.workspace.fs.readDirectory(dirUri);
                for (const [name, type] of entries) {
                    if (type === vscode.FileType.File && !name.startsWith('.')) {
                        await vscode.workspace.fs.delete(vscode.Uri.joinPath(dirUri, name), { useTrash: true });
                    }
                }
            } catch { /* dir may not exist */ }
        }
        sagaTree?.refresh();
        contextTree?.refresh();
        vscode.window.showInformationMessage('Saga workspace cleaned up.');
    });

    // ── saga.clearStoriesForEpic (F25) ────────────────────────────────────────
    const clearStoriesForEpicCmd = vscode.commands.registerCommand(
        'saga.clearStoriesForEpic',
        async (arg?: string | { epic?: { id: string }; id?: string }) => {
            const root = requireRoot();
            if (!root || !(await requireInit(root))) { return; }
            const sagaRoot = getSagaRoot(root);

            let epicId: string | undefined;
            if (typeof arg === 'string') { epicId = arg; }
            else if (arg && typeof arg === 'object') {
                epicId = (arg as { epic?: { id: string } }).epic?.id ?? (arg as { id?: string }).id;
            }
            if (!epicId) { return; }

            const stories = await listStories(sagaRoot, epicId);
            if (stories.length === 0) {
                vscode.window.showInformationMessage(`No stories found under ${epicId}.`);
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Delete all ${stories.length} story(ies) under ${epicId}? This cannot be undone.`,
                { modal: true }, 'Clear Stories',
            );
            if (confirm !== 'Clear Stories') { return; }

            for (const story of stories) {
                await vscode.workspace.fs.delete(
                    vscode.Uri.joinPath(sagaRoot, 'stories', `${story.id}.yaml`),
                    { useTrash: true },
                );
            }
            sagaTree?.refresh();
            vscode.window.showInformationMessage(`Cleared ${stories.length} story(ies) under ${epicId}.`);
        },
    );

    // ── saga.clearEpics (F25) ─────────────────────────────────────────────────
    const clearEpicsCmd = vscode.commands.registerCommand('saga.clearEpics', async () => {
        const root = requireRoot();
        if (!root || !(await requireInit(root))) { return; }
        const sagaRoot = getSagaRoot(root);

        const allEpics = await listEpics(sagaRoot);
        const allStories = await listStories(sagaRoot);
        const totalItems = allEpics.length + allStories.length;

        if (totalItems === 0) {
            vscode.window.showInformationMessage('No epics or stories to clear.');
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Delete all ${allEpics.length} epic(s) and ${allStories.length} story(ies)? This cannot be undone.`,
            { modal: true }, 'Clear All Epics',
        );
        if (confirm !== 'Clear All Epics') { return; }

        for (const dir of ['epics', 'stories'] as const) {
            const dirUri = vscode.Uri.joinPath(sagaRoot, dir);
            try {
                const entries = await vscode.workspace.fs.readDirectory(dirUri);
                for (const [name, type] of entries) {
                    if (type === vscode.FileType.File && !name.startsWith('.')) {
                        await vscode.workspace.fs.delete(vscode.Uri.joinPath(dirUri, name), { useTrash: true });
                    }
                }
            } catch { /* dir may not exist */ }
        }
        sagaTree?.refresh();
        vscode.window.showInformationMessage('All epics and stories cleared.');
    });

    // ── Shared push helpers ────────────────────────────────────────────────────

    /** Push one story and persist remote ref + sync store entry. */
    async function pushOneStory(
        adapter: TrackerAdapter,
        sagaRoot: vscode.Uri,
        storyId: string,
        epicRemoteKey?: string,
    ): Promise<void> {
        const story = await readStory(sagaRoot, storyId);
        const result = await adapter.pushStory(story, epicRemoteKey);
        await writeStory(sagaRoot, {
            ...story,
            status: 'synced',
            remote: result.remoteRef,
            local_hash: hashComparableStory(story),
        });
        await setMapping(sagaRoot, storyId, adapter.provider, {
            key: result.remoteRef.key,
            url: result.remoteRef.url,
            last_synced_hash: result.syncedHash,
            last_synced_at: result.remoteRef.last_synced_at ?? new Date().toISOString(),
        });
    }

    /** Push one subtask under its parent story and persist the remote ref back onto the story. */
    async function pushOneSubtask(
        adapter: TrackerAdapter,
        sagaRoot: vscode.Uri,
        storyId: string,
        subtaskId: string,
        storyRemoteKey: string,
    ): Promise<void> {
        const story = await readStory(sagaRoot, storyId);
        const subtask = story.subtasks.find((s) => s.id === subtaskId);
        if (!subtask) { return; }
        const result = await adapter.pushSubtask(subtask, storyRemoteKey);
        const updatedSubtasks = story.subtasks.map((s) =>
            s.id === subtaskId ? { ...s, remote: result.remoteRef } : s,
        );
        await writeStory(sagaRoot, { ...story, subtasks: updatedSubtasks });
        await setMapping(sagaRoot, `${storyId}:${subtaskId}`, adapter.provider, {
            key: result.remoteRef.key,
            url: result.remoteRef.url,
            last_synced_hash: result.syncedHash,
            last_synced_at: result.remoteRef.last_synced_at ?? new Date().toISOString(),
        });
    }

    /** Push one epic and persist remote ref + sync store entry. Returns the remote key. */
    async function pushOneEpic(
        adapter: TrackerAdapter,
        sagaRoot: vscode.Uri,
        epicId: string,
    ): Promise<string> {
        const epic = await readEpic(sagaRoot, epicId);
        const result = await adapter.pushEpic(epic);
        await writeEpic(sagaRoot, {
            ...epic,
            status: 'active',
            remote: result.remoteRef,
            local_hash: hashEpic(epic),
        });
        await setMapping(sagaRoot, epicId, adapter.provider, {
            key: result.remoteRef.key,
            url: result.remoteRef.url,
            last_synced_hash: result.syncedHash,
            last_synced_at: result.remoteRef.last_synced_at ?? new Date().toISOString(),
        });
        return result.remoteRef.key;
    }

    // ── saga.pushEpic (F9/F10 + F15c) ─────────────────────────────────────────
    const pushEpicCmd = vscode.commands.registerCommand(
        'saga.pushEpic',
        async (arg?: string | { epic?: { id: string }; id?: string }) => {
            const root = requireRoot();
            if (!root || !(await requireInit(root))) { return; }
            const sagaRoot = getSagaRoot(root);

            let epicId: string | undefined;
            if (typeof arg === 'string') { epicId = arg; }
            else if (arg && typeof arg === 'object') {
                epicId = (arg as { epic?: { id: string } }).epic?.id ?? (arg as { id?: string }).id;
            }
            if (!epicId) {
                const epics = await listEpics(sagaRoot);
                if (epics.length === 0) { vscode.window.showWarningMessage('No epics to push.'); return; }
                const picked = await vscode.window.showQuickPick(
                    epics.map((e) => ({ label: e.id, description: e.title })),
                    { placeHolder: 'Select an epic to push' },
                );
                if (!picked) { return; }
                epicId = picked.label;
            }

            const adapter = await buildTrackerAdapter(root, secrets);
            if (!adapter) {
                const go = await vscode.window.showWarningMessage(
                    'Saga: No tracker configured. Set up Jira or ADO in Settings.',
                    'Open Settings',
                );
                if (go === 'Open Settings') { await vscode.commands.executeCommand('saga.openSettings'); }
                return;
            }

            const epic = await readEpic(sagaRoot, epicId);
            const isUpdate = Boolean(epic.remote?.provider === adapter.provider && epic.remote?.key);
            const verb = isUpdate ? 'Updating' : 'Creating';

            let remoteKey: string | undefined;

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Saga: ${verb} ${epicId} in ${adapter.provider}…`, cancellable: false },
                async () => { remoteKey = await pushOneEpic(adapter, sagaRoot, epicId!); },
            );

            if (!remoteKey) { return; }

            sagaTree?.refresh();

            // F15c — offer to push stories under this epic
            const stories = await listStories(sagaRoot, epicId);
            const unpushed = stories.filter(
                (s) => !(s.remote?.provider === adapter.provider && s.remote.key),
            );
            const browseUrl = epic.remote?.url ?? `${epicId}`;

            const actionLabel = unpushed.length > 0
                ? `Push ${unpushed.length} ${unpushed.length === 1 ? 'Story' : 'Stories'}`
                : undefined;

            const action = await vscode.window.showInformationMessage(
                `${isUpdate ? 'Updated' : 'Created'} ${remoteKey} in ${adapter.provider}.`,
                ...(actionLabel ? [actionLabel, 'Open in Browser'] : ['Open in Browser']),
            );

            if (action === actionLabel && actionLabel) {
                const channel = getSagaChannel();
                let failed = 0;
                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: `Saga: Pushing ${unpushed.length} stories…`, cancellable: false },
                    async () => {
                        for (const s of unpushed) {
                            try {
                                await pushOneStory(adapter, sagaRoot, s.id, remoteKey);
                                channel.appendLine(`✓ ${s.id} pushed to ${adapter.provider}`);
                            } catch (err) {
                                failed++;
                                channel.appendLine(`✗ ${s.id}: ${err instanceof Error ? err.message : String(err)}`);
                            }
                        }
                    },
                );
                sagaTree?.refresh();
                const succeeded = unpushed.length - failed;
                if (failed > 0) {
                    vscode.window.showWarningMessage(
                        `Pushed ${succeeded}/${unpushed.length} stories under ${remoteKey}. ${failed} failed — see Saga output channel for details.`,
                        'Show Output',
                    ).then((choice) => { if (choice === 'Show Output') { channel.show(); } });
                } else {
                    vscode.window.showInformationMessage(`Pushed ${unpushed.length} stories under ${remoteKey}.`);
                }

                // Offer to push subtasks under the stories just pushed — mirrors
                // saga.pushStory's own "Push N Subtasks" notification action, which
                // this bulk flow would otherwise silently skip (pushOneStory only
                // pushes the story shell, never its subtasks).
                const pushedStories = await Promise.all(unpushed.map((s) => readStory(sagaRoot, s.id)));
                const subtaskTargets: { storyId: string; subtaskId: string; storyRemoteKey: string }[] = [];
                for (const s of pushedStories) {
                    if (s.remote?.provider !== adapter.provider || !s.remote.key) { continue; }
                    for (const sub of s.subtasks) {
                        if (!(sub.remote?.provider === adapter.provider && sub.remote.key)) {
                            subtaskTargets.push({ storyId: s.id, subtaskId: sub.id, storyRemoteKey: s.remote.key });
                        }
                    }
                }

                if (subtaskTargets.length > 0) {
                    const subtaskLabel = `Push ${subtaskTargets.length} ${subtaskTargets.length === 1 ? 'Subtask' : 'Subtasks'}`;
                    const subtaskAction = await vscode.window.showInformationMessage(
                        `${subtaskTargets.length} subtask(s) under these stories haven't been pushed yet.`,
                        subtaskLabel,
                    );
                    if (subtaskAction === subtaskLabel) {
                        let subtaskFailed = 0;
                        await vscode.window.withProgress(
                            { location: vscode.ProgressLocation.Notification, title: `Saga: Pushing ${subtaskTargets.length} subtasks…`, cancellable: false },
                            async () => {
                                for (const t of subtaskTargets) {
                                    try {
                                        await pushOneSubtask(adapter, sagaRoot, t.storyId, t.subtaskId, t.storyRemoteKey);
                                        channel.appendLine(`✓ ${t.storyId}:${t.subtaskId} pushed to ${adapter.provider}`);
                                    } catch (err) {
                                        subtaskFailed++;
                                        channel.appendLine(`✗ ${t.storyId}:${t.subtaskId}: ${err instanceof Error ? err.message : String(err)}`);
                                    }
                                }
                            },
                        );
                        sagaTree?.refresh();
                        const subtaskSucceeded = subtaskTargets.length - subtaskFailed;
                        if (subtaskFailed > 0) {
                            vscode.window.showWarningMessage(
                                `Pushed ${subtaskSucceeded}/${subtaskTargets.length} subtasks. ${subtaskFailed} failed — see Saga output channel for details.`,
                                'Show Output',
                            ).then((choice) => { if (choice === 'Show Output') { channel.show(); } });
                        } else {
                            vscode.window.showInformationMessage(`Pushed ${subtaskTargets.length} subtasks.`);
                        }
                    }
                }
            } else if (action === 'Open in Browser') {
                const updatedEpic = await readEpic(sagaRoot, epicId);
                if (updatedEpic.remote?.url) {
                    await vscode.env.openExternal(vscode.Uri.parse(updatedEpic.remote.url));
                } else {
                    void browseUrl; // suppress unused warning
                }
            }
        },
    );

    // ── saga.pushStory (F9/F10 + F15b) ────────────────────────────────────────
    const pushStoryCmd = vscode.commands.registerCommand(
        'saga.pushStory',
        async (arg?: string | { story?: { id: string }; id?: string }) => {
            const root = requireRoot();
            if (!root || !(await requireInit(root))) { return; }
            const sagaRoot = getSagaRoot(root);

            let storyId: string | undefined;
            if (typeof arg === 'string') { storyId = arg; }
            else if (arg && typeof arg === 'object') {
                storyId = (arg as { story?: { id: string } }).story?.id ?? (arg as { id?: string }).id;
            }
            if (!storyId) {
                const stories = await listStories(sagaRoot);
                if (stories.length === 0) { vscode.window.showWarningMessage('No stories to push.'); return; }
                const picked = await vscode.window.showQuickPick(
                    stories.map((s) => ({ label: s.id, description: `${s.epic} — ${s.title}` })),
                    { placeHolder: 'Select a story to push' },
                );
                if (!picked) { return; }
                storyId = picked.label;
            }

            const adapter = await buildTrackerAdapter(root, secrets);
            if (!adapter) {
                const go = await vscode.window.showWarningMessage(
                    'Saga: No tracker configured. Set up Jira or ADO in Settings.',
                    'Open Settings',
                );
                if (go === 'Open Settings') { await vscode.commands.executeCommand('saga.openSettings'); }
                return;
            }

            const story = await readStory(sagaRoot, storyId);

            // F15b — block if parent epic has not been pushed yet
            let epicRemoteKey: string | undefined;
            try {
                const parentEpic = await readEpic(sagaRoot, story.epic);
                if (parentEpic.remote?.provider === adapter.provider && parentEpic.remote.key) {
                    epicRemoteKey = parentEpic.remote.key;
                } else {
                    // Epic exists but hasn't been pushed to this provider
                    const pushFirst = await vscode.window.showWarningMessage(
                        `${story.epic} hasn't been pushed to ${adapter.provider} yet. Push the epic first so the story can be linked to it.`,
                        { modal: true },
                        'Push Epic',
                    );
                    if (pushFirst === 'Push Epic') {
                        await vscode.commands.executeCommand('saga.pushEpic', story.epic);
                    }
                    return;
                }
            } catch {
                // Epic file not found — unusual, but allow push without parent link
            }

            const isUpdate = Boolean(story.remote?.provider === adapter.provider && story.remote?.key);
            const verb = isUpdate ? 'Updating' : 'Creating';

            let remoteKey: string | undefined;

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Saga: ${verb} ${storyId} in ${adapter.provider}…`, cancellable: false },
                async () => {
                    await pushOneStory(adapter, sagaRoot, storyId!, epicRemoteKey);
                    const updated = await readStory(sagaRoot, storyId!);
                    remoteKey = updated.remote?.key;
                },
            );

            sagaTree?.refresh();
            if (!remoteKey) { return; }

            // Subtasks are only pushable once the parent story has a remote key.
            const storyWithSubtasks = await readStory(sagaRoot, storyId);
            const unpushedSubtasks = storyWithSubtasks.subtasks.filter(
                (s) => !(s.remote?.provider === adapter.provider && s.remote.key),
            );
            const pushSubtasksLabel = unpushedSubtasks.length > 0
                ? `Push ${unpushedSubtasks.length} ${unpushedSubtasks.length === 1 ? 'Subtask' : 'Subtasks'}`
                : undefined;

            const action = await vscode.window.showInformationMessage(
                `${isUpdate ? 'Updated' : 'Created'} ${remoteKey} in ${adapter.provider}.`,
                ...(pushSubtasksLabel ? [pushSubtasksLabel, 'Open in Browser'] : ['Open in Browser']),
            );

            if (action === pushSubtasksLabel && pushSubtasksLabel) {
                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: `Saga: Pushing ${unpushedSubtasks.length} subtasks…`, cancellable: false },
                    async () => {
                        for (const s of unpushedSubtasks) {
                            await pushOneSubtask(adapter, sagaRoot, storyId!, s.id, remoteKey!);
                        }
                    },
                );
                sagaTree?.refresh();
                vscode.window.showInformationMessage(`Pushed ${unpushedSubtasks.length} subtasks under ${remoteKey}.`);
            } else if (action === 'Open in Browser') {
                const updated = await readStory(sagaRoot, storyId);
                if (updated.remote?.url) {
                    await vscode.env.openExternal(vscode.Uri.parse(updated.remote.url));
                }
            }
        },
    );

    // ── saga.pushAll (F15) ────────────────────────────────────────────────────
    const pushAllCmd = vscode.commands.registerCommand('saga.pushAll', async () => {
        const root = requireRoot();
        if (!root || !(await requireInit(root))) { return; }
        const sagaRoot = getSagaRoot(root);

        const adapter = await buildTrackerAdapter(root, secrets);
        if (!adapter) {
            const go = await vscode.window.showWarningMessage(
                'Saga: No tracker configured. Set up Jira or ADO in Settings.',
                'Open Settings',
            );
            if (go === 'Open Settings') { await vscode.commands.executeCommand('saga.openSettings'); }
            return;
        }

        const allEpics = await listEpics(sagaRoot);
        const allStories = await listStories(sagaRoot);

        // Epics that need pushing (never pushed, or drifted)
        const epicsToPush = allEpics.filter((e) => {
            if (!(e.remote?.provider === adapter.provider && e.remote.key)) { return true; }
            return e.local_hash !== e.remote.last_synced_hash;
        });

        // Stories that need pushing (never pushed, or drifted)
        const storiesToPush = allStories.filter((s) => {
            if (!(s.remote?.provider === adapter.provider && s.remote.key)) { return true; }
            return s.local_hash !== s.remote.last_synced_hash;
        });

        const total = epicsToPush.length + storiesToPush.length;
        if (total === 0) {
            vscode.window.showInformationMessage(`Everything is already up to date in ${adapter.provider}.`);
            return;
        }

        const channel = getSagaChannel();
        channel.show(true);
        channel.appendLine(`\nPush All → ${adapter.provider}  (${epicsToPush.length} epics, ${storiesToPush.length} stories)\n${'─'.repeat(50)}`);

        let done = 0;
        let failed = 0;

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Saga: Pushing to ${adapter.provider}…`, cancellable: false },
            async (progress) => {
                const report = (label: string) => {
                    done++;
                    progress.report({ message: `${done} / ${total} — ${label}` });
                };

                // Push epics first (sorted by ID so parent order is stable)
                for (const epic of epicsToPush.sort((a, b) => a.id.localeCompare(b.id))) {
                    try {
                        const remoteKey = await pushOneEpic(adapter, sagaRoot, epic.id);
                        channel.appendLine(`  ✓ ${epic.id} → ${remoteKey}`);
                        report(epic.id);
                    } catch (err) {
                        failed++;
                        channel.appendLine(`  ✗ ${epic.id}: ${err instanceof Error ? err.message : String(err)}`);
                        report(`${epic.id} (failed)`);
                    }
                }

                // Push stories — resolve parent key from the (now-refreshed) epic
                for (const story of storiesToPush.sort((a, b) => a.id.localeCompare(b.id))) {
                    try {
                        let epicRemoteKey: string | undefined;
                        try {
                            const parentEpic = await readEpic(sagaRoot, story.epic);
                            if (parentEpic.remote?.provider === adapter.provider && parentEpic.remote.key) {
                                epicRemoteKey = parentEpic.remote.key;
                            }
                        } catch { /* epic not found */ }

                        if (!epicRemoteKey) {
                            channel.appendLine(`  ✗ ${story.id}: parent ${story.epic} not pushed — skipped`);
                            failed++;
                            report(`${story.id} (skipped)`);
                            continue;
                        }

                        await pushOneStory(adapter, sagaRoot, story.id, epicRemoteKey);
                        const updated = await readStory(sagaRoot, story.id);
                        channel.appendLine(`  ✓ ${story.id} → ${updated.remote?.key ?? '?'}`);
                        report(story.id);
                    } catch (err) {
                        failed++;
                        channel.appendLine(`  ✗ ${story.id}: ${err instanceof Error ? err.message : String(err)}`);
                        report(`${story.id} (failed)`);
                    }
                }
            },
        );

        sagaTree?.refresh();

        const succeeded = total - failed;
        const summary = failed > 0
            ? `Pushed ${succeeded} / ${total} items to ${adapter.provider}. ${failed} failed — see Saga Output.`
            : `Pushed ${succeeded} epics and stories to ${adapter.provider}.`;

        channel.appendLine(`\n${'─'.repeat(50)}\n${summary}`);
        vscode.window.showInformationMessage(summary);
        void getTelemetry(root).track({ command: 'saga.pushAll', provider: adapter.provider, storyCount: storiesToPush.length });
    });

    // ── saga.sync (M3 — F11) ──────────────────────────────────────────────────
    const syncCmd = vscode.commands.registerCommand('saga.sync', async () => {
        const root = requireRoot();
        if (!root || !(await requireInit(root))) { return; }
        const sagaRoot = getSagaRoot(root);

        const adapter = await buildTrackerAdapter(root, secrets);
        if (!adapter) {
            const go = await vscode.window.showWarningMessage(
                'Saga: No tracker configured. Set up Jira or ADO in Settings.',
                'Open Settings',
            );
            if (go === 'Open Settings') { await vscode.commands.executeCommand('saga.openSettings'); }
            return;
        }

        const allEpics = await listEpics(sagaRoot);
        const allStories = await listStories(sagaRoot);

        let plan: Awaited<ReturnType<typeof buildSyncPlan>>;

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Saga: Fetching state from ${adapter.provider}…`, cancellable: false },
            async () => {
                plan = await buildSyncPlan(adapter, sagaRoot, allEpics, allStories);
            },
        );

        plan = plan!;

        // Write conflict IDs to sidecar so the tree shows ⚠ badges immediately.
        // Subtask conflicts surface as a conflict badge on their parent story —
        // the tree has no subtask-level badge rendering.
        const conflictIds = [
            ...plan.epics.filter((s) => s.kind === 'conflict').map((s) => s.local.id),
            ...plan.stories.filter((s) => s.kind === 'conflict').map((s) => s.local.id),
            ...plan.subtasks.filter((s) => s.kind === 'conflict').map((s) => s.storyId),
        ];
        await writeConflicts(sagaRoot, [...new Set(conflictIds)]);
        sagaTree?.refresh();

        if (plan.fetchErrors.length > 0) {
            const channel = getSagaChannel();
            channel.show(true);
            channel.appendLine(`\nSync fetch errors (${plan.fetchErrors.length}):`);
            for (const e of plan.fetchErrors) {
                channel.appendLine(`  ✗ ${e.sagaId}: ${e.error}`);
            }
        }

        // Build lookup maps for the apply phase
        const epicsMap = new Map<string, Epic>(allEpics.map((e) => [e.id, e]));
        const storiesMap = new Map<string, Story>(allStories.map((s) => [s.id, s]));

        const remoteEpicsMap = new Map<string, RemoteEpic>(
            plan.epics
                .filter((s): s is typeof s & { remote: RemoteEpic } => 'remote' in s)
                .map((s) => [s.local.id, s.remote]),
        );
        const remoteStoriesMap = new Map<string, RemoteStory>(
            plan.stories
                .filter((s): s is typeof s & { remote: RemoteStory } => 'remote' in s)
                .map((s) => [s.local.id, s.remote]),
        );
        const remoteSubtasksMap = new Map<string, RemoteSubtask>(
            plan.subtasks
                .filter((s): s is typeof s & { remote: RemoteSubtask } => 'remote' in s)
                .map((s) => [s.syncId, s.remote]),
        );

        await SyncReviewPanel.open({
            plan,
            adapter,
            epicsMap,
            storiesMap,
            remoteEpicsMap,
            remoteStoriesMap,
            remoteSubtasksMap,
            workspaceRoot: root,
            extensionUri: context.extensionUri,
        });

    });

    // ── saga.generateAgentPrompt (F12) ────────────────────────────────────────
    const generateAgentPromptCmd = vscode.commands.registerCommand(
        'saga.generateAgentPrompt',
        async (arg?: string | { story?: { id: string }; id?: string }) => {
            const root = requireRoot();
            if (!root || !(await requireInit(root))) { return; }
            const sagaRoot = getSagaRoot(root);

            let storyId: string | undefined;
            if (typeof arg === 'string') { storyId = arg; }
            else if (arg && typeof arg === 'object') {
                storyId = (arg as { story?: { id: string } }).story?.id ?? (arg as { id?: string }).id;
            }
            if (!storyId) {
                const stories = await listStories(sagaRoot);
                if (stories.length === 0) { vscode.window.showWarningMessage('No stories found. Generate stories first.'); return; }
                const picked = await vscode.window.showQuickPick(
                    stories.map((s) => ({ label: s.id, description: `${s.epic} — ${s.title}` })),
                    { placeHolder: 'Select a story to generate an agent prompt for' },
                );
                if (!picked) { return; }
                storyId = picked.label;
            }

            const story = await readStory(sagaRoot, storyId);

            const resolved = await resolveProviderFromConfig('agent_prompt', root, secrets);
            if (!resolved) {
                vscode.window.showErrorMessage('Saga: No AI provider available. Check Settings.');
                return;
            }

            const manager = new ContextManager(sagaRoot);
            const contextTexts = await manager.loadContextTexts();

            // F29 — let the user pick which relevant files to include full content for.
            const allFileContents = await getRelevantFileContents(root, story);
            let selectedFileContents = allFileContents;
            if (allFileContents.length > 0) {
                const scoreByPath = new Map(
                    (await findRelevantFiles(root, story)).map((f) => [f.relativePath, f.score]),
                );
                const items = allFileContents.map((f) => ({
                    label: f.relativePath,
                    description: `relevance ${(scoreByPath.get(f.relativePath) ?? 0).toFixed(2)} · ~${Math.ceil(f.content.length / 4)} tokens`,
                    picked: true,
                    file: f,
                }));
                const totalTokens = items.reduce((sum, i) => sum + Math.ceil(i.file.content.length / 4), 0);
                const picked = await vscode.window.showQuickPick(items, {
                    canPickMany: true,
                    placeHolder: `Include file contents in the prompt (~${totalTokens} tokens total) — deselect to exclude`,
                    title: 'Saga: Relevant Files to Include',
                });
                // undefined = user cancelled the picker (Escape) — proceed with none selected
                selectedFileContents = (picked ?? []).map((i) => i.file);
            }

            let promptResult: Awaited<ReturnType<typeof generateAgentPrompt>> | undefined;
            let cancelled = false;

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Saga: Generating agent prompt for ${storyId} via ${resolved.modelLabel}…`,
                    cancellable: true,
                },
                async (_progress, token) => {
                    const abort = new AbortController();
                    token.onCancellationRequested(() => abort.abort());
                    try {
                        const [stack, relevantFiles] = await Promise.all([
                            detectStack(root),
                            findRelevantFiles(root, story),
                        ]);
                        promptResult = await generateAgentPrompt(
                            resolved.provider,
                            context.extensionUri,
                            sagaRoot,
                            story,
                            stack,
                            relevantFiles,
                            contextTexts,
                            abort.signal,
                            selectedFileContents,
                        );
                    } catch (err) {
                        if (isAbortError(err)) { cancelled = true; }
                        else { throw err; }
                    }
                },
            );

            if (cancelled) { vscode.window.showInformationMessage('Saga: Agent prompt generation cancelled.'); return; }
            if (!promptResult) { return; }

            logTokenUsage('agent_prompt', resolved.modelLabel, promptResult.usage);

            await AgentPromptPanel.open({
                story,
                content: promptResult.content,
                modelLabel: resolved.modelLabel,
                tokenUsage: promptResult.usage,
                extensionUri: context.extensionUri,
                onSave: async (content) => {
                    await writePrompt(sagaRoot, storyId!, content);
                },
            });
        },
    );

    // ── saga.generateSubtasks (F28) ───────────────────────────────────────────
    const generateSubtasksCmd = vscode.commands.registerCommand(
        'saga.generateSubtasks',
        async (arg?: string | { story?: { id: string }; id?: string }) => {
            const root = requireRoot();
            if (!root || !(await requireInit(root))) { return; }
            const sagaRoot = getSagaRoot(root);

            let storyId: string | undefined;
            if (typeof arg === 'string') { storyId = arg; }
            else if (arg && typeof arg === 'object') {
                storyId = (arg as { story?: { id: string } }).story?.id ?? (arg as { id?: string }).id;
            }
            if (!storyId) {
                const stories = await listStories(sagaRoot);
                if (stories.length === 0) { vscode.window.showWarningMessage('No stories found. Generate stories first.'); return; }
                const picked = await vscode.window.showQuickPick(
                    stories.map((s) => ({ label: s.id, description: `${s.epic} — ${s.title}` })),
                    { placeHolder: 'Select a story to propose subtasks for' },
                );
                if (!picked) { return; }
                storyId = picked.label;
            }

            const story = await readStory(sagaRoot, storyId);

            const resolved = await resolveProviderFromConfig('subtask_generation', root, secrets);
            if (!resolved) {
                vscode.window.showErrorMessage('Saga: No AI provider available. Check Settings.');
                return;
            }

            let result: Awaited<ReturnType<typeof generateSubtasks>> | undefined;
            let cancelled = false;

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Saga: Proposing subtasks for ${storyId} via ${resolved.modelLabel}…`,
                    cancellable: true,
                },
                async (_progress, token) => {
                    const abort = new AbortController();
                    token.onCancellationRequested(() => abort.abort());
                    try {
                        result = await generateSubtasks(resolved.provider, story, abort.signal);
                        // The underlying provider may not interrupt an in-flight request on
                        // cancellation (best-effort only) — re-check after the await resolves
                        // so a late cancel still discards the result instead of writing it.
                        if (abort.signal.aborted) { cancelled = true; result = undefined; }
                    } catch (err) {
                        if (isAbortError(err) || abort.signal.aborted) { cancelled = true; }
                        else { throw err; }
                    }
                },
            );

            if (cancelled) { vscode.window.showInformationMessage('Saga: Subtask generation cancelled.'); return; }
            if (!result) { return; }

            logTokenUsage('subtask_generation', resolved.modelLabel, result.usage);

            // Merge proposed subtasks into the story, allocating scoped IDs, and open the editor.
            const updated: Story = { ...story, subtasks: [...story.subtasks] };
            for (const proposed of result.items) {
                const id = nextSubtaskId(updated);
                updated.subtasks.push({ id, title: proposed.title, type: proposed.type, done: false });
            }
            await writeStory(sagaRoot, updated);
            sagaTree?.refresh();

            const openIt = await vscode.window.showInformationMessage(
                `Added ${result.items.length} subtask(s) to ${storyId}.`,
                'Open Story',
            );
            if (openIt === 'Open Story') {
                await vscode.commands.executeCommand('saga.openStory', storyId);
            }
        },
    );

    // ── saga.splitStory (F34) ─────────────────────────────────────────────────
    const splitStoryCmd = vscode.commands.registerCommand(
        'saga.splitStory',
        async (arg?: string | { story?: { id: string }; id?: string }) => {
            const root = requireRoot();
            if (!root || !(await requireInit(root))) { return; }
            const sagaRoot = getSagaRoot(root);

            let storyId: string | undefined;
            if (typeof arg === 'string') { storyId = arg; }
            else if (arg && typeof arg === 'object') {
                storyId = (arg as { story?: { id: string } }).story?.id ?? (arg as { id?: string }).id;
            }
            if (!storyId) {
                const stories = await listStories(sagaRoot);
                if (stories.length === 0) { vscode.window.showWarningMessage('No stories found. Generate stories first.'); return; }
                const picked = await vscode.window.showQuickPick(
                    stories.map((s) => ({ label: s.id, description: `${s.epic} — ${s.title}` })),
                    { placeHolder: 'Select a story to split' },
                );
                if (!picked) { return; }
                storyId = picked.label;
            }

            const story = await readStory(sagaRoot, storyId);

            // Confirm before splitting a story that doesn't actually look too large —
            // re-validate rather than trusting a possibly-stale story.invest.
            const validator = new InvestValidator();
            const invest = await validator.validate(story);
            if (invest.small.result === 'pass') {
                const proceed = await vscode.window.showWarningMessage(
                    `${storyId} doesn't currently fail the INVEST "Small" check. Split it anyway?`,
                    { modal: true },
                    'Split Anyway',
                );
                if (proceed !== 'Split Anyway') { return; }
            }

            const resolved = await resolveProviderFromConfig('story_splitting', root, secrets);
            if (!resolved) {
                vscode.window.showErrorMessage('Saga: No AI provider available. Check Settings.');
                return;
            }

            const storyForSplit: Story = { ...story, invest };

            let result: Awaited<ReturnType<GenerationService['splitStory']>> | undefined;
            let cancelled = false;

            const runSplit = async (signal: AbortSignal) => {
                const service = new GenerationService(resolved.provider, context.extensionUri, sagaRoot);
                const startId = await nextStoryId(sagaRoot);
                return service.splitStory(storyForSplit, startId, signal);
            };

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Saga: Splitting ${storyId} via ${resolved.modelLabel}…`,
                    cancellable: true,
                },
                async (_progress, token) => {
                    const abort = new AbortController();
                    token.onCancellationRequested(() => abort.abort());
                    try {
                        result = await runSplit(abort.signal);
                    } catch (err) {
                        if (isAbortError(err)) { cancelled = true; }
                        else { throw err; }
                    }
                },
            );

            if (cancelled) { vscode.window.showInformationMessage('Saga: Story split cancelled.'); return; }
            if (!result) { return; }

            logTokenUsage('story_splitting', resolved.modelLabel, result.usage);

            await GenerationReviewPanel.open({
                mode: 'stories',
                epics: [],
                stories: result.items,
                modelLabel: resolved.modelLabel,
                contextFileCount: 0,
                tokenUsage: result.usage,
                workspaceRoot: root,
                extensionUri: context.extensionUri,
                onRegenerate: async (signal) => {
                    const r = await resolveProviderFromConfig('story_splitting', root, secrets) ?? resolved;
                    const service = new GenerationService(r.provider, context.extensionUri, sagaRoot);
                    const startId = await nextStoryId(sagaRoot);
                    const fresh = await service.splitStory(storyForSplit, startId, signal);
                    logTokenUsage('story_splitting', r.modelLabel, fresh.usage);
                    return { epics: [], stories: fresh.items, modelLabel: r.modelLabel, tokenUsage: fresh.usage };
                },
                // Only delete the original once the replacement stories are safely persisted.
                onSaved: async () => {
                    await vscode.commands.executeCommand('saga.deleteStory', storyId);
                },
            });
        },
    );

    // ── saga.generateAgentsMd (F13) ───────────────────────────────────────────
    const generateAgentsMdCmd = vscode.commands.registerCommand('saga.generateAgentsMd', async () => {
        const root = requireRoot();
        if (!root || !(await requireInit(root))) { return; }
        const sagaRoot = getSagaRoot(root);

        // Check if AGENTS.md already exists and warn if it's been hand-edited
        const agentsMdUri = vscode.Uri.joinPath(root, 'AGENTS.md');
        let existingContent: string | undefined;
        let hasExisting = false;
        try {
            const bytes = await vscode.workspace.fs.readFile(agentsMdUri);
            existingContent = Buffer.from(bytes).toString('utf-8');
            hasExisting = true;

            const lockHash = await readLock(sagaRoot);
            const currentHash = sha256(existingContent);
            if (lockHash && lockHash !== currentHash) {
                const proceed = await vscode.window.showWarningMessage(
                    'AGENTS.md has been hand-edited since last generation. Regenerating will overwrite your changes.',
                    { modal: true },
                    'Regenerate Anyway',
                );
                if (proceed !== 'Regenerate Anyway') { return; }
            }
        } catch {
            // AGENTS.md doesn't exist yet — no warning needed
        }

        const resolved = await resolveProviderFromConfig('agents_md', root, secrets);
        if (!resolved) {
            vscode.window.showErrorMessage('Saga: No AI provider available. Check Settings.');
            return;
        }

        const manager = new ContextManager(sagaRoot);
        const contextTexts = await manager.loadContextTexts();

        let genResult: Awaited<ReturnType<typeof generateAgentsMd>> | undefined;
        let cancelled = false;

        const runGeneration = async (signal: AbortSignal) => {
            const [stack, layout] = await Promise.all([
                detectStack(root),
                getDirectoryLayout(root),
            ]);
            return generateAgentsMd(
                resolved.provider,
                context.extensionUri,
                sagaRoot,
                stack,
                layout,
                contextTexts,
                existingContent,
                signal,
            );
        };

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Saga: Generating AGENTS.md via ${resolved.modelLabel}…`,
                cancellable: true,
            },
            async (_progress, token) => {
                const abort = new AbortController();
                token.onCancellationRequested(() => abort.abort());
                try {
                    genResult = await runGeneration(abort.signal);
                } catch (err) {
                    if (isAbortError(err)) { cancelled = true; }
                    else { throw err; }
                }
            },
        );

        if (cancelled) { vscode.window.showInformationMessage('Saga: AGENTS.md generation cancelled.'); return; }
        if (!genResult) { return; }

        logTokenUsage('agents_md', resolved.modelLabel, genResult.usage);

        await AgentsMdPanel.open({
            content: genResult.content,
            modelLabel: resolved.modelLabel,
            tokenUsage: genResult.usage,
            hasExisting,
            extensionUri: context.extensionUri,
            onAccept: async (content) => {
                await vscode.workspace.fs.writeFile(agentsMdUri, Buffer.from(content, 'utf-8'));
                await writeLock(sagaRoot, content);
                vscode.window.showInformationMessage('AGENTS.md saved to workspace root.');
            },
            onRegenerate: async (signal) => {
                const r = await resolveProviderFromConfig('agents_md', root, secrets) ?? resolved;
                const fresh = await runGeneration(signal);
                logTokenUsage('agents_md', r.modelLabel, fresh.usage);
                return { content: fresh.content, modelLabel: r.modelLabel, tokenUsage: fresh.usage };
            },
        });
    });

    // ── saga.exportBacklog (F32) ──────────────────────────────────────────────
    const exportBacklogCmd = vscode.commands.registerCommand('saga.exportBacklog', async () => {
        const root = requireRoot();
        if (!root || !(await requireInit(root))) { return; }

        const format = await vscode.window.showQuickPick(
            [
                { label: 'Markdown', description: '.md', format: 'markdown' as const },
                { label: 'Word', description: '.docx', format: 'docx' as const },
                { label: 'Excel', description: '.xlsx', format: 'xlsx' as const },
            ],
            { placeHolder: 'Select an export format', title: 'Saga: Export Backlog' },
        );
        if (!format) { return; }

        const groups = await collectBacklog(root);
        if (groups.length === 0) {
            vscode.window.showWarningMessage('Saga: No epics to export yet.');
            return;
        }

        const ext = format.format === 'markdown' ? 'md' : format.format;
        const filters: Record<string, string[]> = format.format === 'markdown'
            ? { Markdown: ['md'] }
            : format.format === 'docx'
                ? { Word: ['docx'] }
                : { Excel: ['xlsx'] };

        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.joinPath(root, `saga-backlog.${ext}`),
            filters,
            title: 'Saga: Export Backlog',
        });
        if (!saveUri) { return; }

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Saga: Exporting backlog to ${format.label}…`, cancellable: false },
            async () => {
                if (format.format === 'markdown') {
                    const { exportMarkdown } = await import('./export/export-markdown.js');
                    const content = exportMarkdown(groups);
                    await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, 'utf-8'));
                } else if (format.format === 'docx') {
                    const { exportDocx } = await import('./export/export-docx.js');
                    const buffer = await exportDocx(groups);
                    await vscode.workspace.fs.writeFile(saveUri, buffer);
                } else {
                    const { exportXlsx } = await import('./export/export-xlsx.js');
                    const buffer = await exportXlsx(groups);
                    await vscode.workspace.fs.writeFile(saveUri, buffer);
                }
            },
        );

        const action = await vscode.window.showInformationMessage(
            `Saga: Exported backlog to ${saveUri.fsPath}.`,
            'Open File',
        );
        if (action === 'Open File') {
            await vscode.env.openExternal(saveUri);
        }
    });

    // ── saga.openTemplate / saga.resetTemplate (F16) ──────────────────────────
    const openTemplateCmd = vscode.commands.registerCommand('saga.openTemplate', async () => {
        const root = requireRoot();
        if (!root || !(await requireInit(root))) { return; }
        await openTemplate(root, context.extensionUri);
    });

    const resetTemplateCmd = vscode.commands.registerCommand('saga.resetTemplate', async () => {
        const root = requireRoot();
        if (!root || !(await requireInit(root))) { return; }
        await resetTemplate(root);
    });

    // ── saga.openContextFile (F30) ────────────────────────────────────────────
    const openContextFileCmd = vscode.commands.registerCommand(
        'saga.openContextFile',
        async (arg?: string | { filename?: string }) => {
            const root = requireRoot();
            if (!root || !(await requireInit(root))) { return; }
            const sagaRoot = getSagaRoot(root);

            const filename = typeof arg === 'string' ? arg : arg?.filename;
            if (!filename) { return; }

            // Inline context entries always live at .saga/context/<filename>.
            if (filename.startsWith('inline-')) {
                const uri = vscode.Uri.joinPath(getContextDir(sagaRoot), filename);
                try {
                    const doc = await vscode.workspace.openTextDocument(uri);
                    await vscode.window.showTextDocument(doc);
                } catch {
                    vscode.window.showErrorMessage(`Saga: Could not open ${filename}.`);
                }
                return;
            }

            const registry = await readContextRegistry(sagaRoot);
            const entry = registry.entries.find((e) => e.filename === filename);

            // Prefer the original registered path if it still exists.
            if (entry?.path) {
                try {
                    const originalUri = vscode.Uri.file(entry.path);
                    await vscode.workspace.fs.stat(originalUri);
                    const doc = await vscode.workspace.openTextDocument(originalUri);
                    await vscode.window.showTextDocument(doc);
                    return;
                } catch {
                    // Original path moved/deleted — fall back to the .saga/context/ copy.
                }
            }

            const copyUri = vscode.Uri.joinPath(getContextDir(sagaRoot), filename);
            try {
                const doc = await vscode.workspace.openTextDocument(copyUri);
                await vscode.window.showTextDocument(doc);
            } catch {
                vscode.window.showInformationMessage(`Saga: "${filename}" could not be found — the original file may have been moved or deleted.`);
            }
        },
    );

    // ── saga.openSettings ──────────────────────────────────────────────────────
    const openSettingsCmd = vscode.commands.registerCommand('saga.openSettings', async () => {
        const root = requireRoot();
        if (!root || !(await requireInit(root))) { return; }
        await SettingsPanel.open(root, context.extensionUri, secrets);
    });

    // ── saga.moreActions (F38) ────────────────────────────────────────────────
    const moreActionsCmd = vscode.commands.registerCommand('saga.moreActions', async () => {
        const items: Array<{ label: string; description: string; command: string }> = [
            { label: '$(gear) Settings', description: 'Configure AI provider, model routing, tracker, budget', command: 'saga.openSettings' },
            { label: '$(file-code) Generate AGENTS.md', description: 'Generate/update AGENTS.md for coding agents', command: 'saga.generateAgentsMd' },
            { label: '$(export) Export Backlog', description: 'Export epics and stories to Markdown, Word, or Excel', command: 'saga.exportBacklog' },
            { label: '$(rocket) Getting Started', description: 'Guided onboarding: provider, context, first epic', command: 'saga.gettingStarted' },
            { label: '$(files) Open Template', description: 'Edit a generation/prompt template', command: 'saga.openTemplate' },
            { label: '$(discard) Reset Template', description: 'Revert a customized template to its default', command: 'saga.resetTemplate' },
            { label: '$(clear-all) Clear Epics', description: 'Delete all epics and their stories', command: 'saga.clearEpics' },
            { label: '$(trash) Clean Up', description: 'Remove the entire .saga/ workspace (double confirmation)', command: 'saga.cleanUp' },
        ];
        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: 'Saga: More Actions',
            title: 'Saga: More Actions',
        });
        if (!picked) { return; }
        await vscode.commands.executeCommand(picked.command);
    });

    // ── saga.testGeneration (M0 smoke test) ────────────────────────────────────
    const testGenCmd = vscode.commands.registerCommand('saga.testGeneration', async () => {
        const root = requireRoot();
        if (!root || !(await requireInit(root))) { return; }
        const resolved = await resolveProviderFromConfig('story_generation', root, secrets);
        if (!resolved) {
            vscode.window.showErrorMessage('Saga: No AI provider available. Install GitHub Copilot or start Ollama.');
            return;
        }
        let output = '';
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Saga: Testing via ${resolved.modelLabel}…`, cancellable: false },
            async () => {
                const response = await resolved.provider.generate({
                    messages: [
                        { role: 'system', content: 'You are an expert agile coach. Reply concisely.' },
                        { role: 'user', content: 'Write one INVEST-compliant user story for a guest checkout feature. Include one Gherkin acceptance scenario.' },
                    ],
                    maxTokens: 400,
                });
                output = response.content;
            },
        );
        const doc = await vscode.workspace.openTextDocument({
            language: 'markdown',
            content: `# Saga — Test Generation\n\n**Model:** ${resolved.modelLabel}\n\n---\n\n${output}`,
        });
        await vscode.window.showTextDocument(doc);
    });

    context.subscriptions.push(
        initCmd,
        gettingStartedCmd,
        addContextFileCmd,
        addInlineContextCmd,
        generateEpicsCmd,
        generateStoriesCmd,
        validateStoriesCmd,
        openStoryCmd,
        editEpicCmd,
        deleteEpicCmd,
        deleteStoryCmd,
        clearStoriesForEpicCmd,
        clearEpicsCmd,
        cleanUpCmd,
        pushEpicCmd,
        pushStoryCmd,
        pushAllCmd,
        syncCmd,
        generateAgentPromptCmd,
        generateSubtasksCmd,
        splitStoryCmd,
        generateAgentsMdCmd,
        exportBacklogCmd,
        openTemplateCmd,
        resetTemplateCmd,
        openContextFileCmd,
        openSettingsCmd,
        moreActionsCmd,
        testGenCmd,
    );
}

export function deactivate() {}
