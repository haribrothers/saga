import * as vscode from 'vscode';
import { SecretsManager } from './secrets';
import { initSagaFolder, getWorkspaceRoot, isSagaInitialized } from './saga-fs';
import { getSagaRoot, listEpics, listStories, readEpic, nextEpicId, nextStoryId, writeEpic, writeStory } from './saga-repo';
import { VsCodeLmProvider } from './llm/vscode-lm';
import { LocalLmProvider } from './llm/local';
import { resolveProvider } from './llm/provider';
import { ContextManager } from './context/manager';
import { GenerationService } from './generation/service';
import { InvestValidator } from './invest/validator';
import { SagaTreeProvider, ContextTreeProvider } from './tree/saga-tree';
import { StoryPanel } from './webview/story-panel';

export function activate(context: vscode.ExtensionContext) {
    const secrets = new SecretsManager(context.secrets);
    void secrets; // will be used by BYOK providers in M4

    // ── Provider chain ─────────────────────────────────────────────────────────
    const vscodeLm = new VsCodeLmProvider();
    const localLm = new LocalLmProvider();

    async function getProvider() {
        return resolveProvider([vscodeLm, localLm]);
    }

    // ── Workspace helpers ──────────────────────────────────────────────────────
    function requireRoot(): vscode.Uri | undefined {
        const root = getWorkspaceRoot();
        if (!root) {
            vscode.window.showErrorMessage('Saga: Open a workspace folder first.');
        }
        return root;
    }

    async function requireInit(root: vscode.Uri): Promise<boolean> {
        if (!(await isSagaInitialized(root))) {
            const choice = await vscode.window.showWarningMessage(
                'Saga is not initialized in this workspace.',
                'Run Saga: Init',
            );
            if (choice === 'Run Saga: Init') {
                await vscode.commands.executeCommand('saga.init');
            }
            return false;
        }
        return true;
    }

    // ── Tree providers ─────────────────────────────────────────────────────────
    // We defer creation until we know the workspace root; for now register
    // placeholder providers that refresh once the workspace is confirmed.
    const root = getWorkspaceRoot();

    let sagaTree: SagaTreeProvider | undefined;
    let contextTree: ContextTreeProvider | undefined;

    if (root) {
        const sagaRoot = getSagaRoot(root);
        sagaTree = new SagaTreeProvider(sagaRoot);
        contextTree = new ContextTreeProvider(sagaRoot);
        context.subscriptions.push(sagaTree, contextTree);

        vscode.window.createTreeView('saga.storiesView', {
            treeDataProvider: sagaTree,
            showCollapseAll: true,
        });
        vscode.window.createTreeView('saga.contextView', {
            treeDataProvider: contextTree,
        });
    }

    // ── saga.init ──────────────────────────────────────────────────────────────
    const initCmd = vscode.commands.registerCommand('saga.init', async () => {
        const root = requireRoot();
        if (!root) {return;}

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Saga: Initializing .saga/ folder…', cancellable: false },
            async () => { await initSagaFolder(root); },
        );

        // Attach tree providers if this is the first init
        if (!sagaTree) {
            const sagaRoot = getSagaRoot(root);
            sagaTree = new SagaTreeProvider(sagaRoot);
            contextTree = new ContextTreeProvider(sagaRoot);
            context.subscriptions.push(sagaTree, contextTree);
            vscode.window.createTreeView('saga.storiesView', { treeDataProvider: sagaTree, showCollapseAll: true });
            vscode.window.createTreeView('saga.contextView', { treeDataProvider: contextTree });
        }

        const choice = await vscode.window.showInformationMessage(
            'Saga initialized! Configure your AI provider in .saga/config.yaml.',
            'Open config.yaml',
        );
        if (choice === 'Open config.yaml') {
            const configUri = vscode.Uri.joinPath(root, '.saga', 'config.yaml');
            await vscode.window.showTextDocument(configUri);
        }
    });

    // ── saga.addContextFile ────────────────────────────────────────────────────
    const addContextFileCmd = vscode.commands.registerCommand(
        'saga.addContextFile',
        async (fileUri?: vscode.Uri) => {
            const root = requireRoot();
            if (!root || !(await requireInit(root))) {return;}

            const manager = new ContextManager(getSagaRoot(root));
            const entry = await manager.addContextFile(fileUri);
            if (entry) {
                contextTree?.refresh();
                vscode.window.showInformationMessage(
                    `Added "${entry.filename}" as [${entry.role}] context.`,
                );
            }
        },
    );

    // ── saga.generateEpics ─────────────────────────────────────────────────────
    const generateEpicsCmd = vscode.commands.registerCommand('saga.generateEpics', async () => {
        const root = requireRoot();
        if (!root || !(await requireInit(root))) {return;}

        const provider = await getProvider();
        if (!provider) {
            vscode.window.showErrorMessage(
                'Saga: No AI provider available. Install GitHub Copilot or start Ollama.',
            );
            return;
        }

        const sagaRoot = getSagaRoot(root);
        const manager = new ContextManager(sagaRoot);
        const contextTexts = await manager.loadContextTexts();

        if (contextTexts.length === 0) {
            const add = 'Add Context File';
            const choice = await vscode.window.showWarningMessage(
                'No context files registered. Add a product brief or design doc first.',
                add,
            );
            if (choice === add) {
                await vscode.commands.executeCommand('saga.addContextFile');
            }
            return;
        }

        let epics: Awaited<ReturnType<GenerationService['generateEpics']>>;

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Saga: Generating epics via ${provider.displayName}…`,
                cancellable: false,
            },
            async () => {
                const service = new GenerationService(provider);
                const startId = await nextEpicId(sagaRoot);
                epics = await service.generateEpics(contextTexts, startId);
            },
        );

        // Show proposed epics in a preview document before writing
        const preview = epics!
            .map((e) => `# ${e.id}: ${e.title}\n\n${e.description ?? ''}`)
            .join('\n\n---\n\n');

        const doc = await vscode.workspace.openTextDocument({
            language: 'markdown',
            content: `# Saga — Proposed Epics\n\nReview the epics below, then run **Saga: Confirm Epics** to save them.\n\n${preview}`,
        });
        await vscode.window.showTextDocument(doc);

        // Ask for confirmation
        const confirm = await vscode.window.showInformationMessage(
            `Generated ${epics!.length} epic(s). Save them to .saga/epics/?`,
            'Save Epics',
            'Discard',
        );

        if (confirm === 'Save Epics') {
            for (const epic of epics!) {
                await writeEpic(sagaRoot, epic);
            }
            sagaTree?.refresh();
            vscode.window.showInformationMessage(`Saved ${epics!.length} epic(s) to .saga/epics/`);
        }
    });

    // ── saga.generateStoriesForEpic ────────────────────────────────────────────
    const generateStoriesCmd = vscode.commands.registerCommand(
        'saga.generateStoriesForEpic',
        async (epicId?: string) => {
            const root = requireRoot();
            if (!root || !(await requireInit(root))) {return;}

            const sagaRoot = getSagaRoot(root);

            // If not invoked from tree (no epicId), ask the user to pick one
            if (!epicId) {
                const epics = await listEpics(sagaRoot);
                if (epics.length === 0) {
                    vscode.window.showWarningMessage('No epics found. Generate epics first.');
                    return;
                }
                const picked = await vscode.window.showQuickPick(
                    epics.map((ep) => ({ label: ep.id, description: ep.title })),
                    { placeHolder: 'Select an epic to generate stories for' },
                );
                if (!picked) {return;}
                epicId = picked.label;
            }

            const epic = await readEpic(sagaRoot, epicId);

            const provider = await getProvider();
            if (!provider) {
                vscode.window.showErrorMessage('Saga: No AI provider available.');
                return;
            }

            const manager = new ContextManager(sagaRoot);
            const contextTexts = await manager.loadContextTexts();

            let stories: Awaited<ReturnType<GenerationService['generateStories']>>;

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Saga: Generating stories for ${epicId}…`,
                    cancellable: false,
                },
                async () => {
                    const service = new GenerationService(provider);
                    const startId = await nextStoryId(sagaRoot);
                    stories = await service.generateStories(epic, contextTexts, startId);
                },
            );

            const confirm = await vscode.window.showInformationMessage(
                `Generated ${stories!.length} story(ies) for ${epicId}. Save them?`,
                'Save Stories',
                'Discard',
            );

            if (confirm === 'Save Stories') {
                for (const story of stories!) {
                    await writeStory(sagaRoot, story);
                }
                sagaTree?.refresh();
                vscode.window.showInformationMessage(
                    `Saved ${stories!.length} story(ies) to .saga/stories/`,
                );
            }
        },
    );

    // ── saga.validateStories ───────────────────────────────────────────────────
    const validateStoriesCmd = vscode.commands.registerCommand('saga.validateStories', async () => {
        const root = requireRoot();
        if (!root || !(await requireInit(root))) {return;}

        const sagaRoot = getSagaRoot(root);
        const stories = await listStories(sagaRoot);

        if (stories.length === 0) {
            vscode.window.showInformationMessage('No stories to validate yet.');
            return;
        }

        const provider = await getProvider();
        const validator = new InvestValidator(provider ?? undefined);

        const channel = vscode.window.createOutputChannel('Saga');
        channel.show();
        channel.appendLine(`INVEST Validation — ${stories.length} story(ies)\n${'─'.repeat(50)}`);

        let passCount = 0;
        let warnCount = 0;
        let failCount = 0;

        for (const story of stories) {
            const result = await validator.validate(story);
            const criteria = Object.entries(result) as [string, { result: string; reason: string }][];

            const worst = criteria.some(([, v]) => v.result === 'fail')
                ? 'FAIL'
                : criteria.some(([, v]) => v.result === 'warn')
                ? 'WARN'
                : 'PASS';

            channel.appendLine(`\n${story.id}: ${story.title}  [${worst}]`);
            for (const [key, val] of criteria) {
                const icon = val.result === 'pass' ? '✓' : val.result === 'warn' ? '⚠' : '✗';
                channel.appendLine(`  ${icon} ${key.padEnd(12)} ${val.reason}`);
                if (val.result === 'pass') {passCount++;}
                else if (val.result === 'warn') {warnCount++;}
                else {failCount++;}
            }
        }

        channel.appendLine(
            `\n${'─'.repeat(50)}\nSummary: ${passCount} pass  ${warnCount} warn  ${failCount} fail`,
        );
    });

    // ── saga.openStory ─────────────────────────────────────────────────────────
    const openStoryCmd = vscode.commands.registerCommand(
        'saga.openStory',
        async (storyId: string) => {
            const root = requireRoot();
            if (!root || !(await requireInit(root))) {return;}

            const provider = await getProvider();
            await StoryPanel.open(storyId, root, context.extensionUri, provider ?? undefined);
        },
    );

    // ── saga.testGeneration (M0 smoke test — kept for dev) ────────────────────
    const testGenCmd = vscode.commands.registerCommand('saga.testGeneration', async () => {
        const root = requireRoot();
        if (!root || !(await requireInit(root))) {return;}

        const provider = await getProvider();
        if (!provider) {
            vscode.window.showErrorMessage(
                'Saga: No AI provider available. Install GitHub Copilot or start Ollama.',
            );
            return;
        }

        let output = '';
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Saga: Testing via ${provider.displayName}…`, cancellable: false },
            async () => {
                const response = await provider.generate({
                    messages: [
                        { role: 'system', content: 'You are an expert agile coach. Reply concisely.' },
                        {
                            role: 'user',
                            content:
                                'Write one INVEST-compliant user story for a guest checkout feature. ' +
                                'Include one Gherkin acceptance scenario.',
                        },
                    ],
                    maxTokens: 400,
                });
                output = response.content;
            },
        );

        const doc = await vscode.workspace.openTextDocument({
            language: 'markdown',
            content: `# Saga — Test Generation\n\n**Provider:** ${provider.displayName}\n\n---\n\n${output}`,
        });
        await vscode.window.showTextDocument(doc);
    });

    context.subscriptions.push(
        initCmd,
        addContextFileCmd,
        generateEpicsCmd,
        generateStoriesCmd,
        validateStoriesCmd,
        openStoryCmd,
        testGenCmd,
    );
}

export function deactivate() {}
