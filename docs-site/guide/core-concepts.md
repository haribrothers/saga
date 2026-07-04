# Core Concepts

## Epics, Stories, and Subtasks

- **Epic** — a large body of work, with a title, description, labels, and status. Stored at `.saga/epics/EPIC-NNN.yaml`.
- **Story** — an INVEST-compliant user story ("As a ... I want ... So that ..."), with Gherkin acceptance criteria, story points, and labels. Belongs to a parent epic. Stored at `.saga/stories/STORY-NNN.yaml`.
- **Subtask** — a small checklist item (task, test, or chore) under a story. Embedded as an array field on the story YAML, not a separate file. IDs (`SUB-NNN`) are scoped per-story, not global.

## The `.saga/` folder

```
.saga/
├── config.yaml           # provider routing, model IDs, tracker defaults (no secrets)
├── context/              # registered files + inline-NNN.md + context-registry.yaml
├── epics/                # EPIC-NNN.yaml
├── stories/               # STORY-NNN.yaml (subtasks embedded)
├── prompts/               # generated agent prompts: STORY-NNN.prompt.md
├── templates/             # your overrides of the 5 generation Handlebars templates
├── AGENTS.md.lock         # hash of last-generated AGENTS.md, detects hand-edits
└── .sync/                 # gitignored — remote-ID mappings and last-synced hashes
    ├── mappings.json
    └── conflicts.json
```

Everything except `.sync/` is meant to be committed. Secrets (API keys, tracker tokens) are **never** written here — they live in VS Code's SecretStorage.

## INVEST validation

Every generated story is scored against the six INVEST criteria — **I**ndependent, **N**egotiable, **V**aluable, **E**stimable, **S**mall, **T**estable — using a mix of heuristics and LLM-assisted judgment. Badges appear per-story in the review panel and the sidebar tree; run **Validate All** to re-check stories after manual edits.

If a story fails "Small", use **Split Story** to break it into 2–3 smaller stories covering the same acceptance criteria.

## Sync state

Once an epic or story is pushed to a tracker, Saga tracks:

- `remote.key` / `remote.url` — the tracker's issue ID and link
- `local_hash` — a hash of the local content
- `remote.last_synced_hash` — a hash of the tracker content as of the last sync

The sidebar shows `[synced ✓]`, `[drifted ●]`, or `[conflict ⚠]` based on comparing these. See [Two-Way Sync & Conflicts](/trackers/sync).

## Generation templates

The prompts Saga sends to your AI provider for epic generation, story generation, refining, agent-prompt generation, and AGENTS.md generation are all Handlebars templates. You can override any of them per-workspace — see [Templates](/guide/templates).
