# Model Routing

Saga lets you assign a different model to each generation task, rather than one global default.

## Tasks you can route independently

- `epic_generation`
- `story_generation`
- `story_refine`
- `story_splitting`
- `subtask_generation`
- `agent_prompt`
- `agents_md`

## Configuring routing

Open **Settings** → **Model Routing**. Each task shows a live model picker populated from every *enabled* provider's `listModels()` call. Pick a specific model, or leave it as `"auto"` to let Saga pick a sensible default for that provider.

## How it's stored

Routing lives in `config.yaml` as a plain model ID string or the literal `"auto"`:

```yaml
ai:
  routing:
    epic_generation: "auto"
    story_generation: "claude-sonnet-5"
    subtask_generation: "auto"
```

An older `{ tier: ... }` object form is still read for backward compatibility and coerced into the string form automatically.

## What shows during generation

Every generation run displays `<model-id> (<provider>)` in both the progress notification and the Generation Review panel header, so you always know exactly which model produced what you're looking at.
