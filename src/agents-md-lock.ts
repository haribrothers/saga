import * as vscode from 'vscode';
import * as crypto from 'crypto';

/**
 * Lock file path: .saga/AGENTS.md.lock
 * Stores the SHA-256 of the last content written to AGENTS.md by Saga.
 * If AGENTS.md's current hash differs from the stored one, the user has
 * hand-edited it since the last generation — Saga must warn before overwriting.
 */

function lockUri(sagaRoot: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(sagaRoot, 'AGENTS.md.lock');
}

export async function readLock(sagaRoot: vscode.Uri): Promise<string | undefined> {
    try {
        const bytes = await vscode.workspace.fs.readFile(lockUri(sagaRoot));
        return Buffer.from(bytes).toString('utf-8').trim();
    } catch {
        return undefined;
    }
}

export async function writeLock(sagaRoot: vscode.Uri, content: string): Promise<void> {
    const hash = sha256(content);
    await vscode.workspace.fs.writeFile(lockUri(sagaRoot), Buffer.from(hash, 'utf-8'));
}

/** SHA-256 of the exact string as written to AGENTS.md. */
export function sha256(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}
