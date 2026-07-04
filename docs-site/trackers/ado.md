# Azure DevOps Setup

## Prerequisites

- An Azure DevOps organization and project
- A [Personal Access Token](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate) (PAT) with Work Items read/write scope

## Configuration

Open **Settings** → **Tracker** → **Azure DevOps**:

| Field | Notes |
|---|---|
| Organization URL | e.g. `https://dev.azure.com/yourorg` |
| Project | project name |
| PAT | entered via a SecretStorage-backed input box |
| Area Path | optional |
| Epic work item type | default `Epic` |
| Story work item type | default `User Story` (or `Product Backlog Item`, depending on process template) |

### Advanced fields

| Field | Default | Notes |
|---|---|---|
| Subtask work item type | `Task` | matches your process template if it uses a different name |
| AC field ID | `Microsoft.VSTS.Common.AcceptanceCriteria` | override if your process template uses a custom field |
| Story points field ID | *(falls back to the standard field)* | `Microsoft.VSTS.Scheduling.StoryPoints` unless overridden |

Click **Test Connection** to verify before pushing anything.

## Authentication

ADO uses Basic auth with an empty username: `base64(:pat)`.

## How pushes work

Saga uses JSON Patch operations against the Work Items REST API. Parent-child links (epic → story, story → subtask) use the `System.LinkTypes.Hierarchy-Reverse` relation, built as a **full absolute URL** (`{orgUrl}/_apis/wit/workItems/{id}`) — ADO rejects relative URLs here.

## Troubleshooting 400 errors

If a push fails with a 400, the error message now includes ADO's own JSON error body (parsed and appended) — check the **Saga** Output Channel for the specific field or value that was rejected, most commonly a misconfigured `ac_field_id` or `story_points_field_id` that doesn't exist on your process template's layout for that work item type.
