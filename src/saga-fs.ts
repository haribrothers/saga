import * as vscode from 'vscode';

const DEFAULT_CONFIG_YAML = `# Saga configuration — commit this file; never put secrets here.
# Keys / tokens live in VS Code SecretStorage (Saga: Configure Credentials).

ai:
  default_provider: vscode-lm          # vscode-lm | anthropic | gemini | openai | local
  fallback_order: [vscode-lm, local, gemini, anthropic]

  providers:
    vscode-lm:
      enabled: true                    # uses your Copilot seat; no key needed
    anthropic:
      enabled: false                   # BYOK; store key via Saga: Configure Credentials
      prompt_caching: true
    gemini:
      enabled: false
    openai:
      enabled: false
    local:
      enabled: false
      base_url: http://localhost:11434/v1   # Ollama default; LM Studio = http://localhost:1234/v1
      api_key: ""                           # usually empty for local

  routing:
    epic_generation:   { tier: quality }
    story_generation:  { tier: quality }
    invest_validation: { tier: cheap }
    story_splitting:   { tier: cheap }
    agent_prompt:      { tier: cheap }
    agents_md:         { tier: cheap }

  models:
    quality:
      anthropic: claude-sonnet-4-6
      gemini:    gemini-2.5-pro
      vscode-lm: { vendor: copilot, family: claude-sonnet }
    cheap:
      anthropic: claude-haiku-4-5
      gemini:    gemini-2.0-flash
      vscode-lm: { vendor: copilot, family: claude-haiku }
      local:     ""                    # whichever model the user has pulled

  budget:
    confirm_above_usd: 0.50
    show_token_preview: true

tracker:
  default: none                        # jira | ado | none
  jira:
    base_url: ""                       # e.g. https://your-org.atlassian.net
    project_key: ""
    email: ""                          # API token stored in SecretStorage
  ado:
    org_url: ""                        # e.g. https://dev.azure.com/your-org
    project: ""
    # PAT stored in SecretStorage
`;

const GITIGNORE_BLOCK = `
# Saga sync cache (runtime state, not source of truth)
.saga/.sync/
`;

const SAGA_SUBDIRS = ['context', 'epics', 'stories', 'prompts', 'templates', '.sync'];

/**
 * Scaffold the .saga/ folder in the given workspace root.
 * Idempotent: skips files/dirs that already exist.
 */
export async function initSagaFolder(workspaceRoot: vscode.Uri): Promise<void> {
    const sagaRoot = vscode.Uri.joinPath(workspaceRoot, '.saga');

    // Create .saga/ and all subdirectories
    for (const sub of ['', ...SAGA_SUBDIRS]) {
        const dir = sub ? vscode.Uri.joinPath(sagaRoot, sub) : sagaRoot;
        await ensureDirectory(dir);
    }

    // Write default config.yaml (skip if already exists)
    const configUri = vscode.Uri.joinPath(sagaRoot, 'config.yaml');
    await writeIfAbsent(configUri, DEFAULT_CONFIG_YAML);

    // Write a .gitkeep in each empty tracked subdir (context, epics, etc.)
    for (const sub of SAGA_SUBDIRS.filter((s) => s !== '.sync')) {
        const keepUri = vscode.Uri.joinPath(sagaRoot, sub, '.gitkeep');
        await writeIfAbsent(keepUri, '');
    }

    // Update .gitignore at workspace root
    await updateGitignore(workspaceRoot);
}

export function getSagaRoot(workspaceRoot: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(workspaceRoot, '.saga');
}

export function isSagaInitialized(workspaceRoot: vscode.Uri): Promise<boolean> {
    return fileExists(vscode.Uri.joinPath(workspaceRoot, '.saga', 'config.yaml'));
}

async function ensureDirectory(uri: vscode.Uri): Promise<void> {
    try {
        await vscode.workspace.fs.createDirectory(uri);
    } catch {
        // Directory already exists — fine.
    }
}

async function writeIfAbsent(uri: vscode.Uri, content: string): Promise<void> {
    if (await fileExists(uri)) {
        return;
    }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

async function updateGitignore(workspaceRoot: vscode.Uri): Promise<void> {
    const gitignoreUri = vscode.Uri.joinPath(workspaceRoot, '.gitignore');
    let existing = '';
    try {
        const bytes = await vscode.workspace.fs.readFile(gitignoreUri);
        existing = Buffer.from(bytes).toString('utf-8');
    } catch {
        // No .gitignore yet — we'll create one.
    }

    const marker = '.saga/.sync/';
    if (existing.includes(marker)) {
        return; // Already present.
    }

    const updated = existing.trimEnd() + '\n' + GITIGNORE_BLOCK.trimStart();
    await vscode.workspace.fs.writeFile(
        gitignoreUri,
        Buffer.from(updated, 'utf-8'),
    );
}

/** Returns the active workspace root URI, or undefined if no folder is open. */
export function getWorkspaceRoot(): vscode.Uri | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return undefined;
    }
    return folders[0].uri;
}
