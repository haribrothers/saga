# VS Code Language Model (Copilot)

The default provider. Uses the built-in VS Code Language Model API, which routes through your existing GitHub Copilot subscription.

## Setup

Nothing beyond having Copilot enabled in VS Code. Open **Settings** and confirm "VS Code Language Model" is enabled — it is by default.

## Model selection

Pick a specific model from the ones Copilot exposes, or leave routing set to `"auto"` to let VS Code choose.

## Token usage

Input tokens are estimated via `model.countTokens()`; output tokens are estimated as `content.length / 4`. Both are labeled `(est.)` in the Output Channel and review panel — this provider does not return exact counts from the API.
