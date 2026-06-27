import * as vscode from 'vscode';
import { SecretsManager } from './secrets';
import { initSagaFolder, getWorkspaceRoot, isSagaInitialized } from './saga-fs';
import { VsCodeLmProvider } from './llm/vscode-lm';
import { LocalLmProvider } from './llm/local';
import { resolveProvider } from './llm/provider';

export function activate(context: vscode.ExtensionContext) {
    const secrets = new SecretsManager(context.secrets);

    // ── saga.init ──────────────────────────────────────────────────────────────
    const initCmd = vscode.commands.registerCommand('saga.init', async () => {
        const root = getWorkspaceRoot();
        if (!root) {
            vscode.window.showErrorMessage(
                'Saga: Open a workspace folder first before initializing.',
            );
            return;
        }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Saga: Initializing .saga/ folder…',
                cancellable: false,
            },
            async () => {
                await initSagaFolder(root);
            },
        );

        const open = 'Open config.yaml';
        const choice = await vscode.window.showInformationMessage(
            'Saga initialized! .saga/ is ready. Configure your AI provider in .saga/config.yaml.',
            open,
        );
        if (choice === open) {
            const configUri = vscode.Uri.joinPath(root, '.saga', 'config.yaml');
            await vscode.window.showTextDocument(configUri);
        }
    });

    // ── saga.testGeneration ────────────────────────────────────────────────────
    const testGenCmd = vscode.commands.registerCommand(
        'saga.testGeneration',
        async () => {
            const root = getWorkspaceRoot();
            if (!root) {
                vscode.window.showErrorMessage('Saga: Open a workspace folder first.');
                return;
            }

            if (!(await isSagaInitialized(root))) {
                const init = 'Run Saga: Init';
                const choice = await vscode.window.showWarningMessage(
                    'Saga is not initialized in this workspace. Run Saga: Init first.',
                    init,
                );
                if (choice === init) {
                    await vscode.commands.executeCommand('saga.init');
                }
                return;
            }

            // Build provider chain: VS Code LM → local Ollama
            const vscodeLm = new VsCodeLmProvider();
            const localLm = new LocalLmProvider();
            const provider = await resolveProvider([vscodeLm, localLm]);

            if (!provider) {
                vscode.window.showErrorMessage(
                    'Saga: No AI provider available. ' +
                        'Install GitHub Copilot, or start Ollama locally, then try again.',
                );
                return;
            }

            let output = '';
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Saga: Testing generation via ${provider.displayName}…`,
                    cancellable: false,
                },
                async () => {
                    const response = await provider.generate({
                        messages: [
                            {
                                role: 'system',
                                content:
                                    'You are an expert agile coach. Reply concisely.',
                            },
                            {
                                role: 'user',
                                content:
                                    'Write one INVEST-compliant user story for a guest checkout feature. ' +
                                    'Include one Gherkin acceptance scenario. ' +
                                    'Format: User Story: <story>\n\nAcceptance Criteria:\n<gherkin>',
                            },
                        ],
                        maxTokens: 400,
                    });
                    output = response.content;
                },
            );

            // Show result in a new untitled document
            const doc = await vscode.workspace.openTextDocument({
                language: 'markdown',
                content: `# Saga — Test Generation\n\n**Provider:** ${provider.displayName}\n\n---\n\n${output}`,
            });
            await vscode.window.showTextDocument(doc);
        },
    );

    context.subscriptions.push(initCmd, testGenCmd);
}

export function deactivate() {}
