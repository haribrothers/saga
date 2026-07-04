# Two-Way Sync & Conflicts

## Running a sync

Run **Sync** (Command Palette, or the `$(sync)` sidebar toolbar button). Saga fetches every pushed epic, story, and subtask from your tracker in parallel, and classifies each as:

- **in-sync** — local and remote match
- **local-only** — you've edited locally, tracker unchanged
- **remote-only** — the tracker changed, you haven't touched it locally
- **conflict** — both sides changed since the last sync

Classification is a 3-way comparison: local content hash vs. the hash stored at last sync vs. a fresh hash of the current remote content. Fetch failures are handled per-item and don't abort the whole plan.

## Reviewing the plan

The **Sync Review** panel groups items into local-only / remote-only / conflicts / in-sync sections. Conflict cards show a field-by-field diff table with a resolution picker per field: **Keep Local**, **Take Remote**, or **Skip**.

Nothing is written until you click **Apply** — sync is always previewed first.

## Conflict badges in the sidebar

Items with unresolved conflicts show `[conflict ⚠]` with an orange warning icon in the Epics & Stories tree, refreshed automatically via a file watcher on `.saga/.sync/conflicts.json` — no polling.

## Why this is safe

- Sync is always explicit — nothing runs in the background
- Every apply is idempotent — running sync again immediately after should show everything in-sync
- Pulling a remote value re-parses it through the same Zod schema as local writes, so a pulled story is never malformed
- The stored "last synced" hash always matches what the *next* fetch will independently recompute — so false drift doesn't perpetuate across syncs

## Common gotcha: nothing seems to sync after a big edit

If an item was pushed a long time ago (before certain hash-scheme fixes), the very first sync after upgrading may show it as a **conflict** rather than in-sync, even with no real changes — this is expected and self-heals. The conflict's default resolution is **Keep Local** (push wins), which re-baselines the item; every sync after that is accurate.
