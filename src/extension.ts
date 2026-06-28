import * as vscode from 'vscode';
import { SecretsManager } from './secrets';
import { initSagaFolder, getWorkspaceRoot, isSagaInitialized } from './saga-fs';
import { getSagaRoot, listEpics, listStories, readEpic, nextEpicId, nextStoryId } from './saga-repo';
import { ContextManager } from './context/manager';
import { GenerationService } from './generation/service';
import { InvestValidator } from './invest/validator';
import { SagaTreeProvider, ContextTreeProvider } from './tree/saga-tree';
import { StoryPanel } from './webview/story-panel';
import { SettingsPanel } from './webview/settings-panel';
import { GenerationReviewPanel } from './webview/generation-review-panel';
import { resolveProviderFromConfig } from './llm/routing';

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

        let epics: Awaited<ReturnType<GenerationService['generateEpics']>> = [];
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Saga: Generating epics via ${resolved.modelLabel}…`, cancellable: false },
            async () => {
                const service = new GenerationService(resolved.provider);
                const startId = await nextEpicId(sagaRoot);
                epics = await service.generateEpics(contextTexts, startId, instructions);
            },
        );

        await GenerationReviewPanel.open({
            mode: 'epics',
            epics,
            stories: [],
            modelLabel: resolved.modelLabel,
            contextFileCount: contextTexts.length,
            workspaceRoot: root,
            extensionUri: context.extensionUri,
            onRegenerate: async () => {
                const r = await resolveProviderFromConfig('epic_generation', root) ?? resolved;
                const service = new GenerationService(r.provider);
                const startId = await nextEpicId(sagaRoot);
                const fresh = await service.generateEpics(contextTexts, startId, instructions);
                return { epics: fresh, stories: [], modelLabel: r.modelLabel };
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

            let stories: Awaited<ReturnType<GenerationService['generateStories']>> = [];
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Saga: Generating stories via ${resolved.modelLabel}…`, cancellable: false },
                async () => {
                    const service = new GenerationService(resolved.provider);
                    const startId = await nextStoryId(sagaRoot);
                    stories = await service.generateStories(epic, siblingEpics, contextTexts, startId, instructions);
                },
            );

            await GenerationReviewPanel.open({
                mode: 'stories',
                epics: [],
                stories,
                modelLabel: resolved.modelLabel,
                contextFileCount: contextTexts.length,
                workspaceRoot: root,
                extensionUri: context.extensionUri,
                onRegenerate: async () => {
                    const r = await resolveProviderFromConfig('story_generation', root) ?? resolved;
                    const service = new GenerationService(r.provider);
                    const startId = await nextStoryId(sagaRoot);
                    const fresh = await service.generateStories(epic, siblingEpics, contextTexts, startId, instructions);
                    return { epics: [], stories: fresh, modelLabel: r.modelLabel };
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

        const channel = vscode.window.createOutputChannel('Saga');
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

    // ── saga.deleteEpic (F25) ──────────────────────────────────────────────────
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

            const stories = await listStories(sagaRoot, epicId);
            const storyNote = stories.length > 0
                ? ` This will also offer to delete ${stories.length} child story(ies).`
                : '';

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
                const deleteStories = await vscode.window.showWarningMessage(
                    `Also delete ${stories.length} story(ies) under ${epicId}?`,
                    { modal: true }, 'Delete Stories', 'Keep Stories',
                );
                if (deleteStories === 'Delete Stories') {
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

    // ── saga.deleteStory (F25) ─────────────────────────────────────────────────
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
        cleanUpCmd,
        openSettingsCmd,
        testGenCmd,
    );
}

export function deactivate() {}
