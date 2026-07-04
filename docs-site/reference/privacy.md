# Privacy & Telemetry

## Telemetry is local-only, off by default

Saga's telemetry (`telemetry.enabled` in `config.yaml`, default `false`) **never makes a network call**. When enabled, it logs a small, typed event (`{ command, provider?, storyCount? }`) to the **Saga** Output Channel only — nothing leaves your machine.

This is a deliberate design choice: a checkbox that silently phones home while looking like local-only logging would be worse than having no telemetry at all. If a real backend is ever added, the call sites won't change — only the internal sink would.

## What goes where

| Data | Where it lives |
|---|---|
| Epics, stories, subtasks, generated prompts | `.saga/` in your workspace, committed to git |
| API keys (Anthropic, Gemini, OpenAI, OpenRouter), Jira API token, ADO PAT | VS Code SecretStorage — never written to any file in the repo |
| Tracker sync state (remote keys, hashes) | `.saga/.sync/` — gitignored, local cache only |
| Your product briefs / context files | `.saga/context/`, committed unless you choose otherwise |

## What gets sent to your AI provider

Whatever context and story content is included in a generation prompt is sent to whichever provider you've configured for that task — VS Code's Copilot backend, or the BYOK/local provider you selected. Use the **Local** provider (Ollama/LM Studio) if you need generation to never leave your machine.

## What gets sent to your tracker

Only epic/story/subtask content you explicitly push, and only to the tracker (Jira Cloud or Azure DevOps) you've configured — sync and push are always user-triggered, never automatic.
