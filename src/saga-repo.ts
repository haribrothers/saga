import * as vscode from 'vscode';
import * as yaml from 'yaml';
import {
    Epic,
    EpicSchema,
    Story,
    StorySchema,
    Config,
    ConfigSchema,
    ContextRegistry,
    ContextRegistrySchema,
} from './schema';

// ─── Paths ────────────────────────────────────────────────────────────────────

export function getSagaRoot(workspaceRoot: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(workspaceRoot, '.saga');
}

function epicsDir(sagaRoot: vscode.Uri) {
    return vscode.Uri.joinPath(sagaRoot, 'epics');
}

function storiesDir(sagaRoot: vscode.Uri) {
    return vscode.Uri.joinPath(sagaRoot, 'stories');
}

function contextDir(sagaRoot: vscode.Uri) {
    return vscode.Uri.joinPath(sagaRoot, 'context');
}

function contextRegistryUri(sagaRoot: vscode.Uri) {
    return vscode.Uri.joinPath(sagaRoot, 'context', 'context-registry.yaml');
}

function configUri(sagaRoot: vscode.Uri) {
    return vscode.Uri.joinPath(sagaRoot, 'config.yaml');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readYaml(uri: vscode.Uri): Promise<unknown> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return yaml.parse(Buffer.from(bytes).toString('utf-8'));
}

async function writeYaml(uri: vscode.Uri, value: unknown): Promise<void> {
    const text = yaml.stringify(value, { lineWidth: 120 });
    await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf-8'));
}

async function listYamlFiles(dir: vscode.Uri): Promise<string[]> {
    try {
        const entries = await vscode.workspace.fs.readDirectory(dir);
        return entries
            .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.yaml') && !name.startsWith('.'))
            .map(([name]) => name)
            .sort();
    } catch {
        return [];
    }
}

// ─── Config ───────────────────────────────────────────────────────────────────

export async function readConfig(sagaRoot: vscode.Uri): Promise<Config> {
    const raw = await readYaml(configUri(sagaRoot));
    return ConfigSchema.parse(raw);
}

// ─── Epics ────────────────────────────────────────────────────────────────────

export async function listEpics(sagaRoot: vscode.Uri): Promise<Epic[]> {
    const dir = epicsDir(sagaRoot);
    const files = await listYamlFiles(dir);
    const epics: Epic[] = [];
    for (const file of files) {
        try {
            const raw = await readYaml(vscode.Uri.joinPath(dir, file));
            epics.push(EpicSchema.parse(raw));
        } catch {
            // Skip malformed files; surface errors elsewhere.
        }
    }
    return epics;
}

export async function readEpic(sagaRoot: vscode.Uri, id: string): Promise<Epic> {
    const uri = vscode.Uri.joinPath(epicsDir(sagaRoot), `${id}.yaml`);
    const raw = await readYaml(uri);
    return EpicSchema.parse(raw);
}

export async function writeEpic(sagaRoot: vscode.Uri, epic: Epic): Promise<void> {
    const uri = vscode.Uri.joinPath(epicsDir(sagaRoot), `${epic.id}.yaml`);
    await writeYaml(uri, EpicSchema.parse(epic));
}

export async function nextEpicId(sagaRoot: vscode.Uri): Promise<string> {
    const files = await listYamlFiles(epicsDir(sagaRoot));
    const nums = files
        .map((f) => parseInt(f.replace(/^EPIC-(\d+)\.yaml$/, '$1'), 10))
        .filter((n) => !isNaN(n));
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    return `EPIC-${String(next).padStart(3, '0')}`;
}

// ─── Stories ──────────────────────────────────────────────────────────────────

export async function listStories(
    sagaRoot: vscode.Uri,
    epicId?: string,
): Promise<Story[]> {
    const dir = storiesDir(sagaRoot);
    const files = await listYamlFiles(dir);
    const stories: Story[] = [];
    for (const file of files) {
        try {
            const raw = await readYaml(vscode.Uri.joinPath(dir, file));
            const story = StorySchema.parse(raw);
            if (!epicId || story.epic === epicId) {
                stories.push(story);
            }
        } catch {
            // Skip malformed files.
        }
    }
    return stories;
}

export async function readStory(sagaRoot: vscode.Uri, id: string): Promise<Story> {
    const uri = vscode.Uri.joinPath(storiesDir(sagaRoot), `${id}.yaml`);
    const raw = await readYaml(uri);
    return StorySchema.parse(raw);
}

export async function writeStory(sagaRoot: vscode.Uri, story: Story): Promise<void> {
    const uri = vscode.Uri.joinPath(storiesDir(sagaRoot), `${story.id}.yaml`);
    await writeYaml(uri, StorySchema.parse(story));
}

export async function nextStoryId(sagaRoot: vscode.Uri): Promise<string> {
    const files = await listYamlFiles(storiesDir(sagaRoot));
    const nums = files
        .map((f) => parseInt(f.replace(/^STORY-(\d+)\.yaml$/, '$1'), 10))
        .filter((n) => !isNaN(n));
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    return `STORY-${String(next).padStart(3, '0')}`;
}

// ─── Context registry ─────────────────────────────────────────────────────────

export async function readContextRegistry(sagaRoot: vscode.Uri): Promise<ContextRegistry> {
    try {
        const raw = await readYaml(contextRegistryUri(sagaRoot));
        return ContextRegistrySchema.parse(raw);
    } catch {
        return { entries: [] };
    }
}

export async function writeContextRegistry(
    sagaRoot: vscode.Uri,
    registry: ContextRegistry,
): Promise<void> {
    await writeYaml(contextRegistryUri(sagaRoot), registry);
}

export function getContextDir(sagaRoot: vscode.Uri): vscode.Uri {
    return contextDir(sagaRoot);
}
