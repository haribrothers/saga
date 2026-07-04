# Agent Prompts & AGENTS.md

Saga can generate prompts tailored for coding agents (Claude Code, Copilot, Cursor, etc.) directly from your stories.

## Per-story agent prompts

Right-click a story → **Generate Agent Prompt**. Saga:

1. Detects your stack (reads `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`)
2. Scores workspace files for relevance to the story (filename/path overlap with the story's title and labels)
3. Shows a checklist of the most relevant files (with an estimated token count) so you can pick which to include as full-content context
4. Generates a Markdown prompt combining the story, stack info, directory layout, and selected file contents

The prompt opens in an editable panel — one tab per story — with **Copy to Clipboard** and **Save** actions. Nothing is written to disk until you explicitly save, to `.saga/prompts/STORY-NNN.prompt.md`.

## AGENTS.md

Run **Generate AGENTS.md** (Command Palette, or the toolbar icon in the Epics & Stories view) to generate a repo-wide `AGENTS.md` — a single file describing your stack, layout, and conventions for any coding agent operating in the repo.

- If `AGENTS.md` already exists, its content is passed to the LLM for continuity, and shown in a diff-style comparison
- A `.saga/AGENTS.md.lock` file stores a hash of the last generated content — if the file was hand-edited since, you're warned before overwriting
- **Accept** writes the file and updates the lock; **Regenerate** re-calls the LLM; **Discard** closes without writing

## Relevance scoring (v1 scope)

File relevance uses simple heuristic string-overlap scoring — no embeddings. Files score 0–1; anything above 0.1 is included, capped at the top 20. `node_modules`, `.git`, `dist`, `build`, `out`, `.saga`, and `.vscode` are always excluded.
