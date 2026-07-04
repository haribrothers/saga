# Exporting the Backlog

For stakeholders who don't live in VS Code, run **Export Backlog** (Command Palette, or the `$(export)` icon in the Epics & Stories toolbar).

## Formats

| Format | Structure |
|---|---|
| **Markdown** | Epic (H1) → Story (H2) → Subtask (H3), Gherkin ACs in fenced code blocks |
| **Word (.docx)** | Same hierarchy as Markdown |
| **Excel (.xlsx)** | Flat one-row-per-story sheet — epic hierarchy doesn't suit a spreadsheet; includes `EpicID`, `StoryID`, `SubtaskCount`, `SubtasksDone`, and more |

INVEST scores render as a compact badge string (e.g. `✓✓⚠✓✓✗`) in Excel/Word, and as full per-criterion detail in Markdown/Word.

After picking a format, choose a save location; on success you'll get an **Open File** action.

## Why no PDF?

There's no lightweight pure-JS way to render HTML/CSS to PDF without bundling a headless browser. Export to Markdown or Word and use your editor's or browser's print-to-PDF instead.
