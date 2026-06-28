import * as vscode from 'vscode';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RemoteMapping {
    key: string;          // tracker-native key, e.g. "PROJ-42" or "123456"
    url: string;          // browse URL to the issue/work-item
    last_synced_hash: string;
    last_synced_at: string; // ISO timestamp
}

/** Keyed by Saga ID (e.g. "EPIC-001"), then by provider ("jira" | "ado"). */
export type MappingStore = Record<string, Partial<Record<'jira' | 'ado', RemoteMapping>>>;

// ─── Paths ────────────────────────────────────────────────────────────────────

function syncDir(sagaRoot: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(sagaRoot, '.sync');
}

function mappingsUri(sagaRoot: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(sagaRoot, '.sync', 'mappings.json');
}

// ─── Read / write ─────────────────────────────────────────────────────────────

export async function readMappings(sagaRoot: vscode.Uri): Promise<MappingStore> {
    try {
        const bytes = await vscode.workspace.fs.readFile(mappingsUri(sagaRoot));
        return JSON.parse(Buffer.from(bytes).toString('utf-8')) as MappingStore;
    } catch {
        return {};
    }
}

export async function writeMappings(sagaRoot: vscode.Uri, store: MappingStore): Promise<void> {
    const dir = syncDir(sagaRoot);
    try {
        await vscode.workspace.fs.createDirectory(dir);
    } catch { /* already exists */ }
    const text = JSON.stringify(store, null, 2);
    await vscode.workspace.fs.writeFile(mappingsUri(sagaRoot), Buffer.from(text, 'utf-8'));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export async function setMapping(
    sagaRoot: vscode.Uri,
    sagaId: string,
    provider: 'jira' | 'ado',
    mapping: RemoteMapping,
): Promise<void> {
    const store = await readMappings(sagaRoot);
    store[sagaId] = { ...(store[sagaId] ?? {}), [provider]: mapping };
    await writeMappings(sagaRoot, store);
}

export async function getMapping(
    sagaRoot: vscode.Uri,
    sagaId: string,
    provider: 'jira' | 'ado',
): Promise<RemoteMapping | undefined> {
    const store = await readMappings(sagaRoot);
    return store[sagaId]?.[provider];
}
