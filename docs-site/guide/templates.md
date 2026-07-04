# Templates

Saga builds its LLM prompts from Handlebars templates. Five of them are user-overridable:

- `epic-generation.hbs`
- `story-generation.hbs`
- `story-refine.hbs`
- `agent-prompt.hbs`
- `agents-md.hbs`

(A sixth, `story-split.hbs`, backs **Split Story** and is override-able the same way.)

## Editing a template

Run **Open Template** from the Command Palette (or via **More Actions** `$(ellipsis)` in the sidebar toolbar), pick a template from the list. If you haven't customized it before, Saga copies the bundled default into `.saga/templates/<name>.hbs` and opens it for editing.

Edits are picked up on the **next** generation run — no extension restart needed.

## Resetting a template

Run **Reset Template**, pick from the list of templates you've overridden, and confirm. This deletes your override (moved to OS trash, recoverable) and reverts to the bundled default.

## Resolution order

1. `.saga/templates/<name>.hbs` if it exists
2. The bundled default shipped with the extension

If you have no workspace open, the bundled default is always used.
