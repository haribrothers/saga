# Splitting Stories

If a story is too large — fails the INVEST "Small" criterion, or just feels unwieldy — use **Split Story** (Command Palette or the story's right-click context menu).

## How it works

1. Saga re-validates INVEST "Small" fresh (never trusts a possibly-stale cached result).
2. If the story currently passes, you'll be asked to confirm "Split Anyway" before continuing.
3. The AI proposes 2–3 replacement stories that together cover the same acceptance criteria as the original.
4. The proposed stories open in the normal **Generation Review** panel, where you can edit and validate before saving.
5. **Only after the replacement stories are successfully saved** is the original story deleted (via the same tracker-aware delete flow as manual deletion).

If you cancel or close the review panel, the original story is untouched — nothing is lost.
