# Trackers Overview

Saga supports pushing to and syncing with **Jira Cloud** and **Azure DevOps**. Both go through a common `TrackerAdapter` interface, so the workflow is the same regardless of which you use.

## Supported trackers

- [Jira Cloud](/trackers/jira)
- [Azure DevOps](/trackers/ado)

## Workflow

1. **Configure** your tracker under Settings → Tracker
2. **Push** epics (must be pushed before their stories — enforced) and stories
3. **Sync** periodically to pull remote changes and resolve conflicts

See [Pushing Epics & Stories](/trackers/pushing) and [Two-Way Sync & Conflicts](/trackers/sync) for the detailed flows.

## What's never automatic

- No background auto-push — sync and push are always user-triggered
- No silent conflict resolution — every sync opens a review panel before anything is written
- No secrets in `.saga/` — tokens/PATs live in VS Code SecretStorage only
