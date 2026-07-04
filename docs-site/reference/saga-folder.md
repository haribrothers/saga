# .saga/ Folder Layout

```
.saga/
├── config.yaml            # non-secret: provider routing, model IDs, tracker defaults
├── context/                # registered files + inline-NNN.md + context-registry.yaml
├── epics/                  # EPIC-NNN.yaml
├── stories/                # STORY-NNN.yaml (subtasks embedded as an array field)
├── prompts/                # generated agent prompts: STORY-NNN.prompt.md
├── templates/               # user-overridable Handlebars templates
│   ├── epic-generation.hbs
│   ├── story-generation.hbs
│   ├── story-refine.hbs
│   ├── story-split.hbs
│   ├── agent-prompt.hbs
│   └── agents-md.hbs
├── AGENTS.md.lock          # SHA-256 of last generated AGENTS.md — detects hand-edits
└── .sync/                  # gitignored: remote-ID mappings and last-synced snapshots
    ├── mappings.json           # sagaId → { jira|ado: { key, url, last_synced_hash, last_synced_at } }
    └── conflicts.json          # transient: [ "STORY-003", "EPIC-001", ... ] — cleared after sync apply
```

## What's committed vs. gitignored

Everything under `.saga/` is meant to be committed **except** `.saga/.sync/` — that folder is added to `.gitignore` automatically on `Init`, since it's a local cache of tracker state (remote keys, sync hashes) rather than source of truth.

## Why YAML files, not a database

Epics and stories are individual YAML files so they:

- Show up in `git diff` and code review like any other change
- Merge (or conflict) using ordinary git tooling — no custom merge driver needed
- Can be hand-edited if needed, then re-validated with **Validate Stories**

## AGENTS.md, separately

`AGENTS.md` itself lives at the **workspace root**, not inside `.saga/` — it's meant to be read by coding agents operating on the repo generally, not treated as Saga-internal state. Only its lock hash (`.saga/AGENTS.md.lock`) lives in `.saga/`.
