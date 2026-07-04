# Troubleshooting & FAQ

## Generation

**Q: Generation says "cancelled" but I didn't click cancel.**
Check if a `CancellationToken` was triggered by closing the progress notification, switching windows in a way VS Code treats as dismissal, or a network timeout. Nothing is written to disk on cancellation — safe to retry.

**Q: My edited template isn't being used.**
Confirm the file exists at `.saga/templates/<name>.hbs` (run **Open Template** to check/create it) and that you saved it — templates are recompiled from source on every generation call, so a saved edit takes effect on the *next* run without needing an extension reload.

## Jira

**Q: Push fails with a 400 on story points.**
`story_points_field_id` is omitted by default because many Jira screens don't have it on the create/edit screen for that issue type — pushing to a field that isn't on the screen returns a 400. Only set this field if you've confirmed the custom field ID and that it's on the relevant screen.

**Q: Epic Link isn't working / story doesn't show under its epic.**
Check `jira.epic_link_style` — Team-Managed (Next-Gen) projects use `"parent"`, while Company-Managed (Classic) projects use `"customfield_10014"` (or your instance's actual custom field ID for Epic Link).

## Azure DevOps

**Q: Test Connection returns 404.**
Confirm your Organization URL and Project name are correct — this endpoint hits `{orgUrl}/_apis/projects/{project}`.

**Q: Push fails with 400 and a vague error.**
The error message includes ADO's own JSON error body — check the **Saga** Output Channel for details. The most common cause is `ac_field_id` or `story_points_field_id` referencing a field that isn't part of your process template's layout for that work item type.

**Q: Linking to a work item requires the full url.**
This was a bug in earlier versions where relation URLs were built as relative paths; it's fixed — parent/child links now always use the full `{orgUrl}/_apis/wit/workItems/{id}` form. If you still see this, check you're on the latest version.

## Sync

**Q: Sync shows every item as "remote-only" even though nothing changed remotely.**
This was caused by lossy text reconstruction (multi-paragraph descriptions collapsing on fetch) and hash-shape mismatches in earlier versions — both are fixed. If you still see this on items pushed with a very old version, the first sync after upgrading may show a one-time false conflict; resolving it with **Keep Local** re-baselines the item and every subsequent sync is accurate.

**Q: A subtask keeps showing drift even though I haven't touched it.**
Check whether the tracker is returning an empty title for that item (a fetch-parsing edge case) — Saga falls back to the local title for display but always hashes the raw remote value for the sync baseline, so this should self-resolve after one sync. If it persists, check the Output Channel for fetch errors on that item.

## General

**Q: Where do I see detailed logs?**
Every generation call, tracker request failure, and sync fetch error is logged to the **Saga** Output Channel (View → Output → select "Saga" from the dropdown).

**Q: Is any of my data sent anywhere I haven't configured?**
No — see [Privacy & Telemetry](/reference/privacy).
