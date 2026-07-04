# Getting Started

## 1. Install

Install **Saga** from the VS Code Marketplace, or load the `.vsix` locally:

```bash
code --install-extension saga-0.0.1.vsix
```

## 2. Initialize your workspace

Open the Command Palette (`Cmd/Ctrl+Shift+P`) and run:

```
Init
```

(shown in the palette under the **Saga** category). This scaffolds a `.saga/` folder in your workspace root and opens the **Getting Started** panel — a live 3-step checklist:

1. **Configure an AI provider**
2. **Add a context file** (a product brief, PRD, or technical design)
3. **Generate your first epic**

Each step's checkmark reflects real state on disk, so you can close the panel and reopen it later (`Getting Started` command) without losing track of progress.

## 3. Configure an AI provider

Open **Settings** (`Open Settings` in the Command Palette) and pick a provider:

- **VS Code Language Model (Copilot)** — no setup beyond having Copilot enabled. This is the default.
- **BYOK** — Anthropic, Gemini, OpenAI, or OpenRouter. Paste your API key; it's stored in VS Code's SecretStorage, never in `.saga/`.
- **Local** — point at an Ollama or LM Studio endpoint.

See [AI Providers](/providers/overview) for details on each.

## 4. Add context

Run `Add Context File` to register a product brief, PRD, or design doc (`.md`, `.txt`, `.pdf`, `.docx`, or code), or `Add Inline Context` to paste free-form text directly.

## 5. Generate your first epic

Run `Generate Epics`. Saga reads your context files, calls your configured AI provider, and opens a review panel where you can edit, validate, and save the generated epics.

From there, right-click an epic in the **Epics & Stories** sidebar and choose **Generate Stories for Epic** to break it down into INVEST-validated stories with Gherkin acceptance criteria.

## 6. Push to your tracker (optional)

If you use Jira Cloud or Azure DevOps, configure it under Settings → Tracker, then right-click an epic or story to push it. See [Trackers](/trackers/overview).

## What's next

- [Core Concepts](/guide/core-concepts) to understand the `.saga/` folder and data model
- [Generating Epics & Stories](/guide/generation) for the full generation workflow
- [AI Providers](/providers/overview) to pick the right model for each task
