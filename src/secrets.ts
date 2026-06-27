import * as vscode from 'vscode';

export const SecretKey = {
    ANTHROPIC_API_KEY: 'saga.anthropic.apiKey',
    GEMINI_API_KEY: 'saga.gemini.apiKey',
    OPENAI_API_KEY: 'saga.openai.apiKey',
    JIRA_API_TOKEN: 'saga.jira.apiToken',
    ADO_PAT: 'saga.ado.pat',
} as const;

export type SecretKeyName = (typeof SecretKey)[keyof typeof SecretKey];

/**
 * Thin wrapper around VS Code SecretStorage. All Saga credentials go through
 * here — never into .saga/ config files or the process environment.
 */
export class SecretsManager {
    constructor(private readonly storage: vscode.SecretStorage) {}

    async get(key: SecretKeyName): Promise<string | undefined> {
        return this.storage.get(key);
    }

    async set(key: SecretKeyName, value: string): Promise<void> {
        return this.storage.store(key, value);
    }

    async delete(key: SecretKeyName): Promise<void> {
        return this.storage.delete(key);
    }

    async has(key: SecretKeyName): Promise<boolean> {
        return (await this.storage.get(key)) !== undefined;
    }
}
