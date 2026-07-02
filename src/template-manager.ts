import * as vscode from 'vscode';
import { getSagaRoot } from './saga-repo';
import {
    TEMPLATE_NAMES,
    TemplateName,
    hasTemplateOverride,
    templateOverrideUri,
    templateBundledUri,
} from './generation/template-loader';

const TEMPLATE_LABELS: Record<TemplateName, string> = {
    'epic-generation': 'Epic Generation',
    'story-generation': 'Story Generation',
    'story-refine': 'Story Refine',
    'agent-prompt': 'Agent Prompt',
    'agents-md': 'AGENTS.md',
};

/**
 * QuickPick over the 5 user-overridable templates. Selecting one copies the
 * bundled default to .saga/templates/<name>.hbs (if not already overridden)
 * and opens it in the editor.
 */
export async function openTemplate(workspaceRoot: vscode.Uri, extensionUri: vscode.Uri): Promise<void> {
    const sagaRoot = getSagaRoot(workspaceRoot);

    const items = await Promise.all(TEMPLATE_NAMES.map(async (name) => {
        const overridden = await hasTemplateOverride(sagaRoot, name);
        return {
            label: TEMPLATE_LABELS[name],
            description: overridden ? 'customized' : 'default',
            name,
        };
    }));

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a template to edit',
        title: 'Saga: Open Template',
    });
    if (!picked) { return; }

    const dest = templateOverrideUri(sagaRoot, picked.name);
    const alreadyOverridden = await hasTemplateOverride(sagaRoot, picked.name);
    if (!alreadyOverridden) {
        const bundled = templateBundledUri(extensionUri, picked.name);
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(sagaRoot, 'templates'));
        const bytes = await vscode.workspace.fs.readFile(bundled);
        await vscode.workspace.fs.writeFile(dest, bytes);
    }

    const doc = await vscode.workspace.openTextDocument(dest);
    await vscode.window.showTextDocument(doc);
}

/**
 * QuickPick over templates that currently have an override, with a modal
 * confirm before deleting it (falls back to the bundled default on next use).
 */
export async function resetTemplate(workspaceRoot: vscode.Uri): Promise<void> {
    const sagaRoot = getSagaRoot(workspaceRoot);

    const overridden: Array<{ label: string; name: TemplateName }> = [];
    for (const name of TEMPLATE_NAMES) {
        if (await hasTemplateOverride(sagaRoot, name)) {
            overridden.push({ label: TEMPLATE_LABELS[name], name });
        }
    }

    if (overridden.length === 0) {
        vscode.window.showInformationMessage('Saga: No templates have been customized.');
        return;
    }

    const picked = await vscode.window.showQuickPick(overridden, {
        placeHolder: 'Select a template to reset to the default',
        title: 'Saga: Reset Template',
    });
    if (!picked) { return; }

    const confirm = await vscode.window.showWarningMessage(
        `Reset "${picked.label}" to the bundled default? This deletes your customization.`,
        { modal: true },
        'Reset',
    );
    if (confirm !== 'Reset') { return; }

    await vscode.workspace.fs.delete(templateOverrideUri(sagaRoot, picked.name), { useTrash: true });
    vscode.window.showInformationMessage(`Saga: "${picked.label}" reset to default.`);
}
