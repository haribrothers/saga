import * as vscode from 'vscode';
import { readConfig } from '../saga-repo';
import { getSagaRoot } from '../saga-repo';
import { SecretsManager, SecretKey } from '../secrets';
import { TrackerAdapter } from './adapter';
import { JiraAdapter } from './jira';
import { AdoAdapter } from './ado';

/**
 * Reads config + credentials from SecretStorage and returns the configured
 * TrackerAdapter. Returns undefined if no tracker is configured or credentials
 * are missing — the caller should show a user-facing error.
 */
export async function buildTrackerAdapter(
    workspaceRoot: vscode.Uri,
    secrets: SecretsManager,
): Promise<TrackerAdapter | undefined> {
    const sagaRoot = getSagaRoot(workspaceRoot);
    const config = await readConfig(sagaRoot);
    const trackerDefault = config.tracker.default;

    if (trackerDefault === 'none' || !trackerDefault) {
        return undefined;
    }

    if (trackerDefault === 'jira') {
        const jiraCfg = config.tracker.jira;
        if (!jiraCfg?.base_url || !jiraCfg.project_key || !jiraCfg.email) {
            return undefined;
        }
        const token = await secrets.get(SecretKey.JIRA_API_TOKEN);
        if (!token) { return undefined; }
        return new JiraAdapter({
            baseUrl: jiraCfg.base_url,
            email: jiraCfg.email,
            apiToken: token,
            config: {
                projectKey: jiraCfg.project_key,
                email: jiraCfg.email,
                epicIssueType: jiraCfg.epic_issue_type,
                storyIssueType: jiraCfg.story_issue_type,
                acFieldId: jiraCfg.ac_field_id,
                epicLinkStyle: jiraCfg.epic_link_style,
                storyPointsFieldId: jiraCfg.story_points_field_id,
            },
        });
    }

    if (trackerDefault === 'ado') {
        const adoCfg = config.tracker.ado;
        if (!adoCfg?.org_url || !adoCfg.project) { return undefined; }
        const pat = await secrets.get(SecretKey.ADO_PAT);
        if (!pat) { return undefined; }
        return new AdoAdapter({
            orgUrl: adoCfg.org_url,
            pat,
            config: {
                project: adoCfg.project,
                areaPath: adoCfg.area_path,
                epicWorkItemType: adoCfg.epic_work_item_type,
                storyWorkItemType: adoCfg.story_work_item_type,
            },
        });
    }

    return undefined;
}
