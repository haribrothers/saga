import * as vscode from 'vscode';
import * as path from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RelevantFile {
    /** Workspace-relative path, forward slashes. */
    relativePath: string;
    /** 0–1 heuristic relevance score. */
    score: number;
}

export interface RelevantFileContent {
    relativePath: string;
    /** Up to MAX_CONTENT_LINES lines of the file's content. */
    content: string;
}

export interface StackInfo {
    /** Detected language/framework identifiers (e.g. 'typescript', 'react', 'python'). */
    languages: string[];
    /** Detected frameworks/tools (e.g. 'nextjs', 'django', 'postgres'). */
    frameworks: string[];
    /** High-level project type hint. */
    projectType: string;
    /** Top-level directories present in the workspace root. */
    topLevelDirs: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Directories that must never appear in any file listing. */
const EXCLUDED_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', 'out', '.saga',
    '.vscode', '__pycache__', '.next', '.nuxt', 'coverage',
    '.turbo', '.cache', 'vendor',
]);

const MAX_CANDIDATES = 200;
const MAX_RESULTS = 20;
const MIN_SCORE = 0.1;
const MAX_CONTENT_LINES = 150;

/** Filenames that are binary or lock files — never include their content in a prompt. */
const EXCLUDED_CONTENT_FILES = new Set([
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock',
    'cargo.lock', 'gemfile.lock', 'composer.lock', 'go.sum',
]);

// ─── Stack detection ──────────────────────────────────────────────────────────

/**
 * Scans the workspace root to detect the technology stack.
 * Reads config/manifest files only — never reads source files for this pass.
 */
export async function detectStack(workspaceRoot: vscode.Uri): Promise<StackInfo> {
    const languages: string[] = [];
    const frameworks: string[] = [];
    const topLevelDirs: string[] = [];

    let entries: [string, vscode.FileType][] = [];
    try {
        entries = await vscode.workspace.fs.readDirectory(workspaceRoot);
    } catch {
        return { languages, frameworks, projectType: 'unknown', topLevelDirs };
    }

    const files = new Set<string>();
    for (const [name, type] of entries) {
        if (type === vscode.FileType.File) {
            files.add(name.toLowerCase());
        } else if (type === vscode.FileType.Directory && !EXCLUDED_DIRS.has(name)) {
            topLevelDirs.push(name);
        }
    }

    // ── Language detection ────────────────────────────────────────────────────
    if (files.has('package.json')) {
        languages.push('javascript');
        // Check tsconfig for TypeScript
        if (files.has('tsconfig.json') || files.has('tsconfig.base.json')) {
            languages.push('typescript');
        }
        // Framework detection via package.json content
        try {
            const pkgBytes = await vscode.workspace.fs.readFile(
                vscode.Uri.joinPath(workspaceRoot, 'package.json'),
            );
            const pkg = JSON.parse(Buffer.from(pkgBytes).toString('utf-8')) as Record<string, unknown>;
            const allDeps = {
                ...((pkg.dependencies ?? {}) as Record<string, unknown>),
                ...((pkg.devDependencies ?? {}) as Record<string, unknown>),
            };
            const depKeys = Object.keys(allDeps).map((k) => k.toLowerCase());

            if (depKeys.some((d) => d === 'react' || d === 'react-dom')) { frameworks.push('react'); }
            if (depKeys.some((d) => d === 'next' || d === 'next.js')) { frameworks.push('nextjs'); }
            if (depKeys.some((d) => d === 'vue')) { frameworks.push('vue'); }
            if (depKeys.some((d) => d === 'svelte')) { frameworks.push('svelte'); }
            if (depKeys.some((d) => d === '@angular/core')) { frameworks.push('angular'); }
            if (depKeys.some((d) => d === 'express' || d === 'fastify' || d === 'koa')) { frameworks.push('nodejs-api'); }
            if (depKeys.some((d) => d === 'prisma' || d === '@prisma/client')) { frameworks.push('prisma'); }
            if (depKeys.some((d) => d === 'sequelize' || d === 'typeorm')) { frameworks.push('orm'); }
            if (depKeys.some((d) => d.includes('postgres') || d === 'pg')) { frameworks.push('postgres'); }
            if (depKeys.some((d) => d.includes('mysql') || d === 'mysql2')) { frameworks.push('mysql'); }
            if (depKeys.some((d) => d === 'mongoose' || d === 'mongodb')) { frameworks.push('mongodb'); }
        } catch { /* ignore parse errors */ }
    }

    if (files.has('requirements.txt') || files.has('pyproject.toml') || files.has('setup.py')) {
        languages.push('python');
        if (files.has('manage.py')) { frameworks.push('django'); }
        if (topLevelDirs.some((d) => d === 'app' || d === 'api')) { frameworks.push('fastapi-or-flask'); }
    }

    if (files.has('go.mod')) { languages.push('go'); }
    if (files.has('cargo.toml')) { languages.push('rust'); }
    if (files.has('pom.xml') || files.has('build.gradle') || files.has('build.gradle.kts')) { languages.push('java'); }
    if (files.has('gemfile')) { languages.push('ruby'); }

    // ── Project type ──────────────────────────────────────────────────────────
    let projectType = 'unknown';
    if (frameworks.includes('nextjs') || frameworks.includes('react')) {
        projectType = 'web-frontend';
    } else if (frameworks.includes('nodejs-api') || frameworks.includes('fastapi-or-flask') || languages.includes('go')) {
        projectType = 'api-backend';
    } else if (languages.includes('python') && !frameworks.length) {
        projectType = 'python-script';
    } else if (languages.includes('typescript') && topLevelDirs.includes('src')) {
        projectType = 'library-or-extension';
    }

    return { languages: [...new Set(languages)], frameworks: [...new Set(frameworks)], projectType, topLevelDirs };
}

// ─── File relevance scoring ───────────────────────────────────────────────────

/**
 * Scans the workspace for source files and ranks them by heuristic relevance
 * to the given story. Returns up to MAX_RESULTS files with score > MIN_SCORE,
 * sorted descending by score.
 *
 * Scoring strategy (purely string-based, no embeddings):
 *   - Token overlap between file path segments and story title/labels
 *   - Proximity bonus for files in known high-value directories (src/, lib/, app/)
 *   - Small size penalty for deeply-nested paths (reduces noise)
 */
export async function findRelevantFiles(
    workspaceRoot: vscode.Uri,
    story: { title: string; labels?: string[]; as_a?: string; i_want?: string },
): Promise<RelevantFile[]> {
    // Collect up to MAX_CANDIDATES candidate files
    const candidates: string[] = [];
    await collectFiles(workspaceRoot, workspaceRoot, candidates, 0);

    // Build a token set from the story
    const storyTokens = tokenise([
        story.title,
        ...(story.labels ?? []),
        story.as_a ?? '',
        story.i_want ?? '',
    ].join(' '));

    // Score each candidate
    const scored: RelevantFile[] = [];
    for (const rel of candidates) {
        const score = scoreFile(rel, storyTokens);
        if (score >= MIN_SCORE) {
            scored.push({ relativePath: rel, score });
        }
    }

    // Sort descending by score, cap at MAX_RESULTS
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, MAX_RESULTS);
}

/**
 * Returns the top-scored relevant files with their content (up to MAX_CONTENT_LINES
 * lines each), for inclusion in an agent prompt. Binary/lock files are excluded.
 */
export async function getRelevantFileContents(
    workspaceRoot: vscode.Uri,
    story: { title: string; labels?: string[]; as_a?: string; i_want?: string },
): Promise<RelevantFileContent[]> {
    const files = await findRelevantFiles(workspaceRoot, story);
    const results: RelevantFileContent[] = [];

    for (const file of files) {
        const basename = path.basename(file.relativePath).toLowerCase();
        if (EXCLUDED_CONTENT_FILES.has(basename)) { continue; }

        try {
            const bytes = await vscode.workspace.fs.readFile(
                vscode.Uri.joinPath(workspaceRoot, file.relativePath),
            );
            const text = Buffer.from(bytes).toString('utf-8');
            const lines = text.split('\n').slice(0, MAX_CONTENT_LINES);
            results.push({ relativePath: file.relativePath, content: lines.join('\n') });
        } catch {
            // Unreadable file (permissions, binary decode issue) — skip.
        }
    }

    return results;
}

// ─── Directory layout ─────────────────────────────────────────────────────────

export interface DirectoryLayout {
    /** Top-level entries (files + dirs, excluding hidden and excluded dirs). */
    topLevel: string[];
    /** Second-level entries per top-level directory. Key = dir name. */
    secondLevel: Record<string, string[]>;
}

/**
 * Returns the top-two-level directory structure of the workspace, filtered to
 * exclude hidden entries and known noise directories.
 */
export async function getDirectoryLayout(workspaceRoot: vscode.Uri): Promise<DirectoryLayout> {
    const topLevel: string[] = [];
    const secondLevel: Record<string, string[]> = {};

    let entries: [string, vscode.FileType][];
    try {
        entries = await vscode.workspace.fs.readDirectory(workspaceRoot);
    } catch {
        return { topLevel, secondLevel };
    }

    for (const [name, type] of entries) {
        if (name.startsWith('.')) { continue; }
        if (EXCLUDED_DIRS.has(name)) { continue; }
        topLevel.push(type === vscode.FileType.Directory ? `${name}/` : name);

        if (type === vscode.FileType.Directory) {
            try {
                const children = await vscode.workspace.fs.readDirectory(
                    vscode.Uri.joinPath(workspaceRoot, name),
                );
                secondLevel[name] = children
                    .filter(([n, t]) => !n.startsWith('.') && !(t === vscode.FileType.Directory && EXCLUDED_DIRS.has(n)))
                    .map(([n, t]) => (t === vscode.FileType.Directory ? `${n}/` : n))
                    .sort();
            } catch {
                secondLevel[name] = [];
            }
        }
    }

    topLevel.sort();
    return { topLevel, secondLevel };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function collectFiles(
    workspaceRoot: vscode.Uri,
    dir: vscode.Uri,
    results: string[],
    depth: number,
): Promise<void> {
    if (results.length >= MAX_CANDIDATES) { return; }
    if (depth > 8) { return; } // don't recurse indefinitely

    let entries: [string, vscode.FileType][];
    try {
        entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
        return;
    }

    for (const [name, type] of entries) {
        if (results.length >= MAX_CANDIDATES) { return; }
        if (name.startsWith('.')) { continue; }

        if (type === vscode.FileType.Directory) {
            if (EXCLUDED_DIRS.has(name)) { continue; }
            await collectFiles(
                workspaceRoot,
                vscode.Uri.joinPath(dir, name),
                results,
                depth + 1,
            );
        } else if (type === vscode.FileType.File && isSourceFile(name)) {
            const abs = vscode.Uri.joinPath(dir, name).fsPath;
            const rel = path.relative(workspaceRoot.fsPath, abs).replace(/\\/g, '/');
            results.push(rel);
        }
    }
}

function isSourceFile(name: string): boolean {
    const ext = path.extname(name).toLowerCase();
    const sourceExts = new Set([
        '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
        '.py', '.go', '.rs', '.java', '.kt', '.cs',
        '.rb', '.php', '.swift', '.c', '.cpp', '.h',
        '.sql', '.graphql', '.gql',
        '.vue', '.svelte',
        '.md', '.mdx',
    ]);
    return sourceExts.has(ext);
}

/**
 * Score [0–1] for a workspace-relative file path against a set of story tokens.
 *
 * Breakdown:
 *   - Up to 0.7 from token overlap (matching tokens / total story tokens)
 *   - Up to 0.2 proximity bonus for high-value directories
 *   - Up to 0.1 penalty for deeply nested paths (reduces noise)
 */
function scoreFile(relativePath: string, storyTokens: Set<string>): number {
    if (storyTokens.size === 0) { return 0; }

    const pathTokens = tokenise(relativePath);
    let matches = 0;
    for (const t of pathTokens) {
        if (storyTokens.has(t)) { matches++; }
    }
    const overlapScore = Math.min(matches / storyTokens.size, 1) * 0.7;

    // Proximity bonus: files directly under well-known source dirs score higher
    const HIGH_VALUE_DIRS = ['src', 'lib', 'app', 'core', 'api', 'server', 'client', 'pages', 'components', 'services', 'utils', 'models'];
    const parts = relativePath.split('/');
    const proximityBonus = parts.some((p) => HIGH_VALUE_DIRS.includes(p.toLowerCase())) ? 0.15 : 0;

    // Depth penalty: each level beyond 4 shaves 0.02
    const depthPenalty = Math.max(0, (parts.length - 4) * 0.02);

    return Math.max(0, Math.min(1, overlapScore + proximityBonus - depthPenalty));
}

/** Lowercased alphanumeric tokens of length ≥ 2, split on non-word chars + camelCase. */
function tokenise(text: string): Set<string> {
    // Split camelCase/PascalCase before splitting on non-word chars
    const spaced = text
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
    const tokens = spaced.toLowerCase().split(/[^a-z0-9]+/);
    return new Set(tokens.filter((t) => t.length >= 2));
}
