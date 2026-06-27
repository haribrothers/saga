// Single acquireVsCodeApi() call for the entire bundle.
// Both StoryEditor and SettingsEditor import `vscodeApi` from here.

declare function acquireVsCodeApi(): {
    // Accept any message shape — callers cast to their specific type.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    postMessage(msg: any): void;
    getState(): unknown;
    setState(state: unknown): void;
};

export const vscodeApi = acquireVsCodeApi();
