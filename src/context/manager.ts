import * as vscode from 'vscode';
import * as path from 'path';
import { ContextRole, ContextEntry } from '../schema';
import {
    readContextRegistry,
    writeContextRegistry,
    getContextDir,
} from '../saga-repo';
import { extractText } from './extractor';

const SUPPORTED_EXTENSIONS = [
    '.md', '.txt', '.pdf', '.docx',
    '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java',
    '.json', '.yaml', '.yml', '.toml',
];

const ROLE_LABELS: Array<{ label: string; description: string; role: ContextRole }> = [
    { label: 'brief', description: 'Product brief or requirements doc', role: 'brief' },
    { label: 'design', description: 'Technical design or architecture doc', role: 'design' },
    { label: 'standards', description: 'Coding standards or conventions', role: 'standards' },
    { label: 'reference', description: 'Reference material', role: 'reference' },
];

export class ContextManager {
    constructor(private readonly sagaRoot: vscode.Uri) {}

    /** Runs the Add Context File interactive flow. Returns the new entry or undefined if cancelled. */
    async addContextFile(fileUri?: vscode.Uri): Promise<ContextEntry | undefined> {
        // 1. Pick a file if not provided via right-click
        let targetUri = fileUri;
        if (!targetUri) {
            const picked = await vscode.window.showOpenDialog({
                canSelectMany: false,
                openLabel: 'Add as Context',
                filters: {
                    'Supported files': SUPPORTED_EXTENSIONS.map((e) => e.slice(1)),
                    'All files': ['*'],
                },
            });
            if (!picked || picked.length === 0) {
                return undefined;
            }
            targetUri = picked[0];
        }

        const filePath = targetUri.fsPath;
        const ext = path.extname(filePath).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.includes(ext)) {
            const proceed = await vscode.window.showWarningMessage(
                `"${path.basename(filePath)}" has an unsupported extension. Add it anyway?`,
                'Add Anyway',
                'Cancel',
            );
            if (proceed !== 'Add Anyway') {
                return undefined;
            }
        }

        // 2. Pick a role
        const picked = await vscode.window.showQuickPick(
            ROLE_LABELS.map((r) => ({ label: r.label, description: r.description, role: r.role })),
            { placeHolder: 'Select the role for this context file', title: 'Add Context File — Role' },
        );
        if (!picked) {
            return undefined;
        }

        // 3. Extract text to get char count
        let charCount = 0;
        try {
            const text = await extractText(filePath);
            charCount = text.length;

            const WARN_THRESHOLD = 100_000;
            if (charCount > WARN_THRESHOLD) {
                const confirm = await vscode.window.showWarningMessage(
                    `This file is large (~${Math.round(charCount / 1000)}K characters). ` +
                    'Large context may consume significant tokens. Continue?',
                    'Continue',
                    'Cancel',
                );
                if (confirm !== 'Continue') {
                    return undefined;
                }
            }
        } catch {
            // If extraction fails (e.g. encrypted PDF), we still register with charCount=0
        }

        // 4. Copy file into .saga/context/
        const filename = this.uniqueFilename(path.basename(filePath));
        const destUri = vscode.Uri.joinPath(getContextDir(this.sagaRoot), filename);
        await vscode.workspace.fs.copy(targetUri, destUri, { overwrite: false });

        // 5. Register in context-registry.yaml
        const registry = await readContextRegistry(this.sagaRoot);
        const entry: ContextEntry = {
            path: filePath,
            filename,
            role: picked.role,
            added_at: new Date().toISOString(),
            char_count: charCount,
        };
        registry.entries.push(entry);
        await writeContextRegistry(this.sagaRoot, registry);

        return entry;
    }

    /** Removes a context file by filename. */
    async removeContextFile(filename: string): Promise<void> {
        const registry = await readContextRegistry(this.sagaRoot);
        const before = registry.entries.length;
        registry.entries = registry.entries.filter((e) => e.filename !== filename);
        if (registry.entries.length === before) {
            return;
        }
        await writeContextRegistry(this.sagaRoot, registry);

        try {
            const destUri = vscode.Uri.joinPath(getContextDir(this.sagaRoot), filename);
            await vscode.workspace.fs.delete(destUri);
        } catch {
            // File may already be gone.
        }
    }

    /**
     * Returns all registered context entries with their extracted text content.
     * Used by the generation service to assemble prompts.
     */
    async loadContextTexts(): Promise<Array<ContextEntry & { text: string }>> {
        const registry = await readContextRegistry(this.sagaRoot);
        const results: Array<ContextEntry & { text: string }> = [];
        for (const entry of registry.entries) {
            const fileUri = vscode.Uri.joinPath(getContextDir(this.sagaRoot), entry.filename);
            try {
                const text = await extractText(fileUri.fsPath);
                results.push({ ...entry, text });
            } catch {
                // Skip files that can't be read.
            }
        }
        return results;
    }

    /** Stores free-form typed text as an inline context file (F24). */
    async addInlineContext(text: string): Promise<ContextEntry | undefined> {
        const registry = await readContextRegistry(this.sagaRoot);
        const existingInline = registry.entries.filter((e) => e.filename.startsWith('inline-'));
        const nextNum = String(existingInline.length + 1).padStart(3, '0');
        const filename = `inline-${nextNum}.md`;

        const destUri = vscode.Uri.joinPath(getContextDir(this.sagaRoot), filename);
        const firstLine = text.split('\n')[0].slice(0, 80);
        const content = `<!-- saga:inline-context -->\n${text}`;
        await vscode.workspace.fs.writeFile(destUri, Buffer.from(content, 'utf-8'));

        const entry: ContextEntry = {
            path: destUri.fsPath,
            filename,
            role: 'reference',
            added_at: new Date().toISOString(),
            char_count: text.length,
        };
        void firstLine; // used as display hint in tree (filename already descriptive)
        registry.entries.push(entry);
        await writeContextRegistry(this.sagaRoot, registry);
        return entry;
    }

    private uniqueFilename(basename: string): string {
        const ts = Date.now();
        const ext = path.extname(basename);
        const stem = path.basename(basename, ext);
        return `${stem}-${ts}${ext}`;
    }
}
