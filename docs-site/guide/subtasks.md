# Subtasks

Subtasks are small checklist items under a story — tasks, tests, or chores. They're embedded directly on the story's YAML (`subtasks: []`), not stored as separate files, and their IDs (`SUB-NNN`) are only unique within their parent story.

## Generating subtasks

Right-click a story → **Generate Subtasks**, or use the **Subtasks** tab in the Story Editor. Saga proposes a set of subtasks via your configured `subtask_generation` provider; you review and save, and IDs are allocated automatically.

## Editing subtasks

In the Story Editor's Subtasks tab you can toggle done/not-done, edit title and type inline, add or remove items, or regenerate the whole list.

Subtasks also appear as collapsible child nodes under their story in the sidebar tree, with a done-count badge on the story itself.

## Pushing subtasks to a tracker

Subtask push is **separate and explicit** — it is never part of bulk push flows. After you push a story (or bulk-push an epic's stories), Saga offers a **"Push N Subtasks"** action if the story has unpushed subtasks and already has a remote key.

- **Jira** creates a `Sub-task`-type issue (configurable) linked to the parent
- **Azure DevOps** creates a `Task` work item linked via the hierarchy relation, and sets its state from `done`

## Syncing subtasks

Subtasks participate fully in [two-way sync](/trackers/sync) — fetched, hashed, and classified alongside their parent story. A conflict on a subtask marks the parent story `[conflict ⚠]` in the tree (subtasks don't have their own tree-level badge).
