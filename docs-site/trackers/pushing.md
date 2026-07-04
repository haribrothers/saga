# Pushing Epics & Stories

## Push order: epic first

Stories can't be pushed until their parent epic has been pushed — **Push Story** blocks with a modal offering a **Push Epic** shortcut if you try otherwise. This prevents orphaned stories appearing in your tracker.

## Pushing a single epic or story

Right-click in the sidebar → **Push Epic** / **Push Story**. Saga creates the issue/work item if it has no remote key yet, or updates it if it does — either way, the `remote:` block and `local_hash` are written back into the story/epic's YAML afterward.

After a successful epic push, if the epic has unpushed stories, you'll be offered **"Push N Stories"** to push them all in sequence with the parent link already set.

## Bulk push

Run **Push All** (or the `↑ Push All` toolbar button) to push every unpushed or drifted epic first, then every unpushed/drifted story (resolving parent keys from freshly pushed epics). Failures are logged per-item to the Output Channel and don't abort the batch — you'll get a summary at the end.

## Subtasks are never bulk-pushed

Subtask push is always a separate, explicit action — offered as **"Push N Subtasks"** after a story push or an epic's "Push N Stories" flow completes, and only once the parent story has a remote key. `Push All` intentionally never touches subtasks.

## Deleting pushed items

Deleting an epic or story that has a `remote.key` shows a 3-option modal: delete from tracker & locally, delete locally only, or cancel. If the remote delete fails, you're offered "Delete locally anyway?" — a tracker failure never hard-blocks a local delete.
