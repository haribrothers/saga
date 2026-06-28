# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Saga is a VS Code extension that turns product briefs and technical designs into INVEST-compliant agile stories (with Gherkin acceptance criteria), pushes them to Jira Cloud or Azure DevOps, and keeps both sides in sync — all version-controlled in a `.saga/` folder inside the workspace. It also generates agent prompts and `AGENTS.md` for coding agents. See [docs/saga-prd.md](docs/saga-prd.md) for the full PRD.

## Milestone status

**M0 ✓ Complete** — `saga.init`, `saga.testGeneration`, `LLMProvider` interface, `VsCodeLmProvider`, `LocalLmProvider`, `SecretsManager`, `SagaFileSystem`.

**M1 ✓ Complete** — Full generate pipeline: `ContextManager`, `GenerationService`, `InvestValidator`, `SagaTreeProvider` + `ContextTreeProvider`, `StoryPanel` Webview, `saga-repo.ts`, Zod schemas for all domain types. Commands: `saga.addContextFile`, `saga.generateEpics`, `saga.generateStoriesForEpic`, `saga.validateStories`, `saga.openStory`.

**M1.5 ✓ Complete** — Settings Webview (`saga.openSettings`): provider selection + live connection testing, per-task model picker populated from `listModels()` per enabled provider (`"auto"` fallback), BYOK key entry via SecretStorage (key never travels through the Webview), budget controls. Routing schema in `config.yaml` is a plain model ID string or `"auto"` (legacy `{ tier }` form coerced).

**M1.6 ✓ Complete** — Generation UX overhaul:
- `GenerationReviewPanel` — interactive review panel for epics and stories: inline edit all fields, INVEST badges per story, per-story and bulk Refine (LLM follow-up), Validate All, Regenerate, Save/Discard
- Pre-generation Additional Instructions Input Box (optional free text appended to LLM prompt)
- `resolveProviderFromConfig(task, workspaceRoot)` reads `config.yaml` routing — model routing now actually used during generation
- `saga.addInlineContext` (F24) — stores free-form text as `.saga/context/inline-NNN.md`
- `saga.deleteEpic`, `saga.deleteStory` — individual delete with modal confirm
- `saga.clearStoriesForEpic` — clears all stories under a selected epic
- `saga.clearEpics` — clears all epics + all stories
- `saga.cleanUp` — full workspace cleanup (double confirmation)
- Sibling epics passed to story generation prompt to prevent scope bleed across epics

**M1.7 ✓ Complete** — Token visibility + cancellation:
- **F26 (token usage):** `TokenUsage { inputTokens, outputTokens, estimated? }` in `LLMResponse`. VS Code LM uses `model.countTokens()` for input estimate, `content.length / 4` for output, labelled `(est.)`. Local provider returns exact API counts. `GenerationService` returns `GenerationResult<T> { items, usage? }`. Usage logged to Saga Output Channel per call and shown in Generation Review panel header.
- **F27 (cancellation):** `withProgress cancellable: true` on both generation commands. `CancellationToken` → `AbortController` → `AbortSignal` threaded through `GenerationService.callWithRetry` into `provider.generate({ signal })`. `onRegenerate` callback also receives and honours `AbortSignal`. Abort caught cleanly — info notification shown, no error dialog, review panel not opened.

**M2 ✓ Complete** — One-way push to Jira Cloud and Azure DevOps:
- `TrackerAdapter` interface: `pushEpic`, `pushStory`, `deleteEpic`, `deleteStory`, `testConnection` + `PushResult` / `ConnectionTestResult` / `TrackerError` (`src/tracker/adapter.ts`)
- `JiraAdapter` (`src/tracker/jira.ts`): Jira Cloud REST v3, Basic auth (email:token base64), create/update/delete issues, ADF descriptions (never empty), labels only when non-empty, story points via optional `storyPointsFieldId` (omitted by default — avoids 400 on restricted screens), Next-Gen `parent` link or Classic `customfield_10014` Epic Link
- `AdoAdapter` (`src/tracker/ado.ts`): ADO REST, PAT auth (`Basic base64(:pat)`), JSON Patch work-item create/update/delete (sends to recycle bin), epic hierarchy via `System.LinkTypes.Hierarchy-Reverse`
- `field-mapping.ts`: `toJiraEpicFields`, `toJiraStoryFields` (accepts optional `storyPointsFieldId`), `toAdoEpicPatch`, `toAdoStoryPatch`
- `hash.ts`: `hashEpic` / `hashStory` — SHA-256 over canonical fields (title, description, user-story form, AC, estimate, labels sorted)
- `sync-store.ts`: `readMappings` / `writeMappings` / `setMapping` / `getMapping` — `.saga/.sync/mappings.json`
- `factory.ts`: `buildTrackerAdapter(root, secrets)` — reads config + SecretStorage, returns `JiraAdapter` or `AdoAdapter` or `undefined`
- **Settings Webview tracker section** fully functional: Jira Cloud + ADO config forms with all fields, Test Connection per tracker, Add/Update Token/PAT via SecretStorage Input Box, advanced collapse with issue types / AC field / story points field ID / epic link style; new messages `saveTrackerSecret` / `testTrackerConnection` / `trackerConnectionResult`
- `saga.pushEpic` / `saga.pushStory`: create or update; write `remote:` block + `local_hash` back to YAML; persist to sync store; "Open in Browser" on success
- Tree decorations: epics show `[PROJ-10 ✓]` / `[drifted ●]`; stories show `[synced ✓]` / `[drifted ●]`; icons green/yellow via `ThemeColor`
- Schema: `jira.{ epic_issue_type, story_issue_type, ac_field_id, epic_link_style, story_points_field_id? }`; `ado.{ area_path?, epic_work_item_type, story_work_item_type }`

**M2.1 ✓ Complete** — Push UX improvements:
- **F15b — Epic-first enforcement** (`saga.pushStory`): blocks if parent epic not yet pushed to the active provider; modal with "Push Epic" shortcut action. Prevents orphaned stories in the tracker.
- **F15c — Post-epic push offer** (`saga.pushEpic`): success notification shows "Push N Stories" when there are unpushed stories under the epic; pushes them in sequence with the parent key already set.
- **F15d — Tracker-aware delete** (`saga.deleteEpic` / `saga.deleteStory`): 3-option modal when item has a remote key: "Delete from [tracker] & locally" / "Delete locally only" / Cancel. Remote delete failure shows error + "Delete locally anyway?" — never hard-blocks. Sync store entry removed on successful remote delete. Shared `trackerAwareDelete()` helper in `extension.ts`.
- **F15 — Bulk push** (`saga.pushAll`): pushes all unpushed/drifted epics first (EPIC-NNN order), then all stories resolving parent keys from freshly-pushed epics; failures log to Output Channel and don't abort the batch; progress notification with running counter; "↑ Push All" button in Epics & Stories sidebar toolbar.

**Next: M3 — Sync** — Pull from tracker + two-way sync + 3-way conflict resolution (F11), status decorations (F14).

## Commands

```bash
# Type-check only
npm run check-types

# Lint only
npm run lint

# Build extension (type-check + lint + esbuild)
npm run compile

# Build webview (Vite + React)
npm run compile:webview

# Build for production (both targets, minified)
npm run package

# Watch mode (esbuild + tsc in parallel)
npm run watch

# Run tests (compiles first)
npm test
```

To launch in the Extension Development Host: press **F5** in VS Code (uses `.vscode/launch.json`).
Run `npm run package` before F5 whenever Webview source has changed.

## Architecture

### Entry point
`src/extension.ts` exports `async activate(context)` and `deactivate()`. All commands, tree views, and Webview panels are registered here via `context.subscriptions`. Module-level helpers: `getSagaChannel()`, `logTokenUsage()`, `isAbortError()`.

### Module structure

Two core interfaces carry extensibility:

- **`LLMProvider`** (`src/llm/provider.ts`) — provider-agnostic AI access. Adapters: `VsCodeLmProvider` (Copilot), `LocalLmProvider` (Ollama/LM Studio). BYOK adapters come in M4.
- **`TrackerAdapter`** — provider-agnostic tracker sync (M2+).

### Implemented modules

| Module | File | Notes |
|---|---|---|
| Zod schemas | `src/schema/index.ts` | `Epic`, `Story`, `ContextEntry`, `InvestResult`, `Config`, `RoutingValueSchema` |
| YAML I/O | `src/saga-repo.ts` | typed read/write for epics, stories, config, context registry |
| LLM provider interface | `src/llm/provider.ts` | `LLMProvider`, `LLMResponse`, `TokenUsage` |
| VS Code LM adapter | `src/llm/vscode-lm.ts` | Copilot; estimates tokens via `countTokens()` + char÷4 |
| Local adapter | `src/llm/local.ts` | Ollama/LM Studio; exact token counts from OpenAI API |
| Routing resolver | `src/llm/routing.ts` | `resolveProviderFromConfig(task, root)` — reads config, returns provider + modelLabel |
| Secrets | `src/secrets.ts` | `SecretsManager` wrapping VS Code SecretStorage |
| FS helpers | `src/saga-fs.ts` | Scaffold `.saga/`, update `.gitignore`, `isSagaInitialized()` |
| Text extractor | `src/context/extractor.ts` | `.md/.txt/.pdf/.docx/code` extraction |
| Context manager | `src/context/manager.ts` | `addContextFile()`, `addInlineContext()`, `removeContextFile()`, `loadContextTexts()` |
| Prompt templates | `src/generation/prompts.ts` | Handlebars: epic gen, story gen (with sibling epics), epic refine, story refine |
| Generation service | `src/generation/service.ts` | `GenerationResult<T>`; generate + refine epics/stories; `AbortSignal` + `TokenUsage` throughout |
| INVEST validator | `src/invest/validator.ts` | Heuristic + LLM-assisted scoring, 6 criteria |
| Tree views | `src/tree/saga-tree.ts` | `SagaTreeProvider`, `ContextTreeProvider`, file watchers |
| Webview HTML helper | `src/webview/html.ts` | Reads Vite's hashed `index.html` at runtime, rewrites asset URIs, injects CSP |
| Story panel | `src/webview/story-panel.ts` | Form/YAML editor; INVEST validate; save |
| Settings panel | `src/webview/settings-panel.ts` | GUI over `config.yaml`; SecretStorage key entry; `discoverModels()`; `testProvider()`; tracker config + `testTrackerConnection` |
| Generation review panel | `src/webview/generation-review-panel.ts` | Inline edit; INVEST validation; refine; `onRegenerate(signal)`; token usage forwarding |
| Tracker adapter interface | `src/tracker/adapter.ts` | `TrackerAdapter`, `PushResult`, `ConnectionTestResult`, `TrackerError` |
| Jira adapter | `src/tracker/jira.ts` | Jira Cloud REST v3; Basic auth; create/update/delete; ADF descriptions |
| ADO adapter | `src/tracker/ado.ts` | Azure DevOps REST; PAT auth; JSON Patch create/update/delete |
| Field mapping | `src/tracker/field-mapping.ts` | Saga domain → Jira ADF fields / ADO patch operations |
| Hash utility | `src/tracker/hash.ts` | `hashEpic` / `hashStory` — SHA-256 for drift detection |
| Sync store | `src/tracker/sync-store.ts` | `.saga/.sync/mappings.json` read/write |
| Tracker factory | `src/tracker/factory.ts` | `buildTrackerAdapter(root, secrets)` — returns correct adapter or undefined |
| Webview API singleton | `webview-ui/src/vscode-api.ts` | Single `acquireVsCodeApi()` — calling it twice crashes the Webview |
| Story bridge | `webview-ui/src/vscode.ts` | Typed postMessage for story panel |
| Settings bridge | `webview-ui/src/vscode-settings.ts` | Typed postMessage for settings panel; includes full tracker config shape |
| Generation review bridge | `webview-ui/src/vscode-generation-review.ts` | Typed postMessage for review panel; includes `TokenUsage` |
| Story editor React | `webview-ui/src/StoryEditor.tsx` | Form + YAML tabs, INVEST badges |
| Settings editor React | `webview-ui/src/SettingsEditor.tsx` | AI Provider, Model Routing (live picker), Tracker (Jira + ADO forms, Test Connection, credentials), Budget |
| Generation review React | `webview-ui/src/GenerationReview.tsx` | Inline edit, INVEST badges + issues, per-story refine, validate all, refine all, token display |

### `.saga/` folder (source of truth)
```
.saga/
├── config.yaml       # non-secret: provider routing, model IDs, tracker defaults
├── context/          # registered files + inline-NNN.md + context-registry.yaml
├── epics/            # EPIC-NNN.yaml
├── stories/          # STORY-NNN.yaml
├── prompts/          # generated agent prompts (M4)
├── templates/        # user-overridable Handlebars templates
└── .sync/            # gitignored: remote-ID mappings and last-synced snapshots
```

### Build pipeline
Two separate targets — run both before F5 when changing Webview source:

```bash
npm run compile          # extension: check-types + lint + esbuild → dist/extension.js
npm run compile:webview  # webview: vite build → dist/webview/ (hashed filenames)
npm run package          # both, production mode (minified, no sourcemaps)
```

### UI layers
- **Activity Bar** → Saga sidebar (two stacked `TreeDataProvider` views)
  - **Epics & Stories tree** — epics as parent nodes, stories as children with status badges; file watcher auto-refreshes
  - **Context Files tree** — file + inline context entries with role tags
- **Welcome view** — shown when `.saga/` not initialized; `saga.initialized` context variable hides it after `saga.init`
- **Story editor Webview** — Form + YAML tabs, INVEST badges, save via postMessage
- **Settings Webview** — GUI over `config.yaml`; single-instance panel
- **Generation Review Webview** — single-instance panel; `data-panel="generation-review"` routes `main.tsx` to the correct React component

## Key constraints

- **AI provider**: Default to VS Code LM API. BYOK and local are fallbacks. Class D (consumer OAuth token reuse) is permanently prohibited — Anthropic blocked Jan 2026, Google Feb 2026.
- **Model routing**: `config.yaml` routing entries are a model ID string or `"auto"`. Always use `resolveProviderFromConfig(task, root)` — never the old `getProvider()` helper which ignores config.
- **Model label**: every generation run must show `<model-id> (<provider>)` in the progress notification and the Generation Review panel header.
- **Token usage**: log to Saga Output Channel and show in review panel header after every call. Label VS Code LM estimates `(est.)`. BYOK exact counts come in M4.
- **Cancellation**: all generation `withProgress` must be `cancellable: true`. Convert `CancellationToken` → `AbortController` → `AbortSignal`; thread through `GenerationService` into `provider.generate()`. `onRegenerate` also receives the signal. Catch abort cleanly — info message, no error.
- **Secrets**: `context.secrets` (SecretStorage) for every credential. Zero secrets in `.saga/` or committed files.
- **LLM output**: always parse with Zod; never raw `JSON.parse`. Retry on parse failure with stricter prompt.
- **Webview `acquireVsCodeApi()`**: call exactly once — in `webview-ui/src/vscode-api.ts`. All bridges import from there.
- **Deletion**: all file deletions use `{ useTrash: true }` — recoverable from OS trash.
- **Tracker push**: always use `buildTrackerAdapter(root, secrets)` — never instantiate `JiraAdapter` / `AdoAdapter` directly in commands. Story push requires parent epic to be pushed first (F15b). Story points field is omitted by default; configure `jira.story_points_field_id` to enable. Jira ADF `content` must never be empty (toAdf pads with a space paragraph).
- **Tracker delete**: all deletes go through `trackerAwareDelete()` when item has `remote.key`. Remote delete failures must not hard-block local delete — always offer "Delete locally anyway?".
- **Sync safety**: sync is always explicit (user-triggered), previews before applying, idempotent. No background auto-push.
- **Testing**: `@vscode/test-electron` for VS Code host integration tests; Vitest for pure logic (parsers, validators).

## Key dependencies

**Installed:**
- `zod` — schema validation and LLM output parsing
- `yaml` — read/write `.saga/` YAML files
- `handlebars` — generation prompt templates
- `@cucumber/gherkin` — Gherkin scenario lint
- `pdf-parse`, `mammoth` — text extraction from PDF/DOCX
- `react`, `react-dom`, `vite`, `@vitejs/plugin-react` — Webview UI

**To add (M4):**
- `@anthropic-ai/sdk`, `@google/generative-ai` — BYOK provider adapters with exact token counts
