# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Saga is a VS Code extension that turns product briefs and technical designs into INVEST-compliant agile stories (with Gherkin acceptance criteria), pushes them to Jira Cloud or Azure DevOps, and keeps both sides in sync — all version-controlled in a `.saga/` folder inside the workspace. It also generates agent prompts and `AGENTS.md` for coding agents. See [docs/saga-prd.md](docs/saga-prd.md) for the full PRD.

M0 is complete. The extension registers `saga.init` (scaffolds `.saga/`) and `saga.testGeneration` (proves the LLM provider chain). The `LLMProvider` interface, `VsCodeLmProvider`, `LocalLmProvider`, `SecretsManager`, and `SagaFileSystem` helpers are all implemented. Next milestone is M1 (context registration, generation, INVEST validator, sidebar tree view).

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

### Planned module structure (from PRD)
The extension will be organized around two core interfaces:

- **`LLMProvider`** — provider-agnostic AI access with three adapter implementations:
  - VS Code LM API (default — uses the user's Copilot seat)
  - Direct API key / BYOK (Anthropic, Gemini, OpenAI)
  - Local OpenAI-compatible (Ollama at `localhost:11434/v1`, LM Studio at `localhost:1234/v1`)
  - **Never** reuse consumer OAuth tokens (Claude Pro/Gemini AI Pro) — this is prohibited by vendor terms.

- **`TrackerAdapter`** — provider-agnostic tracker sync with adapters for Jira Cloud REST v3 and Azure DevOps REST.

### Services
- **Generation Service** — calls `LLMProvider` to produce epics/stories (strict YAML schema output, parsed with Zod, auto-retried on parse failure)
- **Sync Engine** — 3-way diff between `.saga/` (source of truth), last-synced snapshot (`.saga/.sync/mappings.json`), and live remote tracker state
- **Prompt / AGENTS.md Service** — assembles context-aware agent prompts from stories + workspace files

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
`esbuild.js` bundles `src/extension.ts` to `dist/extension.js` (CJS, `vscode` externalized). Source maps are included in dev builds and stripped in production (`--production` flag).

### UI layers

Every command is reachable from **both** the Command Palette and the Saga sidebar UI.

- **Activity Bar icon** → Saga sidebar (`ViewContainer` with two stacked `TreeDataProvider` views)
  - **Epics & Stories tree** — epics as parent nodes, stories as children with status badges
  - **Context Files tree** — registered context files with role tags (brief / design / standards)
- **Empty/uninitialized state** — `welcomeView` contribution shows an "Initialize Saga" button when no `.saga/` folder exists; triggers `saga.init` (same as Command Palette)
- **Getting Started Webview** — 3-step onboarding panel (provider selection → add context file → first generation); opened after init and via `Saga: Getting Started`; wraps the same commands available from the palette/toolbar
- **Story editor Webview** — opens on story click; form view (friendly fields + INVEST badges + Gherkin editor) and YAML tab for power users
- **Lightweight interactions**: QuickPick / Input boxes for provider selection, role tagging, confirmations
- **Rich panels**: Webview + React + Vite (story form editor, 3-way diff UI, sync review)

### Key dependencies (to add as implementation proceeds)
- `zod` — schema validation and LLM output parsing
- `yaml` — read/write `.saga/` YAML files
- `handlebars` — story and prompt templates
- `@anthropic-ai/sdk`, `@google/generative-ai` — BYOK provider adapters
- `@cucumber/gherkin` — validate generated acceptance criteria
- `pdf-parse`, `mammoth` — extract text from brief/design documents
- VS Code SecretStorage API — all credentials (API keys, OAuth tokens, tracker PATs) go here, never in `.saga/`

## Key constraints

- **AI provider**: Default to VS Code LM API (`vscode.lm.selectChatModels`). BYOK and local adapters are fallbacks. Class D (consumer OAuth token reuse) is permanently off the table — Anthropic blocked it January 2026, Google followed February 2026.
- **Cost routing**: cheap models (Haiku, Flash) for validation/splitting/prompt assembly; quality tier (Sonnet, Gemini Pro) for epic/story generation. Prompt caching on the Anthropic adapter is the single biggest cost lever.
- **Secrets**: use `context.secrets` (VS Code SecretStorage) for every credential. Zero secrets in `.saga/` or any committed file.
- **Sync safety**: sync is always explicit (user-triggered), previews changes before applying, and is idempotent. No background auto-push.
- **LLM output**: always parse with Zod; never `JSON.parse` raw. Retry on schema failure with a stricter prompt before surfacing an error.
- **Testing**: `@vscode/test-electron` for integration tests that need a real VS Code host; Vitest for pure logic units (parsers, validators, schema transforms).
