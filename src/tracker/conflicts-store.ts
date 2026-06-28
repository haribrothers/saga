import * as vscode from 'vscode';

/**
 * Transient sidecar tracking which Saga IDs are currently in conflict.
 * Written by the sync engine after buildSyncPlan(); cleared when the user
 * resolves all conflicts via the Sync Review panel. Lives in .saga/.sync/
 * so it is gitignored alongside mappings.json.
 */

function conflictsUri(sagaRoot: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(sagaRoot, '.sync', 'conflicts.json');
}

export async function readConflicts(sagaRoot: vscode.Uri): Promise<Set<string>> {
    try {
        const bytes = await vscode.workspace.fs.readFile(conflictsUri(sagaRoot));
        const ids = JSON.parse(Buffer.from(bytes).toString('utf-8')) as string[];
        return new Set(ids);
    } catch {
        return new Set();
    }
}

export async function writeConflicts(sagaRoot: vscode.Uri, ids: string[]): Promise<void> {
    const dir = vscode.Uri.joinPath(sagaRoot, '.sync');
    try { await vscode.workspace.fs.createDirectory(dir); } catch { /* exists */ }
    await vscode.workspace.fs.writeFile(
        conflictsUri(sagaRoot),
        Buffer.from(JSON.stringify(ids), 'utf-8'),
    );
}

export async function clearConflicts(sagaRoot: vscode.Uri): Promise<void> {
    await writeConflicts(sagaRoot, []);
}
