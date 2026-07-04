# config.yaml Reference

`.saga/config.yaml` holds all non-secret configuration — provider routing, model IDs, and tracker defaults. It's meant to be committed; credentials never live here (see [Privacy & Telemetry](/reference/privacy)).

## `ai`

```yaml
ai:
  default_provider: vscode-lm   # vscode-lm | anthropic | gemini | openai | openrouter | local
  fallback_order: []
  providers:
    vscode-lm:
      enabled: true
    anthropic:
      enabled: false
      prompt_caching: false
    gemini:
      enabled: false
    openai:
      enabled: false
    openrouter:
      enabled: false
    local:
      enabled: false
      base_url: "http://localhost:11434"
  routing:
    epic_generation: "auto"
    story_generation: "auto"
    invest_validation: "auto"
    story_splitting: "auto"
    agent_prompt: "auto"
    agents_md: "auto"
    subtask_generation: "auto"
  budget:
    confirm_above_usd: 0.50
    show_token_preview: true
```

Each `routing` entry is either `"auto"` or a specific model ID string. See [Model Routing](/providers/model-routing).

## `tracker`

```yaml
tracker:
  default: none   # jira | ado | none
  jira:
    base_url: "https://yourcompany.atlassian.net"
    project_key: "PROJ"
    email: "you@company.com"
    epic_issue_type: "Epic"
    story_issue_type: "Story"
    subtask_issue_type: "Sub-task"
    ac_field_id: "description"
    epic_link_style: "parent"   # or "customfield_10014" for classic projects
    # story_points_field_id: "customfield_10028"   # omit to skip story points push
  ado:
    org_url: "https://dev.azure.com/yourorg"
    project: "YourProject"
    # area_path: "YourProject\\YourTeam"
    epic_work_item_type: "Epic"
    story_work_item_type: "User Story"
    subtask_work_item_type: "Task"
    ac_field_id: "Microsoft.VSTS.Common.AcceptanceCriteria"
    # story_points_field_id: "Microsoft.VSTS.Scheduling.StoryPoints"
```

Only the section matching `tracker.default` needs to be filled in, but both can coexist in the file.

## `telemetry`

```yaml
telemetry:
  enabled: false
```

Off by default. See [Privacy & Telemetry](/reference/privacy) — this never makes a network call, it only logs to the Saga Output Channel.

## Secrets are never here

API keys, Jira API tokens, and ADO PATs are entered through Settings UI input boxes and stored in VS Code's SecretStorage. They are never written to `config.yaml` or any other file in `.saga/`.
