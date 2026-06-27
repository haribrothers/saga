# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Saga is a VS Code extension that turns product briefs and technical designs into INVEST-compliant agile stories (with Gherkin acceptance criteria), pushes them to Jira Cloud or Azure DevOps, and keeps both sides in sync — all version-controlled in a `.saga/` folder inside the workspace. It also generates agent prompts and `AGENTS.md` for coding agents. See [docs/saga-prd.md](docs/saga-prd.md) for the full PRD.

M0, M1, and M1.5 are complete. **M1.6 is next** — Generation UX overhaul.

**M1.6 scope (next milestone):**
1. **Generation Review Webview** — interactive panel for epics and stories: inline editing, INVEST badge row, per-story Refine button, Refine All, Validate All, Regenerate, Save/Discard.
2. **Pre-generation instructions input** — VS Code Input Box before each LLM call for free-text additional instructions.
3. **Model routing wired to config.yaml** — `getProvider()` currently ignores the routing config; replace with `resolveProviderFromConfig(task, sagaRoot)` that reads `ai.routing.<task>` from `config.yaml`, maps it to a provider + model, and shows `<model-id> (<provider>)` in progress notifications and panel headers.
4. **Inline text context (F24)** — `saga.addInlineContext` command; stored as `.saga/context/inline-NNN.md`, shown in Context Files tree with ✏ icon.
5. **Delete & cleanup (F25)** — `saga.deleteEpic`, `saga.deleteStory` (tree right-click with confirmation), `saga.cleanUp` command.

**Known bug fixed in M1.6:** `getProvider()` in `extension.ts` always resolves `[vscodeLm, localLm]` regardless of `config.yaml`. The routing config written by the Settings Webview was never read during generation. Fix: read `ai.default_provider` and `ai.routing.<task>` from config and resolve the correct provider+model.

**M0** — `saga.init`, `saga.testGeneration`, `LLMProvider` interface, `VsCodeLmProvider`, `LocalLmProvider`, `SecretsManager`, `SagaFileSystem`.

**M1** — Full generate pipeline: `ContextManager`, `GenerationService`, `InvestValidator`, `SagaTreeProvider` + `ContextTreeProvider`, `StoryPanel` Webview, `saga-repo.ts`, Zod schemas. Commands: `saga.addContextFile`, `saga.generateEpics`, `saga.generateStoriesForEpic`, `saga.validateStories`, `saga.openStory`.

**M1.5** — Settings Webview (`saga.openSettings`): provider selection + connection testing, per-task model picker (live `listModels()` per enabled provider, `"auto"` fallback), BYOK key entry via SecretStorage, budget controls. Routing schema in `config.yaml` changed from `{ tier: quality|cheap }` to a plain model ID string or `"auto"`.

## Commands

```bash
# Type-check only
npm run check-types

# Lint only
npm run lint

# Build (type-check + lint + esbuild)
npm run compile

# Build for production (minified, no sourcemap)
npm run package

# Watch mode (esbuild + tsc in parallel)
npm run watch

# Run tests (compiles first)
npm test

# Compile tests only
npm run compile-tests
```

To launch the extension in a VS Code Extension Development Host: press **F5** in VS Code (uses `.vscode/launch.json`).

## Architecture

### Entry point
`src/extension.ts` exports `activate(context)` and `deactivate()`. All commands, tree views, and webview panels are registered here via `context.subscriptions`.

### Module structure

The extension is organized around two core interfaces:

- **`LLMProvider`** — provider-agnostic AI access with three adapter implementations:
  - VS Code LM API (default — uses the user's Copilot seat)
  - Direct API key / BYOK (Anthropic, Gemini, OpenAI)
  - Local OpenAI-compatible (Ollama at `localhost:11434/v1`, LM Studio at `localhost:1234/v1`)
  - **Never** reuse consumer OAuth tokens (Claude Pro/Gemini AI Pro) — this is prohibited by vendor terms.

- **`TrackerAdapter`** — provider-agnostic tracker sync with adapters for Jira Cloud REST v3 and Azure DevOps REST.

### Implemented modules (M0 + M1 + M1.5)
- `src/schema/index.ts` — Zod schemas: `Epic`, `Story`, `ContextEntry`, `InvestResult`, `Config`
- `src/saga-repo.ts` — typed YAML I/O for epics, stories, config, context registry
- `src/llm/` — `LLMProvider` interface + `VsCodeLmProvider` + `LocalLmProvider`
- `src/secrets.ts` — `SecretsManager` wrapping VS Code SecretStorage
- `src/saga-fs.ts` — workspace init helpers (scaffold `.saga/`, update `.gitignore`)
- `src/context/extractor.ts` — text extraction (.md, .txt, .pdf, .docx, code)
- `src/context/manager.ts` — `ContextManager` (add/remove/load context files)
- `src/generation/prompts.ts` — Handlebars prompt templates for epic + story generation
- `src/generation/service.ts` — `GenerationService` (LLM call → Zod parse → retry)
- `src/invest/validator.ts` — `InvestValidator` (heuristic + LLM-assisted INVEST scoring)
- `src/tree/saga-tree.ts` — `SagaTreeProvider` + `ContextTreeProvider` with file watchers
- `src/webview/html.ts` — shared `getWebviewHtml()` that reads Vite's generated `index.html` at runtime and rewrites hashed asset URLs to `webview.asWebviewUri` — both panels use this
- `src/webview/story-panel.ts` — extension-host side of the Story editor Webview
- `src/webview/settings-panel.ts` — extension-host side of the Settings Webview; reads/writes `config.yaml`, proxies SecretStorage key entry, calls `listModels()` on enabled providers to populate the routing picker
- `webview-ui/src/vscode-api.ts` — single `acquireVsCodeApi()` call shared by the whole bundle (calling it twice causes a VS Code runtime error)
- `webview-ui/src/vscode.ts` — typed postMessage bridge for the Story panel (wraps `vscode-api.ts`)
- `webview-ui/src/vscode-settings.ts` — typed postMessage bridge for the Settings panel (wraps `vscode-api.ts`)
- `webview-ui/src/StoryEditor.tsx` — story editor (Form/YAML tabs, INVEST badges)
- `webview-ui/src/SettingsEditor.tsx` — settings form (AI Provider, Model Routing with live model picker, Tracker placeholder, Budget)

### Services (planned)
- **Sync Engine** — 3-way diff between `.saga/`, last-synced snapshot, and live tracker state (M3)
- **Prompt / AGENTS.md Service** — assembles context-aware agent prompts from stories + workspace files (M4)

### `.saga/` folder (the source of truth)
```
.saga/
├── config.yaml          # non-secret: provider routing, model tiers, tracker defaults
├── context/             # registered input files (briefs, designs, standards)
├── epics/               # EPIC-NNN.yaml
├── stories/             # STORY-NNN.yaml (schema defined in PRD §5.2)
├── prompts/             # generated agent prompts
├── templates/           # user-overridable Handlebars templates
└── .sync/               # gitignored: remote-ID mappings and last-synced snapshots
```

### Build pipeline
Two separate build targets:
- **Extension**: `esbuild.js` bundles `src/extension.ts` → `dist/extension.js` (CJS, `vscode` externalized). `npm run compile` runs type-check + lint + esbuild.
- **Webview**: `vite build` bundles `webview-ui/` → `dist/webview/` (ESM, React). `npm run compile:webview`. The extension host serves assets from `dist/webview/` via `webview.asWebviewUri`.

```bash
npm run compile          # extension only (check-types + lint + esbuild)
npm run compile:webview  # webview only (vite build)
npm run package          # both, production — run before F5 to get a fresh webview bundle
```

### UI layers

Every command is reachable from **both** the Command Palette and the Saga sidebar UI.

- **Activity Bar icon** → Saga sidebar (`ViewContainer` with two stacked `TreeDataProvider` views)
  - **Epics & Stories tree** — epics as parent nodes, stories as children with status badges
  - **Context Files tree** — registered context files with role tags (brief / design / standards)
- **Empty/uninitialized state** — `welcomeView` contribution shows an "Initialize Saga" button when no `.saga/` folder exists; triggers `saga.init` (same as Command Palette)
- **Getting Started Webview** — 3-step onboarding panel (provider selection → add context file → first generation); opened after init and via `Saga: Getting Started`; wraps the same commands available from the palette/toolbar
- **Story editor Webview** — opens on story click; form view (friendly fields + INVEST badges + Gherkin editor) and YAML tab for power users
- **Settings Webview** — `saga.openSettings` / `⚙` button; GUI over `config.yaml` + SecretStorage key entry; provider connection tester (M1.5)
- **Lightweight interactions**: QuickPick / Input boxes for role tagging, confirmations
- **Rich panels**: Webview + React + Vite (story editor, settings, 3-way diff UI, sync review)

### Key dependencies
**Installed (M0 + M1):**
- `zod` — schema validation and LLM output parsing
- `yaml` — read/write `.saga/` YAML files
- `handlebars` — story and prompt templates
- `@cucumber/gherkin` — validate generated acceptance criteria
- `pdf-parse`, `mammoth` — extract text from brief/design documents
- `react`, `react-dom`, `vite`, `@vitejs/plugin-react` — Webview UI

**To add (future milestones):**
- `@anthropic-ai/sdk`, `@google/generative-ai` — BYOK provider adapters (M4)
- VS Code SecretStorage API — all credentials go here, never in `.saga/` (already used via `SecretsManager`)

## Key constraints

- **AI provider**: Default to VS Code LM API (`vscode.lm.selectChatModels`). BYOK and local adapters are fallbacks. Class D (consumer OAuth token reuse) is permanently off the table — Anthropic blocked it January 2026, Google followed February 2026.
- **Model routing**: `config.yaml` routing entries are either a specific model ID string (e.g. `claude-sonnet-4-6`) or `"auto"`. `"auto"` delegates to tier-based selection (quality/cheap). The Settings Webview populates the picker from live `listModels()` calls. Never hardcode model IDs in non-config code. **Generation must read routing config** — use `resolveProviderFromConfig(task, sagaRoot)` not the bare `getProvider()` helper.
- **Model label in UI**: every generation run must surface `<model-id> (<provider>)` in both the VS Code progress notification and the Generation Review panel header so the user always knows what ran.
- **Cost routing**: cheap models (Haiku, Flash) for validation/splitting/prompt assembly; quality tier (Sonnet, Gemini Pro) for epic/story generation. Prompt caching on the Anthropic adapter is the single biggest cost lever.
- **Secrets**: use `context.secrets` (VS Code SecretStorage) for every credential. Zero secrets in `.saga/` or any committed file.
- **Sync safety**: sync is always explicit (user-triggered), previews changes before applying, and is idempotent. No background auto-push.
- **LLM output**: always parse with Zod; never `JSON.parse` raw. Retry on schema failure with a stricter prompt before surfacing an error.
- **Testing**: `@vscode/test-electron` for integration tests that need a real VS Code host; Vitest for pure logic units (parsers, validators, schema transforms).
