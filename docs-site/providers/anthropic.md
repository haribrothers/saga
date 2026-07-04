# Anthropic (BYOK)

Bring your own Anthropic API key to use Claude models directly.

## Setup

1. Open **Settings** → enable the **Anthropic** provider card
2. Click **Add/Update Key** — paste your API key from the [Anthropic Console](https://console.anthropic.com/); it's stored in VS Code SecretStorage, never written to `.saga/`
3. Click **Test Connection** to confirm

## Model selection

The model picker is populated live from Anthropic's available models. Choose per-task under [Model Routing](/providers/model-routing), or set a workspace default.

## Token usage

Exact input/output counts are returned directly from the Anthropic API's `usage` field on every response.
