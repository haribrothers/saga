# Generating Epics & Stories

## Generating epics

Run **Generate Epics** from the Command Palette or the Epics & Stories sidebar toolbar. Saga:

1. Loads all registered context files and inline context
2. Optionally prompts for additional free-text instructions
3. Calls your configured AI provider (see [Model Routing](/providers/model-routing) for which model handles `epic_generation`)
4. Opens the **Generation Review** panel with the proposed epics

The progress notification is cancellable at any point.

## Reviewing and saving

In the Generation Review panel you can:

- Edit any field inline (title, description, labels)
- Run **Validate All** (stories only) to check INVEST criteria
- **Refine** an individual item or **Refine All** with a follow-up instruction to the LLM
- **Regenerate** to discard and re-run generation
- **Save** to write the reviewed items to `.saga/epics/` or `.saga/stories/`, or **Discard**

Nothing is written to disk until you explicitly save.

## Generating stories for an epic

Right-click an epic → **Generate Stories for Epic**. Sibling epics are included in the prompt context so the AI avoids scope bleed between epics. Stories open in the same review flow, INVEST-scored per story.

## Editing an existing epic

Click an epic in the sidebar to open the **Epic Editor** — edit title, description, and labels. If the title or description changes and the epic already has stories, Saga offers to regenerate them (as new stories alongside the existing ones, or replacing them outright — the originals are only deleted after the replacements are confirmed saved).

## Token usage & cancellation

Every generation call logs token usage (input/output, exact or estimated) to the **Saga** Output Channel and displays it in the review panel header. All generation is cancellable via the progress notification's built-in cancel button.
