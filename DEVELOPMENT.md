# Development Guide

Setup and workflow for developing the Saga VS Code extension on a new machine.

## Prerequisites

- **Node.js** 20+ and npm
- **VS Code** 1.125 or later
- **GitHub Copilot** enabled (for testing the default VS Code LM provider), or an API key for one of the BYOK providers (Anthropic, Gemini, OpenAI, OpenRouter), or a local model server (Ollama/LM Studio)
- (Optional, for tracker testing) A Jira Cloud site with an API token, and/or an Azure DevOps org with a PAT
- (Optional, for packaging/publishing) `vsce`: `npm install -g @vscode/vsce`

## Clone and install

```bash
git clone https://github.com/haribrothers/saga.git
cd saga
npm install
```

This single `npm install` covers both the extension source (`src/`) and the Webview UI (`webview-ui/`) — there's no separate package to install; the Webview is built via the root project's Vite config.

## Running the extension locally

1. Open the repo in VS Code.
2. Press **F5** (or Run → Start Debugging). This runs the default build task, then launches a new **Extension Development Host** window with Saga loaded.
3. In that new window, open (or create) a workspace folder and run the **Init** command from the Command Palette to try it out.

Reload the Extension Development Host window (`Cmd/Ctrl+R`) to pick up extension-side changes without re-pressing F5.

### Watch mode (recommended while developing)

Instead of re-running `npm run compile` manually, start the watchers and just reload the dev host window as you edit:

```bash
npm run watch
```

This runs three watchers in parallel: `esbuild` (extension bundle), `tsc --noEmit --watch` (type-checking), and `vite build --watch` (Webview UI).

::: warning
If you change Webview source (`webview-ui/src/**`) and are **not** running `npm run watch`, you must run `npm run compile:webview` (or `npm run package`) before reloading the dev host, or the Webview panels will show stale UI.
:::

## Common commands

| Command | What it does |
|---|---|
| `npm run check-types` | Type-check only (`tsc --noEmit`) |
| `npm run lint` | Lint only (`eslint src`) |
| `npm run compile` | Type-check + lint + esbuild → `dist/extension.js` (dev build) |
| `npm run compile:webview` | Build the Webview UI (`vite build`) → `dist/webview/` |
| `npm run watch` | Watch mode for esbuild + tsc + Webview, all in parallel |
| `npm run package` | Full production build (both targets, minified, no sourcemaps) — **run this before F5 whenever you've touched Webview source** |
| `npm test` | Compiles, then runs the VS Code integration test suite (`@vscode/test-electron`) |
| `npm run test:unit` | Runs the Vitest unit suite (pure logic — parsers, validators, export renderers) |

Run both `npm run compile` and `npm run compile:webview` (or just `npm run package`) before pressing F5 if you've changed both extension and Webview code — they're two independent build targets.

## Testing

- **Unit tests** (`npm run test:unit`, Vitest) — pure logic with no VS Code API dependency: schema parsing, hash functions, field mapping, export renderers.
- **Integration tests** (`npm test`, `@vscode/test-electron`) — runs inside a real VS Code instance; compiles the extension and test files first (`pretest`).

## Packaging a `.vsix`

```bash
npm run package
vsce package
```

This produces `saga-<version>.vsix` in the repo root. Install it locally with:

```bash
code --install-extension saga-<version>.vsix
```

## Publishing to the VS Code Marketplace

::: warning
Publishing is a real, externally-visible action — don't run this casually. Confirm the version bump and changelog are correct first.
:::

1. The `publisher` field in `package.json` (`haribrothers`) must already be **registered** at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) — the field itself doesn't validate anything until you actually publish.
2. You need a Personal Access Token (Azure DevOps PAT, Marketplace scope) — see [`vsce`'s publishing docs](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).
3. Bump the version in `package.json` and update `CHANGELOG.md`.
4. Publish:

   ```bash
   vsce publish
   ```

   Or publish a pre-built `.vsix` directly:

   ```bash
   vsce publish --packagePath saga-<version>.vsix
   ```

## Documentation site (`docs-site/`)

The docs site at [haribrothers.github.io/saga](https://haribrothers.github.io/saga/) is a separate VitePress project under `docs-site/`, with its own `package.json`.

```bash
cd docs-site
npm install
npm run dev       # local dev server with hot reload
npm run build     # production build → docs-site/.vitepress/dist
npm run preview   # preview the production build locally
```

### Deploying docs

Docs deploy automatically via GitHub Actions (`.github/workflows/docs.yml`) on every push to `main` that touches `docs-site/**`. There's no manual deploy step — edit the Markdown, commit, push, and the workflow builds and publishes to GitHub Pages.

To trigger a deploy without a content change (e.g. after a Pages settings change), run it manually:

```bash
gh workflow run docs.yml
```

## Project layout reference

See [CLAUDE.md](CLAUDE.md) for the full architecture reference (module structure, `.saga/` folder layout, key constraints) — it's written for AI coding agents working in this repo, but doubles as a thorough technical reference for human contributors too.
