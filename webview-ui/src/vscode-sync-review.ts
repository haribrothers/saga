// Typed postMessage bridge for the Sync Review Webview panel.
// Types here must be kept in sync with the definitions in
// src/webview/sync-review-panel.ts (same shape, duplicated to avoid
// cross-rootDir imports between the extension and webview TypeScript projects).
import { vscodeApi } from './vscode-api';

// ─── View shapes ─────────────────────────────────────────────────────────────

export interface LocalEpicView {
    id: string; title: string; description: string; labels: string[];
}

export interface LocalStoryView {
    id: string; title: string; epic: string;
    as_a: string; i_want: string; so_that: string;
    description: string; acceptance_criteria: string[];
    estimate?: number; labels: string[];
}

export interface RemoteEpicView {
    key: string; title: string; description: string; labels: string[]; url: string;
}

export interface RemoteStoryView {
    key: string; title: string;
    as_a: string; i_want: string; so_that: string;
    description: string; acceptance_criteria: string[];
    estimate?: number; labels: string[]; url: string;
}

export interface LocalSubtaskView {
    id: string; storyId: string; title: string; type: string; done: boolean;
}

export interface RemoteSubtaskView {
    key: string; title: string; done: boolean; url: string;
}

export type EpicSyncStateView =
    | { kind: 'in-sync'; local: LocalEpicView }
    | { kind: 'local-only'; local: LocalEpicView }
    | { kind: 'remote-only'; local: LocalEpicView; remote: RemoteEpicView }
    | { kind: 'conflict'; local: LocalEpicView; remote: RemoteEpicView };

export type StorySyncStateView =
    | { kind: 'in-sync'; local: LocalStoryView }
    | { kind: 'local-only'; local: LocalStoryView }
    | { kind: 'remote-only'; local: LocalStoryView; remote: RemoteStoryView }
    | { kind: 'conflict'; local: LocalStoryView; remote: RemoteStoryView };

export type SubtaskSyncStateView =
    | { kind: 'in-sync'; syncId: string; local: LocalSubtaskView }
    | { kind: 'local-only'; syncId: string; local: LocalSubtaskView }
    | { kind: 'remote-only'; syncId: string; local: LocalSubtaskView; remote: RemoteSubtaskView }
    | { kind: 'conflict'; syncId: string; local: LocalSubtaskView; remote: RemoteSubtaskView };

export interface SyncPlanView {
    epics: EpicSyncStateView[];
    stories: StorySyncStateView[];
    subtasks: SubtaskSyncStateView[];
    unpushedEpicIds: string[];
    unpushedStoryIds: string[];
    unpushedSubtaskIds: string[];
    fetchErrors: Array<{ sagaId: string; error: string }>;
}

// ─── Resolutions ──────────────────────────────────────────────────────────────

export type EpicResolutionView =
    | { kind: 'push' | 'pull' | 'keep-local' | 'take-remote' | 'skip'; sagaId: string };

export type StoryResolutionView =
    | { kind: 'push' | 'pull' | 'keep-local' | 'take-remote' | 'skip'; sagaId: string };

/** sagaId here is the syncId (`${storyId}:${subtaskId}`). */
export type SubtaskResolutionView =
    | { kind: 'push' | 'pull' | 'keep-local' | 'take-remote' | 'skip'; sagaId: string };

// ─── Message contract ─────────────────────────────────────────────────────────

export type SyncExtensionToWebview =
    | { type: 'load'; plan: SyncPlanView; provider: 'jira' | 'ado' }
    | { type: 'applyAck'; applied: number; failed: Array<{ sagaId: string; error: string }> }
    | { type: 'error'; message: string };

export type SyncWebviewToExtension =
    | { type: 'ready' }
    | { type: 'apply'; epicResolutions: EpicResolutionView[]; storyResolutions: StoryResolutionView[]; subtaskResolutions: SubtaskResolutionView[] }
    | { type: 'cancel' };

// ─── API ──────────────────────────────────────────────────────────────────────

const syncApi = {
    postMessage: (msg: SyncWebviewToExtension) => vscodeApi.postMessage(msg),
};
export default syncApi;
