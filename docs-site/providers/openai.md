# OpenAI (BYOK)

Bring your own OpenAI API key.

## Setup

1. Open **Settings** → enable the **OpenAI** provider card
2. Click **Add/Update Key** — paste your API key from the [OpenAI Platform](https://platform.openai.com/); stored in SecretStorage
3. Click **Test Connection** to confirm

## Model selection

The model list is fetched live from OpenAI's `/models` endpoint.

## Token usage

Exact input/output counts come from the API's `usage` field.

::: tip
This is a separate adapter from the "Local" provider — even if you point a local server at an OpenAI-compatible endpoint, use the **Local** provider card for that, not this one.
:::
