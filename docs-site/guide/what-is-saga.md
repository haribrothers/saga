# What is Saga?

Saga is a VS Code extension that turns product briefs and technical designs into INVEST-compliant agile stories — complete with Gherkin acceptance criteria — pushes them to Jira Cloud or Azure DevOps, and keeps both sides in sync. Everything is version-controlled in a `.saga/` folder inside your workspace, right next to your code.

## Why Saga?

Most AI story-generation tools live in the tracker itself, or in a separate SaaS product disconnected from your codebase. Saga instead:

- **Lives where the code lives.** Epics, stories, and subtasks are YAML files in `.saga/`, committed to your repo. They show up in diffs and code review like everything else.
- **Uses the AI provider you already have.** Default to your existing GitHub Copilot subscription via the VS Code Language Model API — no new API key required. Or bring your own key for Anthropic, Gemini, OpenAI, or OpenRouter. Or run a fully local model via Ollama/LM Studio.
- **Stays in sync with your tracker, safely.** Push and pull are both explicit, previewed, and conflict-aware. Nothing auto-pushes in the background.
- **Feeds your coding agents.** Generate a ready-to-paste prompt per story, or a repo-wide `AGENTS.md`, using real relevant-file context from your workspace.

## How it fits together

```
Product brief / tech design
        │
        ▼
   Context files (.saga/context/)
        │
        ▼
  Generate Epics ──▶ Generate Stories ──▶ INVEST validation
        │                                       │
        ▼                                       ▼
   Push to Jira / ADO  ◀──── Two-way sync ────▶  Edit locally
        │
        ▼
  Agent prompts / AGENTS.md for your coding agent
```

## Next steps

- [Getting Started](/guide/getting-started) — install and generate your first epic
- [Core Concepts](/guide/core-concepts) — epics, stories, subtasks, and the `.saga/` folder
