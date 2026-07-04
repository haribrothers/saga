# Change Log

All notable changes to the Saga extension are documented here. Saga hasn't cut a versioned Marketplace release yet — the entries below are grouped by development milestone and will be reorganized under version numbers at first release.

## [Unreleased]

### UI polish
- Removed the redundant "Saga: " prefix from all command titles.
- Added a "More Actions" toolbar menu for less-frequent commands (Getting Started, templates, clear/clean-up).
- Consistent spacing and visual grouping across all settings and review panels.

### Code loop
- Edit an epic's title, description, or labels at any time from the sidebar tree. If the change could affect existing stories, Saga offers to regenerate them — either alongside the existing ones or as a full replacement.
- Story splitting: split an oversized story into 2–3 smaller replacements, reviewed before saving.
- Getting Started onboarding panel, opened after Init.
- Anonymous local usage logging, off by default, no network calls.
- Export your backlog to Markdown, Word, or Excel.
- Customizable generation templates, editable per-workspace.
- OpenRouter added as an AI provider.
- Subtasks on stories, with checklist tracking and tracker sync.
- Codebase context (relevant file contents) included in generated agent prompts.
- Context files in the sidebar are now clickable, opening directly in the editor.
- BYOK provider support for Anthropic, Google Gemini, and OpenAI.
- Generate a ready-to-paste agent prompt for any story, with relevant files and stack detection.
- Generate and maintain a project `AGENTS.md`.

### Two-way sync
- Sync Review panel: fetch remote state, classify every pushed item, and resolve conflicts field-by-field.
- Status badges in the sidebar tree show sync state (synced / drifted / conflict) at a glance.
- Bulk push for all epics and stories in one action.
- Tracker-aware delete: removing a pushed item offers to delete it from Jira/ADO too.
- Push epics and stories to Jira Cloud or Azure DevOps.

### Generation
- Interactive review panel for AI-generated epics and stories: inline edit, INVEST badges, refine, regenerate.
- Settings panel for AI provider selection, per-task model routing, and budget controls.
- Token usage shown after every generation run.
- Cancel any in-progress generation.

### Foundation
- `saga init` scaffolds a version-controlled `.saga/` folder in your workspace.
- Generate epics and INVEST-compliant stories with Gherkin acceptance criteria from context files.
- Story editor with form and YAML views.
- AI provider abstraction: GitHub Copilot (VS Code Language Model API) by default, local OpenAI-compatible models as a fallback.
