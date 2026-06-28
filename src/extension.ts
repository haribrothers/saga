import * as vscode from 'vscode';
import { SecretsManager } from './secrets';
import { initSagaFolder, getWorkspaceRoot, isSagaInitialized } from './saga-fs';
import { getSagaRoot, listEpics, listStories, readEpic, readStory, writeEpic, writeStory, nextEpicId, nextStoryId } from './saga-repo';
import { ContextManager } from './context/manager';
import { GenerationService } from './generation/service';
import { InvestValidator } from './invest/validator';
import { SagaTreeProvider, ContextTreeProvider } from './tree/saga-tree';
import { StoryPanel } from './webview/story-panel';
import { SettingsPanel } from './webview/settings-panel';
import { GenerationReviewPanel } from './webview/generation-review-panel';
import { resolveProviderFromConfig } from './llm/routing';
import { buildTrackerAdapter } from './tracker/factory';
import { hashEpic, hashStory } from './tracker/hash';
import { setMapping, readMappings, writeMappings } from './tracker/sync-store';
import { buildSyncPlan } from './tracker/sync-engine';
import { writeConflicts } from './tracker/conflicts-store';
import { SyncReviewPanel } from './webview/sync-review-panel';
import type { TrackerAdapter, RemoteEpic, RemoteStory } from './tracker/adapter';
import type { Epic, Story } from './schema';

// ─── Module-level helpers ─────────────────────────────────────────────────────

let sagaOutputChannel: vscode.OutputChannel | undefined;

function getSagaChannel(): vscode.OutputChannel {
    if (!sagaOutputChannel) {
        sagaOutputChannel = vscode.window.createOutputChannel('Saga');
    }
    return sagaOutputChannel;
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
    void secrets; // used by BYOK providers in M4

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
        const choice = await vscode.window.showInformationMessage(
            'Saga initialized! Configure your AI provider in Settings.',
            'Open Settings',
        );
        if (choice === 'Open Settings') { await vscode.commands.executeCommand('saga.openSettings'); }
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

        const resolved = await resolveProviderFromConfig('epic_generation', root);
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
                    const service = new GenerationService(resolved.provider);
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
                const r = await resolveProviderFromConfig('epic_generation', root) ?? resolved;
                const service = new GenerationService(r.provider);
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

            // Pre-generation instructions
            const instructions = await vscode.window.showInputBox({
                title: `Generate Stories for ${epicId} — Additional Instructions`,
                prompt: 'Optional: add instructions to guide the AI (press Enter to skip)',
                placeHolder: 'e.g. "Keep stories under 5 points" or "Focus on mobile UX"',
                ignoreFocusOut: true,
            });
            if (instructions === undefined) { return; }

            const resolved = await resolveProviderFromConfig('story_generation', root);
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
                        const service = new GenerationService(resolved.provider);
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
                    const r = await resolveProviderFromConfig('story_generation', root) ?? resolved;
                    const service = new GenerationService(r.provider);
                    const startId = await nextStoryId(sagaRoot);
                    const fresh = await service.generateStories(epic, siblingEpics, contextTexts, startId, instructions, signal);
                    logTokenUsage('story_generation', r.modelLabel, fresh.usage);
                    return { epics: [], stories: fresh.items, modelLabel: r.modelLabel, tokenUsage: fresh.usage };
                },
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

        const resolved = await resolveProviderFromConfig('invest_validation', root);
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
            const resolved = await resolveProviderFromConfig('invest_validation', root);
            await StoryPanel.open(storyId, root, context.extensionUri, resolved?.provider);
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
            local_hash: hashStory(story),
        });
        await setMapping(sagaRoot, storyId, adapter.provider, {
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
                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: `Saga: Pushing ${unpushed.length} stories…`, cancellable: false },
                    async () => {
                        for (const s of unpushed) {
                            await pushOneStory(adapter, sagaRoot, s.id, remoteKey);
                        }
                    },
                );
                sagaTree?.refresh();
                vscode.window.showInformationMessage(`Pushed ${unpushed.length} stories under ${remoteKey}.`);
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

            const action = await vscode.window.showInformationMessage(
                `${isUpdate ? 'Updated' : 'Created'} ${remoteKey} in ${adapter.provider}.`,
                'Open in Browser',
            );
            if (action === 'Open in Browser') {
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

        // Write conflict IDs to sidecar so the tree shows ⚠ badges immediately
        const conflictIds = [
            ...plan.epics.filter((s) => s.kind === 'conflict').map((s) => s.local.id),
            ...plan.stories.filter((s) => s.kind === 'conflict').map((s) => s.local.id),
        ];
        await writeConflicts(sagaRoot, conflictIds);
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

        await SyncReviewPanel.open({
            plan,
            adapter,
            epicsMap,
            storiesMap,
            remoteEpicsMap,
            remoteStoriesMap,
            workspaceRoot: root,
            extensionUri: context.extensionUri,
        });

    });

    // ── saga.openSettings ──────────────────────────────────────────────────────
    const openSettingsCmd = vscode.commands.registerCommand('saga.openSettings', async () => {
        const root = requireRoot();
        if (!root || !(await requireInit(root))) { return; }
        await SettingsPanel.open(root, context.extensionUri, secrets);
    });

    // ── saga.testGeneration (M0 smoke test) ────────────────────────────────────
    const testGenCmd = vscode.commands.registerCommand('saga.testGeneration', async () => {
        const root = requireRoot();
        if (!root || !(await requireInit(root))) { return; }
        const resolved = await resolveProviderFromConfig('story_generation', root);
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
        addContextFileCmd,
        addInlineContextCmd,
        generateEpicsCmd,
        generateStoriesCmd,
        validateStoriesCmd,
        openStoryCmd,
        deleteEpicCmd,
        deleteStoryCmd,
        clearStoriesForEpicCmd,
        clearEpicsCmd,
        cleanUpCmd,
        pushEpicCmd,
        pushStoryCmd,
        pushAllCmd,
        syncCmd,
        openSettingsCmd,
        testGenCmd,
    );
}

export function deactivate() {}
