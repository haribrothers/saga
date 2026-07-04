import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Saga',
  description: 'AI-generated, INVEST-compliant agile stories synced with Jira/Azure DevOps.',
  base: '/saga/',
  cleanUrls: true,
  lastUpdated: true,

  head: [['link', { rel: 'icon', href: '/saga/favicon.png', type: 'image/png' }]],

  themeConfig: {
    logo: '/logo-nav.png',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'AI Providers', link: '/providers/overview' },
      { text: 'Trackers', link: '/trackers/overview' },
      { text: 'Reference', link: '/reference/commands' },
      { text: 'Changelog', link: 'https://github.com/haribrothers/saga/blob/main/CHANGELOG.md' }
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is Saga?', link: '/guide/what-is-saga' },
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Core Concepts', link: '/guide/core-concepts' }
          ]
        },
        {
          text: 'Working with Saga',
          items: [
            { text: 'Generating Epics & Stories', link: '/guide/generation' },
            { text: 'Subtasks', link: '/guide/subtasks' },
            { text: 'Splitting Stories', link: '/guide/splitting-stories' },
            { text: 'INVEST Validation', link: '/guide/invest-validation' },
            { text: 'Templates', link: '/guide/templates' },
            { text: 'Agent Prompts & AGENTS.md', link: '/guide/agent-prompts' },
            { text: 'Exporting the Backlog', link: '/guide/export' }
          ]
        }
      ],
      '/providers/': [
        {
          text: 'AI Providers',
          items: [
            { text: 'Overview', link: '/providers/overview' },
            { text: 'VS Code Language Model (Copilot)', link: '/providers/vscode-lm' },
            { text: 'Anthropic (BYOK)', link: '/providers/anthropic' },
            { text: 'Gemini (BYOK)', link: '/providers/gemini' },
            { text: 'OpenAI (BYOK)', link: '/providers/openai' },
            { text: 'OpenRouter (BYOK)', link: '/providers/openrouter' },
            { text: 'Local (Ollama / LM Studio)', link: '/providers/local' },
            { text: 'Model Routing', link: '/providers/model-routing' }
          ]
        }
      ],
      '/trackers/': [
        {
          text: 'Trackers',
          items: [
            { text: 'Overview', link: '/trackers/overview' },
            { text: 'Jira Cloud Setup', link: '/trackers/jira' },
            { text: 'Azure DevOps Setup', link: '/trackers/ado' },
            { text: 'Pushing Epics & Stories', link: '/trackers/pushing' },
            { text: 'Two-Way Sync & Conflicts', link: '/trackers/sync' }
          ]
        }
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Command Reference', link: '/reference/commands' },
            { text: 'config.yaml Reference', link: '/reference/config' },
            { text: '.saga/ Folder Layout', link: '/reference/saga-folder' },
            { text: 'Troubleshooting & FAQ', link: '/reference/troubleshooting' },
            { text: 'Privacy & Telemetry', link: '/reference/privacy' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/haribrothers/saga' }
    ],

    search: {
      provider: 'local'
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Saga contributors'
    },

    editLink: {
      pattern: 'https://github.com/haribrothers/saga/edit/main/docs-site/:path',
      text: 'Edit this page on GitHub'
    }
  }
})
