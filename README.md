# Saga

**AI-assisted agile planning for VS Code — turn briefs and designs into INVEST-compliant stories, push them to Jira or Azure DevOps, and hand a coding agent everything it needs to build.**

Saga sits where your code already lives. It reads the documents you already have (product briefs, technical designs, coding standards) and generates epics and Gherkin-backed user stories, keeps them version-controlled in a `.saga/` folder inside your workspace, syncs both ways with Jira Cloud or Azure DevOps, and closes the loop back to engineering by generating ready-to-paste prompts (and a project `AGENTS.md`) for Claude Code, Copilot, or any coding agent.

> _Screenshots and a walkthrough GIF are coming soon._

---

## Why Saga

- **Plans live next to code.** Everything Saga generates is YAML in `.saga/`, so it's diffable, reviewable in PRs, and never trapped in a tracker UI.
- **INVEST is enforced, not hoped for.** Every story is checked against Independent, Negotiable, Valuable, Estimable, Small, and Testable — with Gherkin acceptance criteria, not vague bullet points.
- **Bring the AI you already pay for.** Default to GitHub Copilot via the VS Code Language Model API, or use your own key for Anthropic, Gemini, OpenAI, OpenRouter, or a local model (Ollama / LM Studio) — no extra AI subscription required.
- **Two-way tracker sync with real conflict resolution.** Push to Jira Cloud or Azure DevOps, pull remote edits back, and resolve conflicts field-by-field in a dedicated review panel — never a silent overwrite.
- **The loop closes back to code.** Generate a self-contained agent prompt for any story (with relevant file contents attached), or keep a root `AGENTS.md` up to date automatically.

## Getting started

1. Install the extension and open a workspace folder.
2. Run **Init** from the Command Palette (search "Saga") — or click **Initialize Saga** in the empty sidebar view. This scaffolds a `.saga/` folder.
3. Saga opens a **Getting Started** panel: pick an AI provider, add a context file (a brief or design doc), and generate your first epic. Skip any step and come back later — every step is also available from the sidebar toolbar's "More Actions" menu.
4. Review and edit generated epics/stories in the Generation Review panel, then save.
5. (Optional) Connect Jira Cloud or Azure DevOps in Settings and push your backlog.

## What Saga does

### Generate epics and stories
Select context files (product briefs, technical designs, standards docs), and Saga generates epics, then INVEST-compliant stories per epic — each with an `As a / I want / So that` statement, Gherkin acceptance criteria (happy path + edge case), and a story-point estimate. Review, edit, re-validate, or ask for a refinement pass before saving.

Click any epic in the tree any time afterward to edit its title, description, or labels. If the change could affect existing stories, Saga offers to regenerate them — adding new stories alongside the existing ones, or replacing them outright once you confirm.

### Subtasks and story splitting
Break a story into a checklist of typed subtasks (task / test / chore), or split an oversized story (one that fails the INVEST "Small" check) into 2–3 smaller replacements — both AI-proposed, both reviewed before anything is saved.

### Two-way tracker sync
Push epics and stories to **Jira Cloud** or **Azure DevOps**. Saga tracks a content hash per item, so syncing fetches remote state, classifies every pushed item as in-sync / local-only / remote-only / conflicting, and lets you resolve each conflict field-by-field — push, pull, keep local, or take remote — in one review panel. Subtasks sync the same way, including Jira sub-tasks and ADO child tasks.

### Agent prompts and AGENTS.md
Generate a self-contained implementation prompt for any story — technology stack, directory layout, relevant file contents (picked by heuristic relevance, with a token estimate before you commit), and the story's acceptance criteria and subtasks — ready to hand to Claude Code, Copilot, Cursor, or any coding agent. Generate and maintain a root `AGENTS.md` the same way, with hand-edit detection so regeneration never silently clobbers your changes.

### Export your backlog
Export the full epic → story → subtask hierarchy to Markdown, Word (`.docx`), or Excel (`.xlsx`) in one command.

### Customizable generation templates
Every generation prompt (epic generation, story generation, story splitting, agent prompt, AGENTS.md) is a Handlebars template you can open and edit directly from the Command Palette — your edits live in `.saga/templates/` and are picked up on the next run, with a one-click reset back to the default.

## AI providers

| Provider | Setup |
|---|---|
| **GitHub Copilot** (default) | Uses your existing Copilot subscription via the VS Code Language Model API — no key needed. |
| **Anthropic** | Bring your own API key. |
| **Google Gemini** | Bring your own API key. |
| **OpenAI** | Bring your own API key. |
| **OpenRouter** | Bring your own API key — access hundreds of models through one API, with live pricing shown in the model picker. |
| **Local** (Ollama / LM Studio) | Point at any OpenAI-compatible local endpoint — fully offline. |

Configure per-task model routing (which provider/model handles epic generation vs. story generation vs. agent prompts, etc.) in **Open Settings**. All API keys are stored in VS Code's SecretStorage — never written to disk or committed to your repo.

## Tracker integration

Saga supports **Jira Cloud** and **Azure DevOps**. Configure your project, issue-type names, and credentials in Settings, then push epics and stories individually, in bulk, or sync everything with conflict review. Deleting a pushed item offers to delete it from the tracker too (with a safe fallback if the remote delete fails).

## The `.saga/` folder

Everything Saga generates is plain YAML, version-controlled alongside your code:

```
.saga/
├── config.yaml       # provider routing, tracker config (no secrets)
├── context/          # registered context files
├── epics/            # EPIC-NNN.yaml
├── stories/          # STORY-NNN.yaml (subtasks embedded)
├── prompts/           # generated agent prompts
├── templates/         # your customized generation templates
├── AGENTS.md.lock     # hand-edit detection for AGENTS.md
└── .sync/             # gitignored: tracker mappings, sync state
```

## Privacy

Saga sends context you explicitly register (files or typed notes) to your chosen AI provider when generating content — nothing else, and nothing happens without you triggering a generation command. Anonymous local usage logging (command name, provider type, story count — never your content) is available, **off by default**, and when enabled logs to the Saga Output Channel only. There is no telemetry network call and no external analytics service.

## Requirements

- VS Code 1.125 or later.
- A workspace folder open (Saga is workspace-scoped).
- One AI provider configured — Copilot (via the built-in VS Code LM API) works out of the box if you have a Copilot subscription; everything else requires your own API key.

## Feedback

Found a bug or have a feature request? Please open an issue on the repository.
