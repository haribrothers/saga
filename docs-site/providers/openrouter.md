# OpenRouter (BYOK)

Access a wide range of models through a single OpenRouter API key.

## Setup

1. Open **Settings** → enable the **OpenRouter** provider card
2. Click **Add/Update Key** — paste your API key from [openrouter.ai](https://openrouter.ai/); stored in SecretStorage under `saga.openrouter.apiKey`
3. Click **Test Connection** to confirm

## Model selection

The model list is fetched live from OpenRouter's `/models` endpoint, including per-model pricing shown as `$X.XX/M in` in the display name.

## Request headers

Saga always sends `HTTP-Referer: vscode-saga` and `X-Title: Saga` on every request, as required by OpenRouter's usage policy.

## Token usage

Exact input/output counts come from the API's `usage` field.
