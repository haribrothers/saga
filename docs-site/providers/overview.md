# AI Providers Overview

Saga is provider-agnostic — every AI call goes through a common `LLMProvider` interface. You can mix providers per task (see [Model Routing](/providers/model-routing)) or just set one default.

| Provider | Setup required | Token usage |
|---|---|---|
| [VS Code LM (Copilot)](/providers/vscode-lm) | None beyond Copilot | Estimated |
| [Anthropic](/providers/anthropic) | API key (BYOK) | Exact |
| [Gemini](/providers/gemini) | API key (BYOK) | Exact |
| [OpenAI](/providers/openai) | API key (BYOK) | Exact |
| [OpenRouter](/providers/openrouter) | API key (BYOK) | Exact |
| [Local](/providers/local) | Ollama or LM Studio running locally | Exact |

## Where you configure providers

Open **Settings** from the Command Palette. Each provider card lets you enable it, enter a key (BYOK) via a SecretStorage-backed input box, and **Test Connection**.

## A note on Copilot / consumer OAuth

Saga only ever uses provider SDKs with an explicit API key (BYOK) or the official VS Code Language Model API for Copilot. Reusing a consumer chat app's OAuth session to call a model API on the side is not supported and won't be added — both Anthropic and Google have blocked this pattern for their consumer products.

## Next steps

- [Model Routing](/providers/model-routing) — assign a specific model per generation task
- Pick a provider above for setup instructions
