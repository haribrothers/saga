# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Saga is a VS Code extension that turns product briefs and technical designs into INVEST-compliant agile stories (with Gherkin acceptance criteria), pushes them to Jira Cloud or Azure DevOps, and keeps both sides in sync — all version-controlled in a `.saga/` folder inside the workspace. It also generates agent prompts and `AGENTS.md` for coding agents. See [docs/saga-prd.md](docs/saga-prd.md) for the full PRD.

M0 and M1 are complete. Next milestone is M1.5 (Settings Webview — F23).

**M0** — `saga.init`, `saga.testGeneration`, `LLMProvider` interface, `VsCodeLmProvider`, `LocalLmProvider`, `SecretsManager`, `SagaFileSystem`.

**M1** — Full generate pipeline: `ContextManager` (add/remove/load context files), `GenerationService` (epic + story generation via Handlebars + Zod + LLM), `InvestValidator` (heuristic + LLM-assisted INVEST scoring), `SagaTreeProvider` + `ContextTreeProvider` (sidebar tree views with file watchers), `StoryPanel` (React Webview story editor with Form/YAML tabs and INVEST badges), `saga-repo.ts` (typed YAML I/O layer), Zod schemas for all domain types. Commands: `saga.addContextFile`, `saga.generateEpics`, `saga.generateStoriesForEpic`, `saga.validateStories`, `saga.openStory`.

**M1.5 (next)** — Settings Webview panel (`saga.openSettings`): GUI over `config.yaml` for provider selection + connection testing, model routing overrides, BYOK key entry (via SecretStorage — keys never travel through the Webview), budget controls. Tracker section visible but disabled until M2.

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

### Implemented modules (M0 + M1)
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
- `src/webview/story-panel.ts` — extension-host side of the Story editor Webview
- `webview-ui/` — React + Vite Webview bundle (story editor with Form/YAML tabs)

### Services (planned / in progress)
- **Settings Service** — reads/writes `config.yaml`, proxies SecretStorage key entry, tests provider connectivity (M1.5)
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
- **Cost routing**: cheap models (Haiku, Flash) for validation/splitting/prompt assembly; quality tier (Sonnet, Gemini Pro) for epic/story generation. Prompt caching on the Anthropic adapter is the single biggest cost lever.
- **Secrets**: use `context.secrets` (VS Code SecretStorage) for every credential. Zero secrets in `.saga/` or any committed file.
- **Sync safety**: sync is always explicit (user-triggered), previews changes before applying, and is idempotent. No background auto-push.
- **LLM output**: always parse with Zod; never `JSON.parse` raw. Retry on schema failure with a stricter prompt before surfacing an error.
- **Testing**: `@vscode/test-electron` for integration tests that need a real VS Code host; Vitest for pure logic units (parsers, validators, schema transforms).
