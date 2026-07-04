# Local (Ollama / LM Studio)

Run models entirely on your own machine — no API key, no data leaving your network.

## Setup

1. Start your local server (e.g. `ollama serve`, or LM Studio's local server mode)
2. Open **Settings** → enable the **Local** provider card, and set the endpoint URL (defaults typically match Ollama's `http://localhost:11434` or LM Studio's OpenAI-compatible port)
3. Click **Test Connection** to confirm

## Model selection

The model list is fetched from your local server's model listing endpoint.

## Token usage

Exact input/output counts are returned by the local server's OpenAI-compatible API response.

::: tip Privacy
Nothing you generate through the Local provider ever leaves your machine — useful if your product briefs or designs are sensitive.
:::
