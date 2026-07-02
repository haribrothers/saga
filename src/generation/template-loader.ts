import * as vscode from 'vscode';

/**
 * Names of the user-overridable generation/prompt templates. Must match the
 * `.hbs` filenames bundled under src/generation/templates/ (copied to
 * dist/generation/templates/ at build time) and any override placed at
 * .saga/templates/<name>.hbs.
 */
export const TEMPLATE_NAMES = [
    'epic-generation',
    'story-generation',
    'story-refine',
    'agent-prompt',
    'agents-md',
] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];

function overrideUri(sagaRoot: vscode.Uri, name: TemplateName): vscode.Uri {
    return vscode.Uri.joinPath(sagaRoot, 'templates', `${name}.hbs`);
}

function bundledUri(extensionUri: vscode.Uri, name: TemplateName): vscode.Uri {
    return vscode.Uri.joinPath(extensionUri, 'dist', 'generation', 'templates', `${name}.hbs`);
}

/**
 * Loads the raw Handlebars source for a template, checking the workspace
 * override at .saga/templates/<name>.hbs first, then falling back to the
 * bundled default shipped with the extension.
 *
 * If sagaRoot is undefined (no workspace open), always uses the bundled default.
 */
export async function loadTemplateSource(
    name: TemplateName,
    extensionUri: vscode.Uri,
    sagaRoot?: vscode.Uri,
): Promise<string> {
    if (sagaRoot) {
        try {
            const bytes = await vscode.workspace.fs.readFile(overrideUri(sagaRoot, name));
            return Buffer.from(bytes).toString('utf-8');
        } catch {
            // No override — fall through to bundled default.
        }
    }
    const bytes = await vscode.workspace.fs.readFile(bundledUri(extensionUri, name));
    return Buffer.from(bytes).toString('utf-8');
}

/** True if the given template has a workspace override at .saga/templates/<name>.hbs. */
export async function hasTemplateOverride(sagaRoot: vscode.Uri, name: TemplateName): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(overrideUri(sagaRoot, name));
        return true;
    } catch {
        return false;
    }
}

export { overrideUri as templateOverrideUri, bundledUri as templateBundledUri };
