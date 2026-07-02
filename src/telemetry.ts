import * as vscode from 'vscode';
import { getSagaRoot, readConfig } from './saga-repo';

/**
 * Anonymous local event logging — command name, provider type, story count.
 * Never logs content (story titles, descriptions, context text, etc).
 * Off by default; opt-in via Settings → telemetry.enabled in config.yaml.
 *
 * Currently logs to the Saga Output Channel only. No network calls, no
 * external service — this is the honest state of "telemetry" today. The
 * event shape is deliberately small and typed so a real sink can be added
 * later without touching call sites.
 */

export interface TelemetryEvent {
    command: string;
    provider?: string;
    storyCount?: number;
}

export class TelemetryReporter {
    constructor(
        private readonly workspaceRoot: vscode.Uri,
        private readonly channel: vscode.OutputChannel,
    ) {}

    async track(event: TelemetryEvent): Promise<void> {
        let enabled = false;
        try {
            const config = await readConfig(getSagaRoot(this.workspaceRoot));
            enabled = config.telemetry.enabled;
        } catch {
            // config missing/malformed — telemetry stays off
        }
        if (!enabled) { return; }

        const parts = [`command=${event.command}`];
        if (event.provider) { parts.push(`provider=${event.provider}`); }
        if (event.storyCount !== undefined) { parts.push(`storyCount=${event.storyCount}`); }
        this.channel.appendLine(`[telemetry] ${parts.join(' ')}`);
    }
}
