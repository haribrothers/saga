# Jira Cloud Setup

## Prerequisites

- A Jira Cloud site
- An [API token](https://id.atlassian.com/manage-profile/security/api-tokens) for your Atlassian account

## Configuration

Open **Settings** → **Tracker** → **Jira Cloud**:

| Field | Notes |
|---|---|
| Site URL | e.g. `https://yourcompany.atlassian.net` |
| Email | the Atlassian account the token belongs to |
| API Token | entered via a SecretStorage-backed input box — never stored in `.saga/` |
| Project Key | e.g. `PROJ` |
| Epic issue type | default `Epic` |
| Story issue type | default `Story` |

### Advanced fields

| Field | Default | Notes |
|---|---|---|
| Subtask issue type | `Sub-task` | some projects use `Subtask` or don't support the hierarchy at all |
| AC field ID | — | custom field for acceptance criteria, if your Jira instance uses one |
| Epic link style | — | Next-Gen `parent` link vs. Classic `customfield_10014` Epic Link |
| Story points field ID | *(omitted by default)* | left unset to avoid a 400 error on screens where the field is restricted; set explicitly to enable story points push |

Click **Test Connection** to verify before pushing anything.

## Authentication

Jira uses Basic auth: `base64(email:token)`. Auth details never leave SecretStorage except to build this header at request time.

## Description format

Story/epic descriptions are pushed as Atlassian Document Format (ADF). Saga guarantees the ADF `content` is never empty — a blank body is padded with a single space paragraph rather than sent empty, which Jira would otherwise reject.
