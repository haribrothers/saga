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
├── prompts/                 # generated agent prompts (optional, git-tracked)
│   └── STORY-001.prompt.md
├── templates/               # user-overridable generation & prompt templates
│   ├── story.hbs
│   └── agent-prompt.hbs
├── .sync/                   # sync state: remote IDs, hashes, last-synced snapshots
│   └── mappings.json
└── AGENTS.md.lock           # hash/manifest of last generated AGENTS.md
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
| F15 | Bulk operations (generate N stories, bulk push, bulk re-validate) | P1 |
| F16 | Template customization (story format, prompt format) via `templates/` | P1 |
| F17 | Story splitting assistant (acts on INVEST "small" warnings) | P1 |
| F18 | Dependency/links between stories and epics, mapped to tracker links | P1 |
| F19 | Cost/usage estimate before a generation run (token preview) | P2 |
| F20 | Additional trackers (Linear, GitHub Issues, Jira DC) via the same adapter interface | P2 |
| F21 | MCP exposure: run Saga as an MCP server so agents can read/write the backlog | P2 |
| F22 | Diff-aware regeneration (regenerate only changed stories when context updates) | P2 |

### UI surface notes
- Every command is reachable from **both** the Command Palette (`Ctrl/Cmd+Shift+P`) and the Saga sidebar UI. Neither is the exclusive path.
- Heavy interactions (story editing, 3-way diff, sync review) use a **Webview panel** (React) opening in the editor area. The Getting Started / onboarding flow for new users is also a Webview panel.
- Light interactions (provider selection, role tagging, confirmations) use native **QuickPick / Input boxes**.
- The sidebar tree provides **inline toolbar buttons** for power-user access to generate, validate, and sync actions without opening menus.

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

### 7.5 Command Palette commands (full list)

All commands are prefixed `Saga:` and grouped under the `Saga` category.

| Command | Trigger | Notes |
|---|---|---|
| `Saga: Init` | Palette + sidebar empty state button | Creates `.saga/`, opens config.yaml |
| `Saga: Getting Started` | Palette + post-init notification | Opens onboarding Webview |
| `Saga: Add Context File` | Palette + sidebar `+` button + Explorer right-click | F2 |
| `Saga: Generate Epics` | Palette + sidebar toolbar | F3; opens result in Webview for review |
| `Saga: Generate Stories for Epic` | Palette + epic inline button | F4 |
| `Saga: Validate Stories` | Palette + sidebar toolbar | F5; shows results in output panel |
| `Saga: Open Story` | Palette + story click in tree | Opens story editor Webview |
| `Saga: Generate Agent Prompt` | Palette + story right-click | F12 |
| `Saga: Generate AGENTS.md` | Palette + sidebar toolbar | F13 |
| `Saga: Sync` | Palette + sidebar `↻` button | M3+; opens sync review Webview |
| `Saga: Configure Credentials` | Palette + sidebar `⚙` button | Opens SecretStorage input for keys/tokens |
| `Saga: Test Generation` | Palette only (dev/debug) | M0 smoke test; removed pre-publish |

---

## 8. Detailed feature behavior

### 8.1 Context selection (F2)
- Command **Saga: Add Context File** and a right-click action in the Explorer.
- Supports `.md`, `.txt`, `.pdf` (text-extracted), `.docx` (text-extracted), and code files.
- Each context entry stores a path + role tag (`brief`, `design`, `standards`, `reference`) so generation can weight them.
- Large files are chunked/summarized to fit the model's context window; Saga shows what it will send before sending.

### 8.2 Epic & story generation (F3, F4)
- Command **Saga: Generate Epics from Context** → proposes epics; user accepts/edits before they're written to `.saga/epics/`.
- Command **Saga: Generate Stories for Epic** → produces stories constrained by a strict output schema (the model is prompted to return validated YAML/JSON, parsed defensively).
- Every story is generated with:
  - User-story form (As a / I want / So that)
  - Gherkin scenarios (happy path + at least one edge/negative)
  - An INVEST self-assessment
- Nothing is auto-pushed. Generation writes **drafts**; the user reviews in the editor (ideally in a PR).

### 8.3 INVEST validator (F5)
- Runs at generation and on demand (**Saga: Validate Stories**).
- Each criterion returns `pass | warn | fail` with a one-line reason.
- "Small = warn/fail" offers the **split assistant** (F17): proposes 2–3 smaller stories preserving acceptance coverage.

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
- Right-click a story → **Saga: Generate Agent Prompt**.
- Output is a structured Markdown prompt assembled from: the story + acceptance criteria, the relevant coding standards, and codebase context (Saga gathers candidate files via path heuristics + optional embeddings/symbol search, and lets the user trim before finalizing).
- Target presets: **Claude Code**, **Copilot**, **Gemini CLI**, **generic**. The preset shapes the framing (e.g. file references, tool expectations).
- Saved to `.saga/prompts/STORY-XXX.prompt.md` (optional) and/or copied to clipboard.

### 8.6 AGENTS.md generation (F13)
- Command **Saga: Generate AGENTS.md** scans the workspace (package manifests, directory layout, scripts, detected stack) plus registered coding standards, and writes a single root `AGENTS.md`: project overview, structure, build/test/run commands, conventions, and do/don't notes.
- Re-running diffs against `AGENTS.md.lock` and shows changes before overwriting (so hand edits aren't clobbered).

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
      enabled: false
    local:
      enabled: false
      base_url: http://localhost:11434/v1   # Ollama default; LM Studio = http://localhost:1234/v1
      api_key_env: ""                        # usually unused for local

  # Per-task routing. Each entry resolves to (provider, model).
  # "auto" picks the cheapest enabled model that meets the task's quality bar.
  routing:
    epic_generation:    { tier: quality }     # e.g. sonnet-4-6 / gemini-pro / copilot-claude
    story_generation:   { tier: quality }
    invest_validation:  { tier: cheap }       # e.g. haiku-4-5 / gemini-flash / local
    story_splitting:    { tier: cheap }
    agent_prompt:       { tier: cheap }
    agents_md:          { tier: cheap }        # codebase scan — cheap/local is fine

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
| **M2 — Push** | Jira Cloud adapter (F9), ADO adapter (F10), field mapping, one-way push | Stories appear in the tracker |
| **M3 — Sync** | Pull + two-way sync + 3-way conflict resolution (F11), status decorations (F14) | True bi-directional sync with `.saga/` as source of truth |
| **M4 — Code loop** | Agent prompt generation (F12), AGENTS.md (F13), API-key providers (F7 complete) | Planning ↔ code loop closed |
| **M5 — Polish & publish** | Templates (F16), bulk ops (F15), splitting assistant (F17), docs, telemetry opt-in | Marketplace release |

---

## 14. Open questions / risks

1. **Jira field mapping for Gherkin AC** — store acceptance criteria in the description, a custom field, or linked test cases (Xray/Zephyr)? Needs a decision per workspace; v1 default = description block, configurable.
2. **ADO area/iteration paths** — work items need an area path; Saga must let the user pick a default in `config.yaml`.
3. **Context window limits** — large briefs/designs require summarization; risk of losing detail. Mitigate by chunking + letting users scope what's sent.
4. **LLM output reliability** — models sometimes emit invalid YAML/JSON. Mitigate with strict schema prompting + Zod parse + auto-retry on parse failure.
5. **Sync conflict UX** — 3-way diff is the riskiest UI; budget time here.
6. **Rate limits** — Copilot via the LM API is subject to GitHub's limits, which Saga can't control; surface clear errors and allow provider fallback.
7. **Codebase context relevance** — naive file globbing produces noisy prompts; embeddings improve it but add a dependency. Start heuristic, add embeddings in P2.

---

## 15. Success criteria (v1)

- From a product brief, generate a reviewed epic with ≥5 INVEST-passing stories (each with valid Gherkin) in under 5 minutes of human time.
- Push and then bi-directionally sync those stories with Jira Cloud **and** ADO without data loss across a local-edit + remote-edit conflict.
- Generate an agent prompt that a coding agent can act on without the user hand-editing context.
- Run the entire flow on a Copilot subscription with **zero** API keys configured.
