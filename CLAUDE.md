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

**M3 ✓ Complete** — Two-way sync + conflict resolution (F11) + status decorations (F14):
- **`fetchEpic` / `fetchStory`** added to `TrackerAdapter` interface + `JiraAdapter` + `AdoAdapter`: fetch current remote state by tracker key; ADF→text and HTML→text parsing with flexible AC extraction to survive Jira/ADO round-trips; user-story fields fall back to local values when tracker parsing yields empty strings.
- **`hashRemoteEpic` / `hashRemoteStory`** in `hash.ts`: hash remote items over the same canonical field set as `hashEpic`/`hashStory` so the 3-way diff is comparable.
- **`sync-engine.ts`**: `buildSyncPlan(adapter, sagaRoot, epics, stories)` fetches all pushed items in parallel, classifies each as `in-sync | local-only | remote-only | conflict` via 3-way hash comparison (local hash vs base hash vs remote hash). Fetch failures are per-item (don't abort the plan). `countByKind()` for UI summary.
- **`conflicts-store.ts`**: `.saga/.sync/conflicts.json` sidecar — `writeConflicts` / `clearConflicts`; written after `buildSyncPlan`, cleared after apply. Tree watches this file to refresh `[conflict ⚠]` badges without polling the tracker.
- **`SyncReviewPanel`** (`src/webview/sync-review-panel.ts`): single-instance panel; receives plan + lookup maps; `runApply()` executes push/pull/keep-local/take-remote resolutions in order, writing YAML + sync store + clearing conflicts on success. Pull writes `StorySchema.parse()`-normalised content then hashes the parsed result — so `local_hash` and `last_synced_hash` match what `readStory()` produces, making subsequent drift detection accurate.
- **`SyncReview.tsx`** + `sync-review.css`: React UI grouped into local-only / remote-only / conflicts / in-sync sections; conflict cards show field-by-field diff table with "Keep local / Take remote / Skip" resolution picker; fixed footer with Apply/Cancel; fetch errors listed separately.
- **`vscode-sync-review.ts`** (webview bridge): typed postMessage contract `load → apply → applyAck`.
- **F14 — `[conflict ⚠]` tree decoration**: `SagaTreeProvider` reads `conflicts.json` on every `getChildren()` call; epics and stories in the sidecar get orange `warning` icon + `[conflict ⚠]` badge. A second `FileSystemWatcher` on `.sync/conflicts.json` auto-refreshes the tree.
- **`saga.sync` command** + `$(sync)` sidebar toolbar button: builds adapter → `buildSyncPlan` with progress → writes conflict markers → opens `SyncReviewPanel`. Fetch errors logged to Saga Output Channel.
- **Story Editor passthrough fix**: `StoryPanel` `storyToMsg`/`msgToStory` and `StoryData` webview type now carry `remote` and `local_hash` — saving a story via the editor no longer strips sync state, so drift detection and update-vs-create on push both work correctly after a pull.

**M4 ✓ Complete** — Code loop — Three sub-milestones:

**M4.1 — BYOK provider adapters (F7):**
- `AnthropicProvider` (`src/llm/anthropic.ts`): Anthropic SDK, exact token counts, `AbortSignal`, key via `() => Promise<string | undefined>` callback injected at construction
- `GeminiProvider` (`src/llm/gemini.ts`): Google Generative AI SDK, exact token counts, `AbortSignal`, same key-getter pattern
- `OpenAIByokProvider` (`src/llm/openai-byok.ts`): OpenAI SDK (separate from `LocalLmProvider`), live model list from `/models`, exact token counts
- `src/llm/routing.ts` `buildProvider()` — `anthropic`/`gemini`/`openai` cases filled in
- Settings Webview now shows real model lists for all three BYOK providers

**M4.2 — Agent prompt generation (F12):**
- `saga.generateAgentPrompt` command — right-click story in tree (`$(robot)` inline icon)
- `src/generation/agent-prompt.ts` — `generateAgentPrompt(provider, story, stack, relevantFiles, context, signal?)` → `AgentPromptResult { content, usage? }`
- `src/context/workspace-scanner.ts` — heuristic file relevance scoring (filename/path token overlap vs story title+labels, score 0–1, threshold 0.1, cap 20); stack detection (reads `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`); `getDirectoryLayout()` for 2-level tree
- `src/webview/agent-prompt-panel.ts` + `webview-ui/src/AgentPromptPanel.tsx` + `webview-ui/src/vscode-agent-prompt.ts` — **per-story panels** (one tab per story ID, opens in `ViewColumn.Beside`); editable textarea; token count in header; Copy to Clipboard + Save buttons
- Output saved to `.saga/prompts/STORY-NNN.prompt.md` **only on explicit Save** (not on generation)
- `src/saga-repo.ts` — `writePrompt(sagaRoot, storyId, content)` / `readPrompt(sagaRoot, storyId)` helpers

**M4.3 — AGENTS.md generation (F13):**
- `saga.generateAgentsMd` command — Command Palette + `$(file-code)` Epics & Stories view toolbar button
- `src/generation/agents-md.ts` — `generateAgentsMd(provider, stack, layout, context, existingAgentsMd?, signal?)` → `AgentsMdResult { content, usage? }`
- `src/context/workspace-scanner.ts` (shared with M4.2) — stack detection + `getDirectoryLayout()` (2 levels, filtered); existing `AGENTS.md` content passed to prompt for continuity
- `src/agents-md-lock.ts` — `readLock(sagaRoot)` / `writeLock(sagaRoot, hash)` / `sha256(content)` — SHA-256 of last generated content, stored at `.saga/AGENTS.md.lock`; warns if `AGENTS.md` has been hand-edited since last generation
- `src/webview/agents-md-panel.ts` + `webview-ui/src/AgentsMdPanel.tsx` + `webview-ui/src/vscode-agents-md.ts` — single-instance Webview panel; editable textarea; "new file" / "updating existing" badge; Accept (writes `AGENTS.md` + updates lock) / Regenerate (re-calls LLM with `AbortSignal`) / Discard

**M5 — Polish & Publish** *(in progress — four sub-milestones)*

**M5.1 ✓ Complete — Subtasks + Clickable context + Codebase context in prompts:**
- **F28 (subtasks):** `SubtaskSchema { id, title, type, done, remote? }` added to `StorySchema` (`subtasks: []` default). `hashStory()` includes `subtasks` (id/title/type/done only) so drift detection catches subtask changes. `nextSubtaskId(story)` in `saga-repo.ts` — scoped per-story, not global. `src/generation/subtasks.ts` — `generateSubtasks(provider, story, signal?)` → `SubtaskResult { items: ProposedSubtask[], usage? }`; new `subtask_generation` routing task. `saga.generateSubtasks` command (Command Palette + story context menu `$(checklist)`) proposes subtasks via LLM, merges with allocated IDs, writes story, offers "Open Story". `StoryPanel.open()` re-fetches from disk (`reload()`) even when reusing an already-open panel, so externally-triggered changes (e.g. subtasks generated from the tree) always show up without a manual close/reopen. Story editor Webview gains a **Subtasks** tab: checklist with done-toggle, inline title/type edit, add/remove, "✨ Generate Subtasks" button (same LLM flow, in-panel via `generateSubtasks`/`generatingSubtasks`/`subtasksGenerated` postMessage types — `StoryPanel` now takes an optional `SecretsManager` for provider resolution). Subtasks render as collapsible child tree nodes under their story (`SubtaskTreeItem`, checkmark/circle icon, done-count badge on the parent). Tracker push: `TrackerAdapter.pushSubtask(subtask, storyRemoteKey)` — Jira creates an issue of type `jira.subtask_issue_type` (config-driven, default `"Sub-task"` — some projects use `"Subtask"` or don't support the sub-task hierarchy at all) linked via `parent`; ADO creates a `Task` work item linked via `System.LinkTypes.Hierarchy-Reverse` and sets `System.State` (Closed/New) from `done`. Subtask push is **not** part of `saga.pushAll` — offered only as a "Push N Subtasks" action on the `saga.pushStory` success notification, and only once the parent story has a remote key. Subtasks render as a `## Subtasks` checklist section in generated agent prompts (`buildAgentPromptGenPrompt`).
- **Subtask 3-way sync:** subtasks are fully wired into `saga.sync` / `SyncReviewPanel`, not just one-shot push. `TrackerAdapter.fetchSubtask(remoteKey)` → `RemoteSubtask { key, title, done, url }` (no `type` — trackers have no equivalent concept). `hashComparableSubtask({id,title,done})` / `hashRemoteSubtask()` in `hash.ts` are the tracker-comparable hash pair — deliberately narrower than `hashSubtask()` (which includes `type` and is only used for the parent story's local drift hash). `pushSubtask()` in both adapters stores `hashComparableSubtask()` as `last_synced_hash`, not the full `hashSubtask()`, so the classification stays consistent across pushes. `buildSyncPlan()` fetches+classifies every pushed subtask (`SubtaskSyncState`, keyed by `syncId = "${storyId}:${subtaskId}"` since subtask IDs are only unique within a story) alongside epics/stories; conflicts on a subtask also mark the parent story `[conflict ⚠]` in the tree (subtasks have no tree-level badge of their own). `SyncReviewPanel.runApply()` batches subtask resolutions per parent story (one read + one write per story) to avoid clobbering sibling subtask writes, and requires the parent story to already have a remote key before pushing a subtask. Mapping store entries for subtasks use the same `syncId` as their key in `.sync/mappings.json`.
- **F29 (codebase context in prompts):** `WorkspaceScanner.getRelevantFileContents(story)` — reuses `findRelevantFiles()` scoring, reads up to 150 lines per file, skips lock/binary files (`package-lock.json`, `yarn.lock`, etc. via `EXCLUDED_CONTENT_FILES`). `saga.generateAgentPrompt` shows a `canPickMany` QuickPick (all pre-checked) listing `<path>  · relevance <score> · ~<tokens> tokens` with a running total in the placeholder, before generation; user's selection is passed through as `relevantFileContents` into `generateAgentPrompt()` → rendered in a `## Relevant Files — Contents` fenced-code section of the prompt.
- **F30 (clickable context files):** `saga.openContextFile` command — `ContextTreeItem.command` opens the clicked entry. Inline entries (`inline-NNN.md`) always open from `.saga/context/`; registered files prefer the original `entry.path`, falling back to the `.saga/context/` copy if the original was moved/deleted, with an info message if neither exists.

**M5.2 — Template editor + OpenRouter:**
- **F16 (template editor):** `saga.openTemplate` command — QuickPick lists all Handlebars templates; selects copy to `.saga/templates/` if not overridden already, then opens in editor. `saga.resetTemplate` command — deletes override after modal confirm. Generation pipeline checks `.saga/templates/<name>.hbs` before bundled default (existing `loadTemplate()` extended).
- **F31 (OpenRouter adapter):** `OpenRouterProvider` (`src/llm/openrouter.ts`) — OpenAI-compatible, `https://openrouter.ai/api/v1`, `HTTP-Referer: vscode-saga`. Live `/models` list with pricing metadata shown in Settings Webview model pickers. Key stored in SecretStorage under `openrouter` namespace. `buildProvider()` in `routing.ts` gets `openrouter` case. `ConfigSchema` gains `openrouter: { enabled }` provider entry.

**M5.3 — Export backlog:**
- **F32 (export):** `saga.exportBacklog` command — QuickPick: Markdown / PDF / Word / Excel → VS Code Save dialog → progress notification → "Open File" action on success. `src/export/` module: `export-markdown.ts`, `export-pdf.ts` (HTML→PDF via lightweight renderer), `export-docx.ts` (using `docx` package), `export-xlsx.ts` (using `exceljs` package). Hierarchy: Epic (H1) → Story (H2) → Subtask (H3) in text formats; flat rows with `EpicID`/`StoryID`/`SubtaskCount` columns in Excel. INVEST badges included in all formats.

**M5.4 — Story splitting + Getting Started + Polish:**
- **F34 (story splitting):** `saga.splitStory` — right-click story with INVEST "small = warn/fail"; calls LLM proposing 2–3 replacement stories; opens in Generation Review panel; saves via normal Save flow. Adds `story_splitting` routing task (already in schema).
- **F33 (Getting Started Webview):** opened after `saga.init`; 3-step guided flow: provider → context file → first epic; skippable; calls existing commands under the hood. Single-instance, `data-panel="getting-started"`.
- **F35 (telemetry opt-in):** anonymous event tracking (command name, provider type, story count — no content); off by default; opt-in via Settings Webview checkbox; documented in README and Privacy notice.
- **F36 (first-run checks):** after `saga.init`, verify at least one provider is enabled; if not, show notification with "Configure" action that opens the Settings Webview.
- **Docs + Marketplace assets:** README with animated GIF walkthrough, CHANGELOG, extension icon, Marketplace description, category tags.

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

- **`LLMProvider`** (`src/llm/provider.ts`) — provider-agnostic AI access. Adapters: `VsCodeLmProvider` (Copilot), `LocalLmProvider` (Ollama/LM Studio), `AnthropicProvider`, `GeminiProvider`, `OpenAIByokProvider` (all M4.1).
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
| Hash utility | `src/tracker/hash.ts` | `hashEpic` / `hashStory` / `hashSubtask` (local, includes `type`) / `hashComparableSubtask` + `hashRemoteSubtask` (tracker-comparable, no `type`) / `hashRemoteEpic` / `hashRemoteStory` — SHA-256 for drift + 3-way sync |
| Sync store | `src/tracker/sync-store.ts` | `.saga/.sync/mappings.json` read/write |
| Conflicts store | `src/tracker/conflicts-store.ts` | `.saga/.sync/conflicts.json` — transient sidecar for `[conflict ⚠]` tree badges |
| Sync engine | `src/tracker/sync-engine.ts` | `buildSyncPlan()` — fetch + classify all pushed items; `countByKind()` |
| Tracker factory | `src/tracker/factory.ts` | `buildTrackerAdapter(root, secrets)` — returns correct adapter or undefined |
| Webview API singleton | `webview-ui/src/vscode-api.ts` | Single `acquireVsCodeApi()` — calling it twice crashes the Webview |
| Story bridge | `webview-ui/src/vscode.ts` | Typed postMessage for story panel; carries `remote` + `local_hash` through for drift correctness |
| Settings bridge | `webview-ui/src/vscode-settings.ts` | Typed postMessage for settings panel; includes full tracker config shape |
| Generation review bridge | `webview-ui/src/vscode-generation-review.ts` | Typed postMessage for review panel; includes `TokenUsage` |
| Sync review bridge | `webview-ui/src/vscode-sync-review.ts` | Typed postMessage for sync panel: `load → apply → applyAck` |
| Story editor React | `webview-ui/src/StoryEditor.tsx` | Form + YAML tabs, INVEST badges |
| Settings editor React | `webview-ui/src/SettingsEditor.tsx` | AI Provider, Model Routing (live picker), Tracker (Jira + ADO forms, Test Connection, credentials), Budget |
| Generation review React | `webview-ui/src/GenerationReview.tsx` | Inline edit, INVEST badges + issues, per-story refine, validate all, refine all, token display |
| Sync review React | `webview-ui/src/SyncReview.tsx` | Grouped sections (local-only/remote-only/conflicts/in-sync); conflict field diff table; resolution pickers |
| Anthropic adapter | `src/llm/anthropic.ts` | BYOK; Anthropic SDK; exact token counts; key via `() => Promise<string\|undefined>` callback; `AbortSignal` |
| Gemini adapter | `src/llm/gemini.ts` | BYOK; Google Generative AI SDK; exact token counts; key callback; `AbortSignal` |
| OpenAI BYOK adapter | `src/llm/openai-byok.ts` | BYOK; OpenAI SDK; live `/models` list; exact token counts; key callback |
| Workspace scanner | `src/context/workspace-scanner.ts` | Heuristic file relevance scoring; `getRelevantFileContents(story)` (M5.1/F29) — top-scored files with up to 150 lines each, lock/binary files excluded; stack detection (`package.json`/`pyproject.toml`/`Cargo.toml`/`go.mod`); directory layout; shared by F12+F13+F29 |
| Agent prompt generator | `src/generation/agent-prompt.ts` | `generateAgentPrompt(provider, story, stack, relevantFiles, context, signal?, relevantFileContents?)` → `AgentPromptResult { content, usage? }` |
| AGENTS.md generator | `src/generation/agents-md.ts` | `generateAgentsMd(provider, stack, layout, context, existingAgentsMd?, signal?)` → `AgentsMdResult { content, usage? }` |
| *(M5.1)* Subtask generator | `src/generation/subtasks.ts` | `generateSubtasks(provider, story, signal?)` → `SubtaskResult { items: ProposedSubtask[], usage? }` — proposals only, caller allocates IDs via `nextSubtaskId()` |
| AGENTS.md lock | `src/agents-md-lock.ts` | `readLock` / `writeLock` / `sha256` — SHA-256 of last generated content at `.saga/AGENTS.md.lock`; detects hand-edits |
| Agent prompt panel | `src/webview/agent-prompt-panel.ts` | Per-story panels (Map keyed by story ID); opens in `ViewColumn.Beside`; editable textarea; token count; Copy + Save on explicit user action; `data-panel="agent-prompt"` |
| AGENTS.md panel | `src/webview/agents-md-panel.ts` | Single-instance; editable textarea; "new file"/"updating existing" badge; Accept/Regenerate/Discard; `data-panel="agents-md"` |
| Agent prompt bridge | `webview-ui/src/vscode-agent-prompt.ts` | Typed postMessage: `ready → load`; `save\|copy → extension` |
| AGENTS.md bridge | `webview-ui/src/vscode-agents-md.ts` | Typed postMessage: `ready → load`; `accept\|regenerate\|discard → extension`; `acceptAck` on success |
| Agent prompt React | `webview-ui/src/AgentPromptPanel.tsx` | Editable textarea; token display in header; Copy to Clipboard + Save (dirty indicator) |
| AGENTS.md React | `webview-ui/src/AgentsMdPanel.tsx` | Editable textarea; new/updating badge; Regenerate/Discard/Accept footer |
| *(M5.1)* Context open command | `saga.openContextFile` in `extension.ts` | Opens registered file or `.saga/context/inline-NNN.md` in VS Code editor |
| *(M5.2 — planned)* OpenRouter adapter | `src/llm/openrouter.ts` | BYOK; OpenAI-compatible; `HTTP-Referer: vscode-saga`; live `/models` with pricing metadata; key callback; `AbortSignal` |
| *(M5.2 — planned)* Template manager | `src/template-manager.ts` | `listTemplates()`, `openTemplate(name)`, `resetTemplate(name)` — copies bundled `.hbs` to `.saga/templates/` |
| *(M5.3 — planned)* Export module | `src/export/` | `export-markdown.ts`, `export-pdf.ts`, `export-docx.ts`, `export-xlsx.ts` — assembled from `listEpics`/`listStories` |
| *(M5.4 — planned)* Getting Started panel | `src/webview/getting-started-panel.ts` | Single-instance; 3-step onboarding; `data-panel="getting-started"` |

### `.saga/` folder (source of truth)
```
.saga/
├── config.yaml           # non-secret: provider routing, model IDs, tracker defaults
├── context/              # registered files + inline-NNN.md + context-registry.yaml
├── epics/                # EPIC-NNN.yaml
├── stories/              # STORY-NNN.yaml (subtasks embedded as array field, M5.1)
├── prompts/              # generated agent prompts: STORY-NNN.prompt.md (M4.2)
├── templates/            # user-overridable Handlebars templates (M5.2)
│   ├── epic-generation.hbs
│   ├── story-generation.hbs
│   ├── story-refine.hbs
│   ├── agent-prompt.hbs
│   └── agents-md.hbs
├── AGENTS.md.lock        # SHA-256 of last generated AGENTS.md — detects hand-edits (M4.3)
└── .sync/                # gitignored: remote-ID mappings and last-synced snapshots
    ├── mappings.json         # sagaId → { jira|ado: { key, url, last_synced_hash, last_synced_at } }
    └── conflicts.json        # transient: [ "STORY-003", "EPIC-001", ... ] — cleared after sync apply
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
- **Sync Review Webview** — single-instance panel; `data-panel="sync-review"`; shows plan grouped by sync state; conflict cards with field diff table and resolution pickers
- **Agent Prompt Webview** — per-story panels (one tab per story ID, `ViewColumn.Beside`); `data-panel="agent-prompt"`; editable textarea, token count in header, Copy to Clipboard + Save on explicit user action (M4.2)
- **AGENTS.md Webview** — single-instance panel; `data-panel="agents-md"`; generated content, diff comparison, Accept/Regenerate/Discard (M4.3)

## Key constraints

- **AI provider**: Default to VS Code LM API. BYOK and local are fallbacks. Class D (consumer OAuth token reuse) is permanently prohibited — Anthropic blocked Jan 2026, Google Feb 2026.
- **Model routing**: `config.yaml` routing entries are a model ID string or `"auto"`. Always use `resolveProviderFromConfig(task, root)` — never the old `getProvider()` helper which ignores config.
- **Model label**: every generation run must show `<model-id> (<provider>)` in the progress notification and the Generation Review panel header.
- **Token usage**: log to Saga Output Channel and show in review panel header after every call. Label VS Code LM estimates `(est.)`. BYOK adapters (M4.1+) return exact counts from provider SDKs.
- **Cancellation**: all generation `withProgress` must be `cancellable: true`. Convert `CancellationToken` → `AbortController` → `AbortSignal`; thread through `GenerationService` into `provider.generate()`. `onRegenerate` also receives the signal. Catch abort cleanly — info message, no error.
- **Secrets**: `context.secrets` (SecretStorage) for every credential. Zero secrets in `.saga/` or committed files.
- **LLM output**: always parse with Zod; never raw `JSON.parse`. Retry on parse failure with stricter prompt.
- **Webview `acquireVsCodeApi()`**: call exactly once — in `webview-ui/src/vscode-api.ts`. All bridges import from there.
- **Deletion**: all file deletions use `{ useTrash: true }` — recoverable from OS trash.
- **Tracker push**: always use `buildTrackerAdapter(root, secrets)` — never instantiate `JiraAdapter` / `AdoAdapter` directly in commands. Story push requires parent epic to be pushed first (F15b). Story points field is omitted by default; configure `jira.story_points_field_id` to enable. Jira ADF `content` must never be empty (toAdf pads with a space paragraph).
- **Tracker delete**: all deletes go through `trackerAwareDelete()` when item has `remote.key`. Remote delete failures must not hard-block local delete — always offer "Delete locally anyway?".
- **Sync safety**: sync is always explicit (user-triggered), previews before applying, idempotent. No background auto-push.
- **Pull correctness**: when writing a pulled story, always run `StorySchema.parse()` on the merged object first, then call `hashStory()` on the parsed result. Store that hash as both `local_hash` and `remote.last_synced_hash`. This ensures `storyEffectiveStatus()` and push update-vs-create both work correctly after the pull. Never use `hashRemoteStory()` as the stored hash — it's only for classification during sync planning.
- **Story Editor passthrough**: `StoryMsg` (extension) and `StoryData` (webview) must always carry `remote` and `local_hash` through the postMessage round-trip. These fields are never edited by the UI — they are opaque sync state. Dropping them on save loses the remote key (causing re-create on next push) and breaks drift detection.
- **Testing**: `@vscode/test-electron` for VS Code host integration tests; Vitest for pure logic (parsers, validators).
- **BYOK key pattern**: BYOK adapters (`AnthropicProvider`, `GeminiProvider`, `OpenAIByokProvider`) receive a `() => Promise<string | undefined>` key-getter callback at construction — never a raw key string, never a `SecretsManager` reference. This keeps the adapter testable and decoupled from the VS Code API.
- **Agent prompt — no presets in v1**: the prompt is generated without a target-agent preset; stack, directory layout, and story content are always included verbatim. Preset framing (Claude Code / Copilot / Gemini CLI / generic) is a P2 enhancement.
- **Agent prompt file path**: output is always `.saga/prompts/STORY-NNN.prompt.md`. The `writePrompt(sagaRoot, storyId, content)` helper in `saga-repo.ts` handles path construction. Never save to the workspace root. File is written only on explicit user Save — never eagerly on generation.
- **AGENTS.md lock**: `writeLock` stores a SHA-256 of the exact string written to `AGENTS.md`. On re-generation, if `AGENTS.md` exists but its current hash differs from the lock, the user must confirm before overwriting. If no lock file exists, treat `AGENTS.md` as potentially hand-written and always warn.
- **Workspace scanner**: never include `node_modules`, `.git`, `dist`, `build`, `out`, `.saga`, `.vscode` in any file listing. Respect a 200-file cap on candidate results to avoid freezing on large repos.
- **Agent prompt codebase context**: v1 uses heuristic scoring only — filename/path string overlap with story title + labels, no embeddings. Score 0–1; include files with score > 0.1, capped at top 20. Embeddings are P2.
- **Subtask ID generation**: subtask IDs are `SUB-NNN` scoped within a story (not globally unique). When creating new subtasks, find the max existing `id` within the story's `subtasks[]` array and increment.
- **Subtask hash inclusion**: `hashStory()` must include the `subtasks` array in the canonical field set so that adding/removing/completing a subtask counts as a local change for drift detection.
- **OpenRouter key pattern**: `OpenRouterProvider` uses the same `() => Promise<string | undefined>` key-getter callback as all other BYOK adapters. Key stored in SecretStorage under key name `saga.openrouter.apiKey`. Always send `HTTP-Referer: vscode-saga` and `X-Title: Saga` headers.
- **Template override resolution**: `loadTemplate(name, sagaRoot?)` checks `.saga/templates/<name>.hbs` first; falls back to the bundled default in `src/generation/templates/<name>.hbs`. If `sagaRoot` is undefined (no workspace), always use bundled default.
- **Export bundle size**: `docx` and `exceljs` are loaded via dynamic `import()` inside the export command handler to avoid adding ~2 MB to the extension's synchronous activation path.
- **Subtask tracker push**: subtasks should be pushed only when the parent story has a `remote.key`. Subtask push is not included in `saga.pushAll` v1 — only explicitly via the story push flow, a dedicated "push subtasks" action shown in the story push success notification, or a resolution in Sync Review.
- **Subtask sync hash**: never use `hashSubtask()` (which includes `type`) when comparing against remote state — trackers don't model Saga's task/test/chore type. Always use `hashComparableSubtask()` / `hashRemoteSubtask()` for anything that touches `RemoteSubtask` or `last_synced_hash` on a pushed subtask.
- **Context file open**: `saga.openContextFile` must handle the case where the original registered path no longer exists (file moved/deleted); fall back to opening the `.saga/context/<filename>` copy if present, or show an info message if neither exists.

## Key dependencies

**Installed:**
- `zod` — schema validation and LLM output parsing
- `yaml` — read/write `.saga/` YAML files
- `handlebars` — generation prompt templates
- `@cucumber/gherkin` — Gherkin scenario lint
- `pdf-parse`, `mammoth` — text extraction from PDF/DOCX
- `react`, `react-dom`, `vite`, `@vitejs/plugin-react` — Webview UI

- `@anthropic-ai/sdk` — Anthropic BYOK adapter; exact token counts from `usage` in API response
- `@google/genai` — Gemini BYOK adapter; exact token counts from `usageMetadata`; ESM-only, loaded via `Function('return import(...)')()` to avoid esbuild rewrite
- `openai` — OpenAI BYOK adapter; live `/models` list; exact token counts from `usage`

**To be installed for M5:**
- `docx` — Word `.docx` export (F32/M5.3); dynamically imported
- `exceljs` — Excel `.xlsx` export (F32/M5.3); dynamically imported
