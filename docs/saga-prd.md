# Saga — Product Requirements Document

**A VS Code extension for AI-assisted agile planning, kept in sync with your codebase and your tracker.**

| | |
|---|---|
| **Product** | Saga |
| **Config folder** | `.saga/` (git-tracked, source of truth) |
| **Surface** | VS Code extension (Marketplace target) |
| **v1 trackers** | Jira Cloud, Azure DevOps |
| **Status** | Draft v0.2 |
| **Owner** | Hari Prasad |

---

## 1. Summary

Saga turns the documents you already have — product briefs, technical designs, coding standards — into well-formed agile work items (epics → stories with INVEST checks and Gherkin acceptance criteria), pushes them to Jira Cloud or Azure DevOps, and keeps both sides in sync from a git-tracked `.saga/` folder that is the source of truth.

It then closes the loop back to engineering: select a story and Saga generates a ready-to-paste prompt for a coding agent (Claude Code, Copilot, Gemini CLI), with relevant codebase context attached, and can generate/maintain a root `AGENTS.md` describing the project for those agents.

The differentiator is the **planning ↔ code loop living inside the editor**, version-controlled, model-agnostic, and able to run on the AI subscription the developer already pays for.

---

## 2. Problem & motivation

- Writing good stories is slow, and most AI-generated stories are vague — they ignore the INVEST criteria and ship without testable acceptance criteria.
- The planning context (briefs, designs, standards) lives apart from the code, so stories drift from reality.
- Trackers (Jira/ADO) are clumsy to edit and impossible to version or diff.
- Once a story exists, an engineer still hand-assembles a prompt + context to hand to a coding agent — repetitive and lossy.
- Teams pay for AI subscriptions (Copilot, Claude, Gemini) but planning tools force yet another per-seat AI bill.

Saga addresses all five by sitting where the code is, treating plans as files, and reusing existing AI access.

---

## 3. Goals & non-goals

### Goals (v1)
- Generate epics and INVEST-compliant stories with Gherkin acceptance criteria from selected workspace files.
- Two-way sync with Jira Cloud and Azure DevOps, with `.saga/` as source of truth and explicit conflict resolution.
- Pluggable AI provider layer: VS Code LM API (Copilot), direct API keys (Anthropic/Google/OpenAI), and local OpenAI-compatible (Ollama/LM Studio).
- Per-story "generate agent prompt" with codebase context.
- Generate/refresh a root `AGENTS.md`.
- Secrets in VS Code SecretStorage; never in the repo.

### Non-goals (v1)
- Jira Server/Data Center (Cloud only first).
- Sprint/board management, burndown, capacity planning.
- Multi-user real-time collaboration inside Saga (git handles concurrency).
- Running the coding agent for you (Saga *produces* the prompt; execution stays in Claude Code / Copilot / etc.).
- Mobile or web client.

---

## 4. Target users

- **Primary:** developers and tech leads who plan and build in the same repo and want plans version-controlled next to code. (You.)
- **Secondary:** small product/eng teams who want AI-drafted backlogs reviewed in PRs before they hit Jira/ADO.
- **Tertiary (post-v1):** PMs who live in the tracker but want engineering-grade story quality.

---

## 5. Key concepts & domain model

### 5.1 The `.saga/` folder (source of truth)

```
.saga/
├── config.yaml              # non-secret project config (providers, tracker, defaults)
├── context/                 # references registered for generation (or pointers to them)
│   ├── product-brief.md
│   ├── technical-design.md
│   └── coding-standards.md
├── epics/
│   └── EPIC-001-checkout.yaml
├── stories/
│   ├── STORY-001-guest-checkout.yaml
│   └── STORY-002-saved-cards.yaml
├── prompts/                 # generated agent prompts (git-tracked): STORY-NNN.prompt.md
│   └── STORY-001.prompt.md
├── templates/               # user-overridable generation & prompt templates (F16/M5.2)
│   ├── epic-generation.hbs
│   ├── story-generation.hbs
│   ├── story-refine.hbs
│   ├── agent-prompt.hbs
│   └── agents-md.hbs
├── AGENTS.md.lock           # SHA-256 of last generated AGENTS.md — detects hand-edits (M4.3)
└── .sync/                   # sync state: remote IDs, hashes, last-synced snapshots
    └── mappings.json
```

- Everything in `.saga/` **except** `.sync/` cache internals is meant to be committed and code-reviewed.
- **No secrets** ever land here. API keys, PATs, and OAuth tokens live in SecretStorage.

### 5.2 Story file schema (illustrative)

```yaml
id: STORY-001                      # stable local ID (Saga-owned)
type: story
title: Guest checkout
epic: EPIC-001
status: draft                      # draft | ready | synced | in-progress | done
as_a: shopper
i_want: to check out without an account
so_that: I can buy quickly
description: |
  ...
invest:                            # scored at generation, re-checkable on demand
  independent: pass
  negotiable: pass
  valuable: pass
  estimable: pass
  small: warn                      # flagged: consider splitting
  testable: pass
acceptance_criteria:               # Gherkin
  - |
    Scenario: Successful guest purchase
      Given a guest with items in the cart
      When they complete payment with a valid card
      Then an order is created
      And a confirmation email is sent
estimate: 5
labels: [checkout, payments]
subtasks:                          # optional checklist of typed work items (F28/M5.1)
  - id: SUB-001
    title: Add guest session cookie handling
    type: technical                # technical | test | design | documentation | other
    done: false
  - id: SUB-002
    title: "Scenario: guest checkout confirmation email"
    type: test
    done: false
remote:                            # populated after sync
  provider: jira
  key: PROJ-142
  url: https://...
  last_synced_hash: 9f3a...
  last_synced_at: 2026-06-25T10:00:00Z
local_hash: a17c...                # hash of canonical fields, for change detection
```

---

## 6. Feature list

Prioritized: **P0** = v1 must-ship, **P1** = fast-follow, **P2** = later.

| # | Feature | Priority |
|---|---|---|
| F1 | Initialize `.saga/` in a workspace (scaffold config, templates, gitignore for `.sync`) | P0 |
| F2 | Register context files from the open folder (brief, design, standards) | P0 |
| F3 | Generate epics from context | P0 |
| F4 | Generate INVEST stories with Gherkin acceptance criteria | P0 |
| F5 | INVEST validator (score + actionable warnings, e.g. "too large, split") | P0 |
| F6 | Story explorer tree view + editor (read/edit story YAML with a friendly form) | P0 |
| F7 | AI provider abstraction: VS Code LM API, API-key providers, local OpenAI-compatible | P0 |
| F8 | Secrets via SecretStorage (keys/PATs/OAuth tokens) | P0 |
| F9 | Push to Jira Cloud (create/update epics & stories) | P0 |
| F10 | Push to Azure DevOps (create/update work items) | P0 |
| F11 | Pull from tracker + two-way sync with diff & conflict resolution | P0 |
| F12 | Per-story "Generate agent prompt" with codebase context | P0 |
| F13 | Generate/refresh root `AGENTS.md` from codebase + standards | P0 |
| F14 | Sync status decorations (synced / drifted / conflict) in the tree | P1 |
| F15 | Bulk push — push all unpushed/drifted epics then their stories in one action; progress per item; summary notification | P0 |
| F15b | Epic-first push enforcement — block `saga.pushStory` if the parent epic has not been pushed yet; prompt user to push the epic first | P0 |
| F15c | Push stories after epic — after `saga.pushEpic` succeeds, offer "Push Stories" in the success notification to push all stories under that epic | P0 |
| F15d | Tracker-aware delete — when deleting a pushed epic or story, offer to delete it from the tracker first; if the remote delete fails (e.g. permissions), ask "Delete locally anyway?" rather than silently blocking | P0 |
| F16 | Template customization — edit Handlebars generation templates and agent prompt templates in-editor via `saga.openTemplate`; `.saga/templates/` overrides are git-tracked; live reload on next generation | P0 |
| F17 | Story splitting assistant (acts on INVEST "small" warnings) | P1 |
| F18 | Dependency/links between stories and epics, mapped to tracker links | P1 |
| F19 | Cost/usage estimate before a generation run (token preview) | P2 |
| F20 | Additional trackers (Linear, GitHub Issues, Jira DC) via the same adapter interface | P2 |
| F21 | MCP exposure: run Saga as an MCP server so agents can read/write the backlog | P2 |
| F22 | Diff-aware regeneration (regenerate only changed stories when context updates) | P2 |
| F23 | Settings page Webview — GUI over `config.yaml` + SecretStorage credential entry | P0 |
| F24 | Inline text context — paste/type free-form text as additional context without creating a file | P0 |
| F25 | Delete epics, stories, and scoped/full cleanup — right-click delete with confirmation; clear all stories under an epic; clear all epics (and their stories); `Saga: Clean Up` removes everything | P0 |
| F26 | Token usage visibility — input/output token counts logged after every generation run; shown in Generation Review panel header and Saga Output Channel | P0 |
| F27 | Generation cancellation — cancel any in-progress generation via the VS Code progress notification dismiss button; stops the LLM call mid-flight and shows a "cancelled" notification | P0 |
| F28 | Subtasks on stories — each story can have 1-N typed subtasks (checklist items, technical tasks, test cases); subtasks included in agent prompts and tracker push (Jira sub-tasks / ADO child tasks) | P0 |
| F29 | Codebase context in agent prompts — `WorkspaceScanner` detects existing source files; relevant files auto-scored and included in agent prompt as `## Relevant files` with content snippets; user can review/trim in QuickPick before generation | P0 |
| F30 | Clickable context files — clicking a file in the Context Files tree opens it in the VS Code editor; clicking an inline context entry opens the `.saga/context/inline-NNN.md` file for editing | P0 |
| F31 | OpenRouter provider adapter — `OpenRouterProvider` class wrapping the OpenRouter REST API (OpenAI-compatible, `https://openrouter.ai/api/v1`); live model list from `/models`; key stored in SecretStorage; shown in Settings Webview alongside other BYOK providers; cost metadata from OpenRouter's model listing shown in model picker | P0 |
| F32 | Export backlog — `saga.exportBacklog` command exports all epics + stories + subtasks to Markdown, PDF, Word (`.docx`), or Excel (`.xlsx`) from a format QuickPick; preserves hierarchy (epic → stories → subtasks); INVEST badges shown in Markdown/PDF/Word; each format assembled without heavy runtime deps where possible | P0 |
| F33 | Getting Started Webview — guided onboarding panel opened after `saga.init`; covers provider setup, first context file, first epic generation; skippable at any step; links to existing commands | P1 |
| F34 | Story splitting assistant — right-click a story with INVEST "small = warn/fail" to propose 2–3 smaller replacement stories; preview in Generation Review panel; saves via normal review flow | P1 |
| F35 | Telemetry (opt-in) — anonymous usage events (command invocations, provider type, story count) sent only when the user explicitly opts in via settings; off by default; documented in README | P1 |
| F36 | Onboarding "first run" checks — on `saga.init`, verify that at least one provider is enabled and warn if none are; surface direct links to configure in the Settings Webview | P1 |
| F37 | Command title cleanup — drop the redundant `"Saga: "` prefix from all command titles (the Command Palette already groups by `category: "Saga"` and shows it as a separate column, so the prefix was pure duplication both there and in right-click menus) | P1 |
| F38 | Command Palette / UI parity — every command registered in `package.json` must be reachable from a visible UI element (toolbar button, inline icon, context-menu item, or the new "More Actions" overflow menu), not just the Command Palette | P1 |
| F39 | Design token spacing/radius scale — a shared CSS custom-property file (`tokens.css`) defining spacing steps, border radius, and font-size scale, imported by all Webview panel stylesheets so spacing is consistent instead of ad-hoc per-panel pixel values | P1 |
| F40 | Edit Epic — click an epic in the tree (or right-click → Edit) to open a dedicated editor Webview for title/description/labels; if title or description changes on an epic with existing stories, offer to regenerate stories (add new or replace all); sync drift is picked up automatically by existing hash-based detection, no new sync logic required | P1 |

### UI surface notes
- Every command is reachable from **both** the Command Palette (`Ctrl/Cmd+Shift+P`) and the Saga sidebar UI. Neither is the exclusive path (F38). Commands with no natural toolbar/context-menu home live in the sidebar's **"More Actions" (`...`) overflow menu** — currently: Getting Started, Clear Epics, Clean Up, Open Template, Reset Template.
- Command titles do **not** carry a `"Saga: "` prefix (F37) — the Command Palette's category column already provides that grouping, and the prefix was pure redundancy in right-click context menus where the user is already inside a Saga-owned view.
- Heavy interactions (story editing, 3-way diff, sync review) use a **Webview panel** (React) opening in the editor area. The Getting Started / onboarding flow for new users is also a Webview panel.
- Light interactions (provider selection, role tagging, confirmations) use native **QuickPick / Input boxes**.
- The sidebar tree provides **inline toolbar buttons** for power-user access to generate, validate, and sync actions without opening menus.
- All Webview panels share a common spacing/radius/font-size token scale (F39) defined once and imported everywhere, so panels feel like one system rather than seven independently-styled screens.

---

## 7. UI / UX design

### 7.1 Activity Bar & sidebar

Saga registers a dedicated **Activity Bar icon** (the Saga logo). Clicking it opens the Saga sidebar, which hosts two VS Code `TreeDataProvider` views stacked in one `ViewContainer`:

```
┌─────────────────────────────────────┐
│  SAGA                [+] [↻] [⚙]   │  ← view-level toolbar
│                                     │
│  ▼ EPICS & STORIES                  │  ← SagaTreeView (TreeDataProvider #1)
│    ▼ EPIC-001  Checkout      [✦ ↗]  │     ← inline item actions
│        STORY-001  [draft]    [✦ ↗]  │
│        STORY-002  [ready]    [✦ ↗]  │
│    ▼ EPIC-002  Onboarding    [✦ ↗]  │
│        STORY-003  [synced ✓] [✦ ↗]  │
│                                     │
│  ▼ CONTEXT FILES                    │  ← ContextTreeView (TreeDataProvider #2)
│      📄 product-brief.md  [brief]   │
│      📄 technical-design.md [design]│
│      [+ Add Context File]           │
└─────────────────────────────────────┘
```

**Toolbar buttons (top-right of the view):**
- `+` — Add Context File (F2)
- `↻` — Run Sync (M3+)
- `⚙` — Open Settings / config.yaml

**Inline item buttons (shown on hover):**
- `✦` — Generate stories for this epic / open story editor
- `↗` — Push to tracker (M2+)

**Status badge on stories** (F14, M3):
- `[draft]` — generated, not yet reviewed
- `[ready]` — reviewed, not yet pushed
- `[synced ✓]` — in sync with remote tracker
- `[drifted]` — local changes not pushed
- `[conflict ⚠]` — both local and remote changed

### 7.2 Empty / uninitialized state

When no `.saga/` folder exists in the workspace, **both** the sidebar tree and the Command Palette surface the init action:

**Sidebar empty state (Welcome view):**
```
┌─────────────────────────────────────┐
│  SAGA                               │
│                                     │
│   Saga is not initialized in this   │
│   workspace.                        │
│                                     │
│   [  Initialize Saga  ]             │
│                                     │
│   This will create a .saga/ folder  │
│   and a default config.yaml.        │
└─────────────────────────────────────┘
```

This is implemented as a VS Code `welcomeView` contribution (declarative, no Webview needed). The button triggers `saga.init` — the same command available from the Command Palette.

**Command Palette:**
- `Saga: Init` — always present; shows same initialization flow.

### 7.3 Getting Started Webview panel

After init (or triggered via **Saga: Getting Started** command), a Webview panel opens in the editor area to walk the user through the one-time setup:

```
┌─────────────────────────────────────────────────────┐
│  Saga — Getting Started                         [×] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Step 1 of 3 — Choose your AI provider             │
│  ──────────────────────────────────────────         │
│  ◉ VS Code LM API (Copilot) — recommended          │
│    Uses your existing Copilot subscription.         │
│                                                     │
│  ○ Local (Ollama / LM Studio)                       │
│    Free, fully offline. Needs a running instance.   │
│    Base URL: [http://localhost:11434/v1        ]     │
│                                                     │
│  ○ API Key (Anthropic / Gemini / OpenAI)            │
│    Pay-per-token. Key stored in SecretStorage.      │
│                                                     │
│                         [ Back ]  [ Next → ]        │
└─────────────────────────────────────────────────────┘
```

Steps:
1. **Choose AI provider** — selects and validates the active provider.
2. **Add first context file** — guides the user to register a product brief or design doc.
3. **Generate your first epic** — runs a generation and shows the result before writing to disk.

The Getting Started panel is skippable at any step. All its actions call the same commands (`saga.init`, `saga.addContextFile`, `saga.generateEpics`) that are available from the Command Palette and sidebar toolbar, so it is not a separate code path — just a guided wrapper.

### 7.4 Story editor Webview panel

Clicking a story in the tree (or **Saga: Open Story**) opens a Webview panel in the editor area:

```
┌─────────────────────────────────────────────────────┐
│  STORY-001 · Guest checkout              [✓] [↗] [×]│
├──────────────┬──────────────────────────────────────┤
│  Form view   │  YAML view                           │
│  ───────────────────────────────────────────────    │
│  Title       │  [Guest checkout              ]      │
│  Epic        │  [EPIC-001 — Checkout    ▼]          │
│  As a        │  [shopper                     ]      │
│  I want      │  [to check out without an account]   │
│  So that     │  [I can buy quickly           ]      │
│              │                                      │
│  INVEST      │  ✓ Independent  ✓ Negotiable         │
│              │  ✓ Valuable     ✓ Estimable           │
│              │  ⚠ Small (consider splitting)        │
│              │  ✓ Testable                          │
│              │                                      │
│  Acceptance  │  Scenario: Successful guest purchase │
│  Criteria    │    Given a guest with items in cart  │
│              │    When they complete payment…       │
│              │                                      │
│  Estimate    │  [5  ] story points                  │
│  Labels      │  [checkout] [payments] [+]           │
│              │                                      │
│              │       [ Validate ]  [ Save ]         │
└──────────────┴──────────────────────────────────────┘
```

- **Form view** (default): friendly fields, INVEST badge row, Gherkin editor.
- **YAML view** tab: raw `.saga/stories/STORY-NNN.yaml` for power users.
- **`[✓]` Validate** — re-runs INVEST check and refreshes badges in-panel.
- **`[↗]` Push** — pushes this story to the configured tracker (M2+).
- Changes are saved back to the YAML file on disk; the tree refreshes automatically.

### 7.5 Settings Webview panel (F23)

Opened via `saga.openSettings` (Command Palette or the `⚙` sidebar toolbar button). Replaces the raw `config.yaml` open behaviour for the common case — power users can still edit `config.yaml` directly.

```
┌─────────────────────────────────────────────────────┐
│  Saga — Settings                                [×] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  AI Provider                                        │
│  ──────────────────────────────────────────         │
│  ◉ VS Code LM API (Copilot)   [ Test ] ✓ Connected │
│    [✓] Enable as fallback                           │
│  ○ Local (Ollama / LM Studio) [ Test ]              │
│    Base URL: [http://localhost:11434/v1        ]     │
│    [✓] Enable as fallback                           │
│  ○ Anthropic (API Key)        [ Test ]              │
│    🔑 Key stored  [ Update Key ]                    │
│    [✓] Enable prompt caching                        │
│  ○ Google Gemini (API Key)    [ Test ]              │
│    ⚠ No key stored  [ Add Key ]                    │
│  ○ OpenAI (API Key)           [ Test ]              │
│    ⚠ No key stored  [ Add Key ]                    │
│                                                     │
│  Model Routing                                      │
│  ──────────────────────────────────────────         │
│  Models are fetched live from all enabled providers │
│                                                     │
│  Epic generation                                    │
│  [claude-sonnet-4-6 (Anthropic)              ▼]    │
│  Story generation                                   │
│  [claude-sonnet-4-6 (Anthropic)              ▼]    │
│  INVEST validation                                  │
│  [claude-haiku-4-5 (Anthropic)               ▼]    │
│  Story splitting                                    │
│  [gemini-2.0-flash (Gemini)                  ▼]    │
│  Agent prompt                                       │
│  [auto — cheapest available                  ▼]    │
│  AGENTS.md generation                              │
│  [auto — cheapest available                  ▼]    │
│                                                     │
│  Tracker             (coming in M2)                 │
│  ──────────────────────────────────────────         │
│  Default tracker     [none    ▼]  (greyed out)      │
│                                                     │
│  Budget                                             │
│  ──────────────────────────────────────────         │
│  Warn above (USD)    [0.50         ]                │
│  Show token preview  [✓]                            │
│                                                     │
│                              [ Save Settings ]      │
└─────────────────────────────────────────────────────┘
```

**Behaviour:**
- Non-secret fields (provider selection, base URL, model routing, budget) read from and write back to `.saga/config.yaml` — they remain git-tracked.
- API keys are **write-only** from the UI: the key field shows a key-present indicator if stored in SecretStorage, and an **Add Key / Update Key** button opens a VS Code Input Box to replace it. Keys are never read back into the Webview.
- Clicking a provider's radio button immediately marks it as active and auto-enables it; the "Enable as fallback" checkbox controls whether non-active providers participate in the fallback chain.
- **Test** button per provider calls `LLMProvider.isAvailable()` and shows a one-line result inline (`✓ Connected` / `✗ Unreachable` etc.).
- **Model Routing** dropdowns are populated from live `listModels()` calls against all enabled providers at settings-open time. Each option shows `<model-id> (<provider>)`. A special **"auto — cheapest available"** option at the top of each list delegates model selection to Saga's tier-based auto-routing (the previous default behaviour). If no providers are enabled, dropdowns show a "No models available" placeholder.
- **Tracker section** is visible but all fields are disabled with a "coming in M2" label — no functional code needed until M2.
- Changes are not applied until **Save Settings** is clicked; unsaved changes show a "●" dirty indicator in the panel title.

**Message contract (extension host ↔ Webview):**
- `load` → sends current `ConfigData` (non-secret fields only) + `providerStatus` map + `secretsPresent` map + `availableModels: ModelOption[]` (fetched via `listModels()` from all enabled providers)
- `save` ← Webview sends updated `ConfigData`; extension writes to `config.yaml`
- `saveSecret` ← Webview triggers a VS Code Input Box in the extension host (key never travels through the Webview message bus); host re-sends `load` after storing so `secretsPresent` updates
- `testConnection` ← Webview requests a live probe; extension responds with `connectionResult`
- `saveAck` → confirms the write completed

### 7.6 Generation Review Webview (F3, F4, F5)

Every generation flow (epics and stories) goes through a **Generation Review Webview** rather than a simple notification. The panel is the single place where the user can: add instructions before generating, review the output, run INVEST validation, refine via follow-up LLM calls, and finally save or discard.

#### Pre-generation: Additional Instructions input

Before the LLM call fires, a VS Code **Input Box** (lightweight — no Webview needed) asks:

```
Additional instructions (optional)
─────────────────────────────────
e.g. "Focus on mobile use cases" or "Keep stories under 5 points"
Press Enter to skip.
```

The typed text is appended to the generation prompt as a `## Additional Instructions` section. If the user presses Escape or leaves it blank, generation proceeds with no extra instructions.

#### Review panel — Epics

```
┌─────────────────────────────────────────────────────────────┐
│  Saga — Generated Epics                  [↺ Regenerate] [×] │
├─────────────────────────────────────────────────────────────┤
│  Model: claude-sonnet-4-6 (Anthropic)                       │
│  3 epics · 2 context files · 4,821 in / 612 out tokens      │
│                                                             │
│  ┌─ EPIC-001 ───────────────────────────────────────────┐   │
│  │ Title       [Guest Checkout                        ] │   │
│  │ Description [Covers the full guest purchase flow…  ] │   │
│  │             [ Edit inline…                         ] │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌─ EPIC-002 ──────────────────────── [✕ Remove] ───────┐   │
│  │ Title       [User Account Management               ] │   │
│  └──────────────────────────────────────────────────────┘   │
│  [ + Add Epic ]                                             │
│                                                             │
│  Refine instructions: [Make epics more granular      ]      │
│                                          [ ↺ Refine ] ]     │
│                                                             │
│                      [ Discard ]        [ Save Epics ]      │
└─────────────────────────────────────────────────────────────┘
```

#### Review panel — Stories

```
┌─────────────────────────────────────────────────────────────┐
│  Saga — Generated Stories: EPIC-001       [↺ Regen] [×]    │
├─────────────────────────────────────────────────────────────┤
│  Model: claude-sonnet-4-6 (Anthropic)                       │
│  4 stories · 2 context files · 6,103 in / 1,847 out tokens  │
│                                                             │
│  ┌─ STORY-001 ── [draft] ── INVEST: ✓✓⚠✓✓✓ ── [✕] ──────┐  │
│  │ Guest checkout — happy path                            │  │
│  │ As a shopper I want to check out without an account   │  │
│  │ [▼ Expand / Edit]                                     │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌─ STORY-002 ── [draft] ── INVEST: ✓✓✗✓⚠✓ ── [✕] ──────┐  │
│  │ ✗ Valuable: "so_that" reads as filler                 │  │
│  │ ⚠ Small: estimate of 8 — consider splitting           │  │
│  │ [↺ Refine this story]                                 │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  [ ✓ Validate All ]                                         │
│  Refine instructions: [Fix INVEST issues in all stories]    │
│                                          [ ↺ Refine All ]   │
│                                                             │
│                      [ Discard ]      [ Save Stories ]      │
└─────────────────────────────────────────────────────────────┘
```

**Behaviour:**
- **Model label** at top of panel shows `<model-id> (<provider>)` resolved from the routing config — so the user always knows what ran.
- **Inline editing** — title, description (epics) and all story fields are editable directly in the panel. Changes are local to the panel until Save.
- **Remove** (`✕`) — removes a single item from the list before saving.
- **Add Epic** — appends a blank epic form the user fills manually.
- **INVEST badges** — shown per story immediately after generation (the LLM returns its own self-assessment). Colors: green (pass), amber (warn), red (fail). Hover shows the reason.
- **Validate All** — runs `InvestValidator` on every story in the panel, refreshing badges. Runs client-side heuristics instantly; LLM-assisted checks (Independent, Negotiable) run async and update badges when complete.
- **Refine this story** — sends a follow-up prompt: *"The following story has INVEST issues: [list fails/warns]. Rewrite it to fix them while preserving the original intent."* The story card updates in-place.
- **Refine All** — same but applied to all stories in the panel; the instructions box text is prepended as additional guidance.
- **Regenerate** (`↺`) at the top — discards current output and re-runs the original generation (with the same additional instructions). Asks for confirmation if there are unsaved edits.
- **Save** — writes all remaining items to `.saga/epics/` or `.saga/stories/` and closes the panel.
- **Discard** — closes without writing anything. Asks for confirmation if items were edited.

**Message contract (extension host ↔ Webview):**
- `load` → `{ epics | stories, modelLabel, contextFileCount, tokenUsage?: { inputTokens, outputTokens, note } }`
- `validate` ← Webview requests INVEST run; host responds with `{ type: 'investResults', results: Record<storyId, InvestResult> }`
- `refine` ← `{ items, instructions }`; host re-calls LLM and responds with `{ type: 'refined', items, tokenUsage? }`
- `regenerate` ← triggers a fresh generation run; host responds with a new `load`
- `save` ← `{ items }`; host writes to disk and sends `{ type: 'saveAck' }`

### 7.7 Command Palette commands (full list)

All commands are prefixed `Saga:` and grouped under the `Saga` category.

| Command | Trigger | Notes |
|---|---|---|
| `Saga: Init` | Palette + sidebar empty state button | Creates `.saga/`, opens Settings |
| `Saga: Getting Started` | Palette + post-init notification | Opens onboarding Webview |
| `Saga: Add Context File` | Palette + sidebar `+` button + Explorer right-click | F2 — file context |
| `Saga: Add Inline Context` | Palette + sidebar `+` menu | F24 — free-text context entry |
| `Saga: Generate Epics` | Palette + sidebar toolbar | F3; asks for instructions → Generation Review Webview |
| `Saga: Generate Stories for Epic` | Palette + epic inline button | F4; asks for instructions → Generation Review Webview |
| `Saga: Validate Stories` | Palette + sidebar toolbar | F5; shows results in Output Channel |
| `Saga: Open Story` | Palette + story click in tree | Opens Story editor Webview |
| `Saga: Delete Epic` | Tree right-click on epic | F25; modal confirm; offers to delete child stories |
| `Saga: Delete Story` | Tree right-click on story | F25; modal confirm |
| `Saga: Clear Stories for Epic` | Tree right-click on epic | F25; deletes all stories under that epic; modal confirm |
| `Saga: Clear Epics` | Palette | F25; deletes all epics and all stories; modal confirm |
| `Saga: Clean Up` | Palette | F25; removes all epics, stories, prompts, and context; type `"delete all"` to confirm |
| `Saga: Generate Agent Prompt` | Palette + story tree right-click | F12 (M4.2); QuickPick file trim → Agent Prompt Webview panel |
| `Saga: Generate AGENTS.md` | Palette + Epics & Stories view toolbar button | F13 (M4.3); diff guard against hand-edits → AGENTS.md Webview panel |
| `Saga: Push All to Tracker` | Palette + sidebar `↑` toolbar button | F15; pushes all unpushed/drifted epics then stories; progress per item |
| `Saga: Sync` | Palette + sidebar `↻` button | M3+; opens sync review Webview |
| `Saga: Open Settings` | Palette + sidebar `⚙` button | Opens Settings Webview (F23) |
| `Saga: Test Generation` | Palette only (dev/debug) | M0 smoke test; removed pre-publish |
| `Saga: Generate Subtasks` | Palette + story tree right-click | F28 (M5.1); proposes typed subtasks for the selected story via LLM |
| `Saga: Open Template` | Palette | F16 (M5.2); QuickPick template list → opens `.saga/templates/<name>.hbs` for editing |
| `Saga: Reset Template to Default` | Explorer right-click on `.hbs` file | F16 (M5.2); deletes user override from `.saga/templates/` after modal confirm |
| `Saga: Export Backlog` | Palette | F32 (M5.3); QuickPick format → Save dialog → writes Markdown / PDF / Word / Excel |
| `Saga: Open Context File` | Context tree click | F30 (M5.1); opens context file or inline-NNN.md in the editor |

---

## 8. Detailed feature behavior

### 8.1 Context selection (F2, F24)

**File context (F2):**
- Command **Saga: Add Context File** and a right-click action in the Explorer.
- Supports `.md`, `.txt`, `.pdf` (text-extracted), `.docx` (text-extracted), and code files.
- Each context entry stores a path + role tag (`brief`, `design`, `standards`, `reference`) so generation can weight them.
- Large files show a character-count warning before registration.

**Inline text context (F24):**
- Command **Saga: Add Inline Context** — opens a multi-line VS Code Input Box where the user types or pastes free-form text (constraints, quick briefs, notes, scope boundaries).
- Stored as a `.saga/context/inline-NNN.md` file with the role `reference` and a `source: inline` marker in the registry — treated identically to file context during generation.
- Displayed in the Context Files tree with a ✏ icon and the first line as the label.
- Can be edited (re-open the file) or removed via right-click → Remove.

### 8.2 Epic & story generation (F3, F4)

**Flow for both epics and stories:**
1. User triggers generation (Command Palette or sidebar button).
2. **Additional instructions input** (optional) — a VS Code Input Box appears: *"Additional instructions — e.g. 'focus on mobile', 'keep stories small'. Press Enter to skip."* The text is appended to the LLM prompt.
3. A progress notification shows **`Generating via <model-id> (<provider>)…`** — the specific model resolved from routing config, not just the provider class.
4. Output opens in the **Generation Review Webview** (see §7.6) — never auto-saved.
5. User reviews, edits inline, validates INVEST (stories), refines, and clicks **Save** or **Discard**.

**Cancellation (F27):**
- The VS Code progress notification shown during generation includes a **✕ Cancel** button (implemented via `cancellable: true` in `withProgress`).
- Clicking cancel aborts the in-flight LLM request immediately via `AbortSignal`. Both providers support this: `VsCodeLmProvider` converts it to a VS Code `CancellationToken`; `LocalLmProvider` passes it directly to `fetch`.
- On cancellation, a `"Generation cancelled."` information message is shown — no error, no partial output written to disk.
- The `GenerationService` propagates the `AbortSignal` through `callWithRetry` into every `provider.generate()` call, including retry attempts.
- The Generation Review panel's **Regenerate** button triggers a fresh generation through the same cancellable path.

**Model resolution:**
- The generation task looks up `config.yaml → ai.routing.<task>` for the model ID (or `"auto"`).
- `"auto"` falls back to tier-based selection (quality tasks → best available model, cheap tasks → fastest).
- The resolved model ID and provider are shown in the progress notification and in the Generation Review panel header.
- If the configured model is unavailable, Saga warns and falls back to the next available model rather than failing silently.

**Token usage visibility (F26):**
- After every generation or refinement call, Saga captures and displays input + output token counts.
- Displayed in two places: (a) the Generation Review panel header line — `<N> in / <N> out tokens`; (b) the `Saga` Output Channel — one line per call: `✓ story_generation: 6,103 in / 1,847 out · claude-sonnet-4-6 (Anthropic)`.
- Token count availability by provider:

| Provider | Input tokens | Output tokens |
|---|---|---|
| **Local (Ollama / LM Studio)** | Exact — returned by the OpenAI-compatible API | Exact |
| **VS Code LM (Copilot)** | Estimated — `model.countTokens()` called before the request | Estimated — character count ÷ 4 (rough heuristic) |
| **BYOK (Anthropic / Gemini / OpenAI)** | Exact — returned by provider SDKs (`usage` / `usageMetadata` fields) | Exact |

- Estimated counts are labelled `(est.)` in the UI so users know the precision.
- On Copilot there is no marginal cost, so token counts are informational only — useful for understanding prompt size relative to context window limits.

**LLM output:**
- Strict YAML schema prompt → Zod parse → auto-retry on parse failure (up to 2 attempts).
- Every story includes user-story form, Gherkin scenarios (happy path + edge/negative), and an INVEST self-assessment.
- Nothing is written to disk until the user clicks **Save** in the review panel.

### 8.3 INVEST validator (F5)
- Runs automatically inside the Generation Review Webview when stories are generated (LLM self-assessment shown as initial badges).
- **Validate All** in the review panel re-runs the full `InvestValidator` (heuristic + LLM-assisted) against current panel content, refreshing all badges.
- **Refine this story** / **Refine All** — sends a targeted follow-up prompt asking the LLM to fix specific INVEST failures, updating the story in-place.
- Also available on-demand for already-saved stories: **Saga: Validate Stories** (Output Channel report) and the **✓ Validate** button in the Story editor Webview.
- Each criterion returns `pass | warn | fail` with a one-line reason.
- "Small = warn/fail" offers the **split assistant** (F17): proposes 2–3 smaller stories preserving acceptance coverage.

### 8.4 Push behaviour (F9, F10, F15b, F15c, F15d)

#### Epic-first enforcement (F15b)
`saga.pushStory` checks whether the parent epic has been pushed to the configured tracker before proceeding. If the epic has no `remote.key` for the active provider, Saga blocks the push with:
> *"EPIC-001 hasn't been pushed to Jira yet. Push the epic first so the story can be linked to it."*

A **Push Epic** action in that message lets the user jump straight to pushing the epic. This prevents stories from landing in the tracker as orphans with no parent link.

#### Post-epic push offer (F15c)
After `saga.pushEpic` succeeds, the success notification offers two actions alongside "Open in Browser":
> **Push Stories** — pushes all stories under that epic in sequence using the same adapter.

Stories that are already synced are updated (not re-created). Stories that have never been pushed are created with the parent link set to the just-pushed epic key.

#### Tracker-aware delete (F15d)
When the user deletes an epic or story that has a `remote.key` for the currently configured tracker, Saga adds a remote-delete step:

1. **Warning modal** includes the tracker key: *"STORY-001 is synced to PROJ-42 in Jira. Delete from Jira too?"*
2. Buttons: **Delete from Jira & locally**, **Delete locally only**, **Cancel**
3. If "Delete from Jira & locally" is chosen:
   - Saga calls `adapter.deleteStory(story)` / `adapter.deleteEpic(epic)`
   - If the remote delete **succeeds** → proceed with local trash delete
   - If the remote delete **fails** (e.g. 403 Forbidden, network error) → show the error and ask: *"Remote delete failed: [reason]. Delete locally anyway?"*
   - If the user confirms → local delete proceeds; `remote:` block is cleared from the YAML; sync store entry is removed
4. If "Delete locally only" is chosen → local delete proceeds immediately; `remote:` block is preserved in the YAML for reference (useful if the user wants to manually clean up the tracker later)

This requires `deleteEpic(epic)` and `deleteStory(story)` methods on the `TrackerAdapter` interface.

#### Bulk push (F15)
`saga.pushAll` pushes all epics and stories in a single operation:
1. Collects all unpushed epics (no `remote.key`) + drifted epics (hash mismatch)
2. Pushes epics first, in EPIC-NNN order — so parent keys are available for story linking
3. Then pushes all unpushed/drifted stories, resolving parent key from the just-pushed epics
4. Progress shown via `withProgress` with a running counter: *"Pushing… 3 / 14"*
5. Summary notification on completion: *"Pushed 3 epics, 11 stories to Jira. 0 failed."*
6. If any item fails, the others continue; failures are listed in the Saga Output Channel

Surface: **"↑ Push All"** button in the Epics & Stories sidebar toolbar (`view/title` menu, `saga.storiesView`).

### 8.5 Delete & cleanup (F25)

Four levels of deletion, from most targeted to most destructive:

| Operation | Trigger | Scope | Confirmation |
|---|---|---|---|
| **Delete Story** | Right-click → Delete Story | Single `.saga/stories/STORY-NNN.yaml` | Modal confirm; tracker-aware if pushed (F15d) |
| **Delete Epic** | Right-click → Delete Epic | Single `.saga/epics/EPIC-NNN.yaml`; offers to delete child stories | Modal confirm × 2 if stories exist; tracker-aware if pushed (F15d) |
| **Clear Stories for Epic** | Right-click on epic → Clear Stories | All stories whose `epic:` field matches the selected epic | Modal confirm naming the epic |
| **Clear All Epics** | Command Palette `Saga: Clear Epics` | All files in `.saga/epics/` and all files in `.saga/stories/` | Modal confirm |
| **Clean Up** | Command Palette `Saga: Clean Up` | Everything in `.saga/epics/`, `.saga/stories/`, `.saga/prompts/`, `.saga/context/` | Modal confirm + type `"delete all"` |

**Rules that never change:**
- `.saga/config.yaml`, `.saga/templates/`, and `.saga/.sync/` are never touched by any cleanup operation.
- All deletions send files to the OS trash (recoverable) rather than permanent delete.
- The sidebar tree refreshes automatically after any deletion.

### 8.4 Two-way sync (F11) — the hard part
Because `.saga/` is the source of truth, but the tracker can also change:

- **Change detection:** each story keeps `local_hash` (hash of canonical fields) and `remote.last_synced_hash`. On sync, Saga compares: local hash vs. last-synced (did we change?) and live remote vs. last-synced (did they change?).
- **Four states per story:**
  - *In sync* — no action.
  - *Local-only change* — push to tracker.
  - *Remote-only change* — pull into `.saga/`.
  - *Both changed (conflict)* — show a 3-way diff (base = last-synced, local, remote). User resolves field-by-field; `.saga/` wins by default but never silently.
- **Mapping store:** `.saga/.sync/mappings.json` maps local IDs ↔ remote keys/URLs and stores last-synced snapshots.
- **Field mapping layer:** a per-provider map translates Saga's canonical model to Jira fields / ADO work-item fields (e.g. acceptance criteria → a custom field or the description block; estimate → story points field).
- **Safety:** sync is explicit (a command / button), previews changes before applying, and is idempotent. No background auto-push in v1.

### 8.5 Agent prompt generation (F12)

Right-click a story in the tree → **Saga: Generate Agent Prompt**.

**Flow:**
1. `WorkspaceScanner` scores workspace files by heuristic relevance to the story (filename/path overlap with story title + labels). Top-20 candidates (score > 0.1) are shown in a **QuickPick multi-select** so the user can deselect irrelevant files before the LLM call. No embeddings in v1.
2. Generation runs via `resolveProviderFromConfig('agent_prompt', root)` with `AbortSignal` support. Token usage logged to Saga Output Channel.
3. Output opens in the **Agent Prompt Webview** (`data-panel="agent-prompt"`) — single-instance panel showing:
   - **Target preset tabs**: Claude Code / Copilot / Gemini CLI / Generic. Switching preset re-formats the same underlying story content without a new LLM call.
   - **Markdown preview** of the generated prompt.
   - **Token count** in the panel header.
   - **Copy to Clipboard** button (always available).
   - **Save** button — writes to `.saga/prompts/STORY-NNN.prompt.md` via `writePrompt()` in `saga-repo.ts`.
   - **Regenerate** button — re-runs generation with the same file selection.

**Output format** (assembled by `AGENT_PROMPT_TEMPLATE` Handlebars template):
```markdown
# Task: <story title>

## Story
As a <as_a>, I want <i_want>, so that <so_that>.

## Acceptance Criteria
<Gherkin scenarios verbatim>

## Relevant files
<list of selected workspace files with relative paths>

## Coding standards
<extracted text from standards context files>

## Notes for <preset>
<preset-specific framing: file-reference style, tool expectations, etc.>
```

Saved to `.saga/prompts/STORY-NNN.prompt.md` — git-tracked alongside the story.

### 8.6 AGENTS.md generation (F13)

Command **Saga: Generate AGENTS.md** (Command Palette + Epics & Stories view toolbar button).

**Flow:**
1. `WorkspaceScanner` collects workspace info: detected stack (from `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`), top-2-level directory layout (filtered — no `node_modules`/`.git`/`dist`), scripts/build commands from manifest, and any existing `AGENTS.md` content.
2. Coding-standards context files are loaded from the context registry.
3. Generation runs via `resolveProviderFromConfig('agents_md', root)` with `AbortSignal` support.
4. **Diff guard:** if `AGENTS.md` already exists in the workspace root, its current SHA-256 is compared against `.saga/AGENTS.md.lock`. If they differ (hand-edited since last generation), a warning is shown before overwriting.
5. Output opens in the **AGENTS.md Webview** (`data-panel="agents-md"`) — single-instance panel showing:
   - **Generated content** — full rendered markdown of the proposed `AGENTS.md`.
   - **Diff comparison** — side-by-side view of existing vs. proposed content (if an existing `AGENTS.md` is present).
   - **Accept** — writes the file to the workspace root and updates `.saga/AGENTS.md.lock`.
   - **Regenerate** — re-runs generation with the same context.
   - **Discard** — closes without writing.

**Output format** (assembled by `AGENTS_MD_TEMPLATE` Handlebars template):
```markdown
# AGENTS.md

## Project overview
<summary from context + detected stack>

## Structure
<top-2-level directory tree>

## Build, test, and run
<scripts extracted from manifest>

## Conventions
<from coding-standards context files>

## Do / don't
<inferred from standards + stack>
```

Written to `AGENTS.md` at the workspace root (not inside `.saga/`). The lock file at `.saga/AGENTS.md.lock` stores the SHA-256 so Saga can detect subsequent hand-edits before the next generation run.

### 8.7 Subtasks on stories (F28)

Every story can carry an ordered list of **subtasks** — small, typed work items that break the story into developer-sized chunks without creating separate Saga stories.

**Schema addition to `StorySchema`:**
```yaml
subtasks:
  - id: SUB-001
    title: Write migration for users table
    type: technical          # technical | test | design | documentation | other
    done: false
  - id: SUB-002
    title: "Scenario: User can log in after migration"
    type: test
    done: false
```

**UX:**
- Story editor Webview gains a **Subtasks** tab alongside Form / YAML tabs — a checklist with `+` to add and `✕` to remove items.
- The Generation Review Webview can optionally generate subtasks inline when the user checks **"Generate subtasks"** before saving a story.
- `saga.generateSubtasks` command (right-click on story) — calls the LLM to propose typed subtasks based on story AC and description; opens them in the story editor for review.
- Subtasks are shown as child nodes in the Epics & Stories tree (collapsible; checkbox state shown in icon).

**Agent prompt integration (F29 prerequisite):**
- `generateAgentPrompt` includes all subtasks as a `## Subtasks` section so the coding agent has a ready-to-tick checklist.

**Tracker push:**
- Jira: subtasks pushed as Jira sub-tasks linked to the parent story issue via the `parent` field.
- ADO: subtasks pushed as ADO Tasks linked via `System.LinkTypes.Hierarchy-Reverse` (child of story work item).
- Subtask `done` state synced with tracker `Closed`/`Done` status on pull.

### 8.8 Codebase context in agent prompts (F29)

When `saga.generateAgentPrompt` runs, `WorkspaceScanner` now **reads file content snippets** for the top-scored files (score > 0.1, capped at 20):

- For each included file, up to **150 lines** of content are included in the prompt under `## Relevant files` as fenced code blocks (with relative path as caption).
- The QuickPick multi-select shows each candidate file with its heuristic score (e.g. `auth.ts  ·  relevance 0.82`) so the user can deselect irrelevant files.
- Files already in the context registry (product brief, design, standards) are excluded from the codebase scan to avoid duplication.
- Total prompt token count is estimated and shown in the QuickPick footer before the LLM call fires: *"Estimated prompt: ~4,200 tokens · 12 files selected"*.

**Content filtering:**
- Binary files (images, compiled assets) skipped.
- Files > 500 lines: include only the first 150 lines with a `... (truncated)` note.
- Lock files (`package-lock.json`, `Cargo.lock`, `poetry.lock`) excluded unconditionally.

### 8.9 Clickable context files (F30)

Context files listed in the **Context Files tree** become navigable:

- Clicking a **file context entry** (`.md`, `.txt`, `.pdf`, `.docx`, source file) opens it in the VS Code editor using `vscode.workspace.openTextDocument` + `vscode.window.showTextDocument`.
- Clicking an **inline context entry** (stored as `.saga/context/inline-NNN.md`) opens that file in the editor so the user can update it in place. After saving, Saga detects the change via the existing file watcher and the context registry updates automatically.
- The `ContextTreeItem` gains `command: { command: 'saga.openContextFile', arguments: [path] }` — a lightweight new command that resolves the path from the context entry and opens it.

### 8.10 OpenRouter provider adapter (F31)

**`OpenRouterProvider`** (`src/llm/openrouter.ts`) — new BYOK adapter using the OpenRouter REST API:

- Base URL: `https://openrouter.ai/api/v1` (OpenAI-compatible).
- Auth: `Authorization: Bearer <key>` from SecretStorage; `HTTP-Referer` header set to `vscode-saga` per OpenRouter's attribution policy.
- Live model list from `GET /models` — returns model IDs with pricing metadata (`pricing.prompt`, `pricing.completion` per token). Model picker in Settings Webview shows price per 1M tokens alongside each model ID.
- Exact token counts from the `usage` field in the chat completions response.
- `AbortSignal` support via the underlying `fetch` call (same pattern as `LocalLmProvider`).

**Settings Webview:**
- OpenRouter appears as a fifth BYOK provider in the AI Provider section.
- **Add Key / Update Key** button stores the key in SecretStorage under the `openrouter` namespace.
- **Test** button calls `GET /models` to verify the key is valid.
- Model picker populates from the live `/models` response; each option shows `<model-id>  ·  $X.XX/1M in  ·  $X.XX/1M out`.

**`buildProvider()` in `src/llm/routing.ts`:** adds `openrouter` case, same key-getter pattern as the other BYOK adapters.

**Config schema addition:**
```yaml
ai:
  providers:
    openrouter:
      enabled: false    # BYOK; key in SecretStorage
```

### 8.11 Template editor (F16)

**`saga.openTemplate`** command — lets users view and edit the Handlebars generation templates that control how prompts and outputs are formatted.

**Flow:**
1. Command Palette → `Saga: Open Template` → QuickPick lists available templates:
   - `epic-generation.hbs` — system prompt for epic generation
   - `story-generation.hbs` — system prompt for story generation
   - `story-refine.hbs` — refinement follow-up prompt
   - `agent-prompt.hbs` — agent prompt output template
   - `agents-md.hbs` — AGENTS.md generation prompt
2. Selecting a template opens it in the VS Code editor.
   - If a user override exists in `.saga/templates/`, that file is opened.
   - If not, the bundled default is **copied** to `.saga/templates/<name>.hbs` first, then opened — so the user is always editing a `.saga/`-tracked copy.
3. On the next generation run, Saga checks `.saga/templates/` for an override and uses it if present; otherwise falls back to the bundled default (same logic as the current `loadTemplate()` in `prompts.ts`).

**Reset to default:** right-click a template file in the Explorer → `Saga: Reset Template to Default` command deletes the user override from `.saga/templates/` (after modal confirm), restoring the bundled behaviour.

**No live-preview in v1** — the Handlebars context is complex and a preview panel is P2. The user edits the template, runs generation, and sees the result in the normal Generation Review Webview.

### 8.12 Export backlog (F32)

**`saga.exportBacklog`** command — exports the full backlog (all epics, stories, subtasks) in a chosen format.

**Flow:**
1. Command Palette → `Saga: Export Backlog` → QuickPick: **Markdown / PDF / Word (.docx) / Excel (.xlsx)**
2. VS Code Save dialog to pick destination file.
3. Progress notification while writing.
4. On success: "Open File" action in the notification.

**Format details:**

| Format | Hierarchy | INVEST badges | Notes |
|---|---|---|---|
| **Markdown** | `# Epic` → `## Story` → `### Subtask` | ✓ as emoji badge row | Single `.md` file; includes all YAML fields in a readable layout; Gherkin in fenced blocks |
| **PDF** | Same hierarchy as Markdown | ✓ coloured badge row | Generated from the Markdown via `markdown-pdf` or a lightweight HTML→PDF renderer; no heavy LaTeX dependency |
| **Word (.docx)** | Heading styles: Epic = Heading 1, Story = Heading 2, Subtask = Heading 3 | ✓ as inline text badges | Built with `docx` npm package; table of contents bookmark per epic |
| **Excel (.xlsx)** | Flat table: one row per story, sub-rows for subtasks | ✓ as cell values | Columns: `Epic ID`, `Epic Title`, `Story ID`, `Story Title`, `As a / I want / So that`, `Estimate`, `Labels`, `Status`, `Acceptance Criteria`, `Subtasks count`; built with `exceljs` |

**Constraints:**
- Export is read-only — it never modifies `.saga/` files.
- Export includes only the epics/stories/subtasks present locally in `.saga/`; it does not trigger a sync before exporting.
- PDF and Word exports depend on packages bundled with the extension; no external runtime dependencies.

---

## 9. AI provider layer, auth & cost strategy

This is the most misunderstood part of the project, so it gets its own detailed treatment. Saga abstracts over a single `LLMProvider` interface (`generate`, `stream`, `countTokens`, `listModels`) and ships **three sanctioned provider classes** plus an explicit decision **not** to use a fourth.

### 9.1 The four ways to reach Claude/Gemini — and which Saga uses

| Class | Examples | How it works | Cost to user | Saga uses it? |
|---|---|---|---|---|
| **A. VS Code LM API** | Copilot (exposes Claude, GPT, Gemini families) | `vscode.lm.selectChatModels()` + `sendRequest()`; one-time consent dialog, must be triggered by a user action | Covered by their existing Copilot seat (~$10/mo); no per-token cost, no key | **Yes — default** |
| **B. Direct API key (BYOK)** | Anthropic API, Google Gemini API, OpenAI API | Saga calls the provider HTTP API with a key from SecretStorage | Pay-per-token (Gemini has a free Flash tier; Claude does not) | **Yes — fallback** |
| **C. Local OpenAI-compatible** | Ollama (`/v1`), LM Studio | Saga calls a local endpoint; no key, fully offline | **Free** | **Yes — offline/$0 path** |
| **D. Consumer-subscription OAuth** | Reusing a Claude Pro/Max or Gemini AI Pro/Ultra login token | OAuth/PKCE login or reading the first-party CLI's stored token, routed to the model | "Free" (drawn from the subscription) | **No — prohibited** |

**Why class D is excluded (important for a Marketplace tool):** subscription OAuth tokens are intended only for the vendor's own first-party client (Claude Code, Gemini CLI). Both vendors have banned third-party reuse and are actively enforcing it — Anthropic blocked it in January 2026, revised its terms in February 2026, and issued a legal request that stripped Anthropic OAuth support from OpenCode; Google banned the equivalent Gemini-CLI-token proxy pattern in February 2026 and began suspending accounts (including paying subscribers) from March 2026. Building on it would risk getting Saga's users banned and the extension delisted. It is off the table.

The honest framing for users: *"Use the AI you already pay for"* = **Copilot via the VS Code LM API**. Everything else is either BYOK (you supply a key and pay per token) or local (free).

### 9.2 Provider precedence & selection
- Default provider = **VS Code LM API** if a Copilot-class model is available and the user consents.
- If not available, Saga prompts the user to either pick a **local** endpoint or add a **BYOK** key (stored in SecretStorage).
- Users can override per-task routing (see 8.4).
- Model IDs are **configurable, never hardcoded** — provider lineups change; `config.yaml` names them and Saga validates against the provider's live `listModels` at runtime, warning on an unknown ID rather than failing silently.

### 9.3 Cost levers (what actually keeps the bill near zero)
For users on the BYOK path, Saga is designed around three levers, in priority order:

1. **Prompt caching — the biggest win.** Saga's context bundle (product brief + technical design + coding standards) is identical across every generation call in a session. Cached input bills at roughly 10% of the standard input rate, so Saga caches the bundle once and pays ~10% on every reuse. This alone turns a multi-story generation run from dollars into cents.
2. **Task-based model routing.** Cheap, fast models handle the high-volume/low-stakes tasks; the stronger tier is reserved for actual story drafting. The tier spread is 5–25x, so this is a large multiplier on cost.
3. **Batch API for bulk, non-interactive runs** (e.g. "generate stories for all 6 epics") — ~50% off, processed asynchronously.

**Token transparency (F26):** Saga logs input/output token counts after every call to the `Saga` Output Channel and surfaces them in the Generation Review panel header. This gives BYOK users a clear view of consumption without requiring a separate dashboard. For VS Code LM (Copilot) users, counts are estimated and cost-free; for BYOK users they map directly to spend at the provider's published rates.

Reference pricing (verify against live provider pages before shipping; lineups move):

| Tier | Example models | ~Cost (input/output per 1M tok) | Saga uses for |
|---|---|---|---|
| **Free / local** | Ollama/LM Studio models; Gemini Flash free tier | $0 | Validation, AGENTS.md scans, drafts when offline |
| **Cheap** | Claude Haiku 4.5 (~$1/$5); Gemini Flash (paid) | low | INVEST validation, splitting, prompt assembly, bulk drafts |
| **Quality** | Claude Sonnet 4.6 (~$3/$15); Gemini Pro (~$2/$12) | mid | Final story drafting, epic decomposition |

Cost intuition: a story-generation call (~8K input of brief+standards, ~1.5K output) on Haiku 4.5 is roughly **1.5 cents**, and far less on cached reuse. A 10-story epic costs pennies. On Copilot (class A) or local (class C), marginal cost is **zero**.

### 9.4 Default model routing (written into `config.yaml`)

```yaml
# .saga/config.yaml — provider & routing block (non-secret; keys live in SecretStorage)
ai:
  default_provider: vscode-lm          # vscode-lm | anthropic | gemini | openai | local
  fallback_order: [vscode-lm, local, gemini, anthropic]

  providers:
    vscode-lm:
      enabled: true                    # uses the user's Copilot seat; no key
    anthropic:
      enabled: false                   # BYOK; key in SecretStorage, never here
      prompt_caching: true
    gemini:
      enabled: false                   # BYOK; has a free Flash tier
    openai:
      enabled: false                   # BYOK; live /models list; key in SecretStorage
    local:
      enabled: false
      base_url: http://localhost:11434/v1   # Ollama default; LM Studio = http://localhost:1234/v1
      api_key_env: ""                        # usually unused for local

  # Per-task routing. Each entry names a specific model ID (string) OR "auto".
  # "auto" falls back to tier-based selection: quality tasks pick the best
  # available model; cheap tasks pick the fastest/cheapest enabled model.
  # Model IDs are validated against the provider's live listModels() at runtime.
  routing:
    epic_generation:    claude-sonnet-4-6     # explicit model ID
    story_generation:   claude-sonnet-4-6
    invest_validation:  claude-haiku-4-5
    story_splitting:    claude-haiku-4-5
    agent_prompt:       auto                  # "auto" = tier-based fallback
    agents_md:          auto

  models:                              # tier → preferred model per provider (override freely)
    quality:
      anthropic: claude-sonnet-4-6
      gemini:    gemini-pro            # confirm exact ID at build time
      vscode-lm: { vendor: copilot, family: claude-sonnet }
    cheap:
      anthropic: claude-haiku-4-5
      gemini:    gemini-flash          # confirm exact ID at build time
      vscode-lm: { vendor: copilot, family: claude-haiku }
      local:     ""                    # whatever the user has pulled, e.g. qwen2.5-coder

  budget:
    confirm_above_usd: 0.50            # warn before any single run is estimated to exceed this
    show_token_preview: true           # F19 — preview tokens/cost before sending
```

### 9.5 Local AI — first-class, not an afterthought

Local models matter here for three reasons that fit your setup directly: **$0 marginal cost**, **fully offline / no egress** (briefs and code never leave the machine), and **privacy for client work** — relevant when the context is sensitive client material rather than something you want sent to a hosted API.

- **Transport:** both Ollama and LM Studio expose **OpenAI-compatible** HTTP endpoints, so a single OpenAI-compatible adapter covers both. Ollama defaults to `http://localhost:11434/v1`; LM Studio to `http://localhost:1234/v1`. No API key in the normal case.
- **Discovery:** Saga calls the endpoint's `/models` (or Ollama's `/api/tags`) to populate the model picker, so users select from whatever they've pulled rather than typing IDs.
- **Capability probing:** local models vary in JSON/structured-output reliability and tool-calling support. Saga probes once, caches the result, and for weaker models falls back to a stricter "return only valid YAML" prompt + Zod parse + auto-retry. Story generation needs reliable structured output, so Saga surfaces a quality hint per local model.
- **Homelab-friendly:** the endpoint is just a URL, so a model served on another box on the network (e.g. an Ollama instance reachable over Tailscale) works by pointing `base_url` at it — no special handling needed.
- **Recommended split:** local is an excellent default for `invest_validation`, `agents_md`, and `story_splitting`; for final `story_generation`/`epic_generation`, a capable local coding model works but a hosted quality-tier model (or Copilot) gives more reliable INVEST/Gherkin structure. The routing table lets users choose per task.

### 9.6 Design notes
- One `LLMProvider` interface; classes A/B/C are adapters. Adding OpenRouter, Bedrock, or Vertex later is just another adapter — no core change.
- All BYOK keys, tracker tokens, and any local auth live in **SecretStorage**, never in `.saga/`.
- Saga always shows what content will be sent to a model before sending (matters most for hosted providers and sensitive client context).
- Token/cost preview (F19) runs before any paid call so users aren't surprised.

---

## 10. Tech stack

| Layer | Choice | Why |
|---|---|---|
| **Extension runtime** | TypeScript, VS Code Extension API | Required; first-class LM API access |
| **Bundler** | esbuild (via `@vscode/vsce` packaging) | Fast, standard for extensions |
| **UI — light** | Native VS Code TreeView, QuickPick, Webview only where needed | Native feels right and is cheap |
| **UI — rich panels** | Webview + React + Vite (story form, 3-way diff, sync review) | Complex interactions need real UI |
| **LLM access** | `vscode.lm` + provider SDKs (Anthropic, Google, OpenAI) + fetch for OpenAI-compatible | Covers all three provider classes |
| **Tracker clients** | Jira Cloud REST v3; Azure DevOps REST (`azure-devops-node-api` or fetch) | Official surfaces |
| **Auth** | Jira: OAuth 2.0 (3LO) or API token; ADO: PAT or Entra OAuth | Standard tracker auth |
| **Secrets** | VS Code `SecretStorage` | Encrypted, per-machine, out of repo |
| **Local data** | YAML files in `.saga/` (`yaml` lib), JSON for sync cache | Human-diffable, git-friendly |
| **Schema/validation** | Zod (parse LLM output + validate file schema) | Defensive parsing of model output |
| **Templating** | Handlebars (story + prompt + AGENTS.md templates) | User-overridable in `templates/` |
| **Doc extraction** | `pdf-parse` / `mammoth` (docx) | Read briefs/designs from common formats |
| **Codebase context** | VS Code symbol APIs + optional local embeddings (e.g. via local model) | Relevant-file gathering for prompts |
| **Gherkin** | `@cucumber/gherkin` (validate generated scenarios) | Ensure AC actually parses |
| **Testing** | `@vscode/test-electron`, Vitest for pure logic | Test deterministic parts (your gRPC bufconn instinct applies here) |
| **CI/Packaging** | GitHub Actions → `vsce package`/`publish` | Marketplace pipeline |

---

## 11. Architecture (high level)

```
┌──────────────────────────────────────────────────────────┐
│                     VS Code Extension Host                 │
│                                                            │
│  Commands / TreeView / Webviews (React panels)             │
│        │                                                   │
│        ▼                                                   │
│  ┌──────────────┐   ┌──────────────┐   ┌───────────────┐  │
│  │ Generation   │   │ Sync Engine  │   │ Prompt /      │  │
│  │ Service      │   │ (3-way diff) │   │ AGENTS.md     │  │
│  └──────┬───────┘   └──────┬───────┘   └──────┬────────┘  │
│         │                  │                  │           │
│  ┌──────▼──────────────────▼──────────────────▼────────┐  │
│  │             Core domain model (Zod schemas)          │  │
│  └──────┬──────────────────┬───────────────────────────┘  │
│         │                  │                               │
│  ┌──────▼───────┐   ┌──────▼───────────┐   ┌────────────┐  │
│  │ LLMProvider  │   │ Tracker Adapter  │   │ .saga FS   │  │
│  │ (3 adapters) │   │ (Jira / ADO)     │   │ repository │  │
│  └──────────────┘   └──────────────────┘   └────────────┘  │
│         │                  │                               │
│   SecretStorage      SecretStorage                         │
└──────────────────────────────────────────────────────────┘
```

Two interfaces carry the extensibility: `LLMProvider` (provider-agnostic AI) and `TrackerAdapter` (provider-agnostic sync). New models and new trackers are new adapters, nothing else changes.

---

## 12. Security & privacy

- All credentials (API keys, Jira tokens, ADO PATs, OAuth tokens) → **SecretStorage**, never `.saga/`.
- `.saga/.sync/` and any cache go in `.gitignore` by default; everything else is meant to be committed.
- Saga always shows what content will be sent to a model before sending (briefs/code can be sensitive).
- Local-provider path (Ollama/LM Studio) for fully offline / no-egress workflows.
- Telemetry: off by default; if added for Marketplace, opt-in and documented.
- Marketplace publishing must follow VS Code's AI extension guidelines and Copilot extensibility policy (relevant because Saga uses the LM API).

---

## 13. Milestones

| Phase | Scope | Outcome |
|---|---|---|
| **M0 — Skeleton** | Extension scaffold, `.saga/` init (F1), config + SecretStorage (F8), `LLMProvider` interface with VS Code LM + one local adapter | Can authenticate a model and run a hello-world generation |
| **M1 — Generate** | Context registration (F2), epic/story generation (F3, F4), INVEST validator (F5), tree view + editor (F6) | End-to-end: docs → reviewed stories in `.saga/`, no tracker yet |
| **M1.5 — Settings UI** | Settings Webview panel (F23): provider selection + connection test, model routing overrides, BYOK key entry via SecretStorage, budget controls | Users can configure everything without editing YAML by hand |
| **M1.6 — Generation UX** | Generation Review Webview (F3, F4, F5): pre-generation instructions input, interactive review panel with inline editing, INVEST validation badges, per-story and bulk refinement via LLM; inline text context (F24); delete epics/stories/cleanup (F25); model routing resolution wired to config.yaml; model label shown in progress + panel | Full human-in-the-loop generation flow with refinement |
| **M1.7 — Generation quality** | Token usage (F26): input/output counts captured after every generation/refinement call; shown in Generation Review panel header and Saga Output Channel; estimated for Copilot (labelled), exact for Local; exact for BYOK once M4.1 adapters are wired. Generation cancellation (F27): `cancellable: true` in progress notification; `AbortSignal` propagated through `GenerationService` → `LLMProvider`; clean "cancelled" notification on abort | Users can see token consumption and stop a generation mid-flight |
| **M2 — Push** | Jira Cloud adapter (F9), ADO adapter (F10), field mapping, one-way push; `TrackerAdapter` interface, hash/sync-store, Settings Webview tracker section, `saga.pushEpic` + `saga.pushStory`, tree synced/drifted badges | Stories appear in the tracker |
| **M2.1 — Push UX** | Epic-first enforcement (F15b): block story push if parent epic not yet pushed. Post-epic push offer (F15c): "Push Stories" action after epic push. Tracker-aware delete (F15d): offer remote delete when deleting a pushed item; graceful fallback if remote delete fails. Bulk push (F15): `saga.pushAll` command + sidebar button — push all unpushed/drifted epics then stories in order, progress per item. `deleteEpic`/`deleteStory` on `TrackerAdapter`. | Push flow is safe, guided, and efficient |
| **M3 — Sync** | Pull + two-way sync + 3-way conflict resolution (F11), status decorations (F14) | True bi-directional sync with `.saga/` as source of truth |
| **M4 — Code loop** | **M4.1** BYOK adapters (F7 complete): `AnthropicProvider`, `GeminiProvider`, `OpenAIByokProvider` wired into routing + Settings UI. **M4.2** Agent prompt generation (F12): `saga.generateAgentPrompt` command, workspace file relevance scorer, Agent Prompt Webview panel (preset picker, Copy + Save). **M4.3** AGENTS.md generation (F13): `saga.generateAgentsMd` command, stack detection, AGENTS.md.lock diff guard, AGENTS.md Webview panel (diff view, Accept/Regenerate/Discard). | Planning ↔ code loop closed; all three provider classes fully wired |
| **M5 — Polish & publish** | **M5.1** Subtasks (F28) + codebase context in prompts (F29) + clickable context files (F30). **M5.2** Template editor (F16) + OpenRouter adapter (F31). **M5.3** Export backlog (F32). **M5.4** Story splitting assistant (F34) + Getting Started Webview (F33) + telemetry opt-in (F35) + first-run checks (F36). **M5.5** UI polish: command title cleanup (F37), Command Palette/UI parity (F38), design tokens (F39). **M5.6** Edit Epic (F40): epic editor Webview, story-impact detection, opt-in regenerate-stories flow. Docs, README, Changelog, Marketplace assets. | Marketplace release |

---

## 14. Open questions / risks

1. **Jira field mapping for Gherkin AC** — store acceptance criteria in the description, a custom field, or linked test cases (Xray/Zephyr)? Needs a decision per workspace; v1 default = description block, configurable.
2. **ADO area/iteration paths** — work items need an area path; Saga must let the user pick a default in `config.yaml`.
3. **Context window limits** — large briefs/designs require summarization; risk of losing detail. Mitigate by chunking + letting users scope what's sent.
4. **LLM output reliability** — models sometimes emit invalid YAML/JSON. Mitigate with strict schema prompting + Zod parse + auto-retry on parse failure.
5. **Sync conflict UX** — 3-way diff is the riskiest UI; budget time here.
6. **Rate limits** — Copilot via the LM API is subject to GitHub's limits, which Saga can't control; surface clear errors and allow provider fallback.
7. **Codebase context relevance** — naive file globbing produces noisy prompts; embeddings improve it but add a dependency. Start heuristic, add embeddings in P2.
8. **Subtask tracker mapping** — Jira sub-tasks require the parent story to be pushed first; ADO Tasks require parent story work item ID. The existing epic-first enforcement pattern (F15b) extends cleanly to subtasks, but the ADO sub-task link type (`System.LinkTypes.Hierarchy-Reverse`) must be verified per workspace configuration.
9. **Export format deps** — `docx` and `exceljs` add ~1–2 MB to the extension bundle. Consider lazy loading via dynamic `import()` on first Export use to keep extension activation time fast.
10. **OpenRouter attribution** — OpenRouter requires a valid `HTTP-Referer` or `X-Title` header for model access accounting. Use `vscode-saga` as the fixed referer value; document this in the Settings Webview.

---

## 15. Success criteria (v1)

- From a product brief, generate a reviewed epic with ≥5 INVEST-passing stories (each with valid Gherkin) in under 5 minutes of human time.
- Push and then bi-directionally sync those stories with Jira Cloud **and** ADO without data loss across a local-edit + remote-edit conflict.
- Generate an agent prompt (with codebase context auto-attached) that a coding agent can act on without the user hand-editing context.
- Run the entire flow on a Copilot subscription with **zero** API keys configured.
- Export a full backlog (epics + stories + subtasks) to Markdown, PDF, Word, and Excel.
- OpenRouter models selectable from the Settings Webview and usable for all generation tasks without restarting the extension.
