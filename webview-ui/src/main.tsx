import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StoryEditor } from './StoryEditor';
import { SettingsEditor } from './SettingsEditor';
import { GenerationReview } from './GenerationReview';
import { SyncReview } from './SyncReview';
import { AgentPromptPanel } from './AgentPromptPanel';
import { AgentsMdPanel } from './AgentsMdPanel';

const rootEl = document.getElementById('root')!;
const panel = rootEl.dataset.panel;

createRoot(rootEl).render(
    <StrictMode>
        {panel === 'settings' ? <SettingsEditor />
            : panel === 'generation-review' ? <GenerationReview />
            : panel === 'sync-review' ? <SyncReview />
            : panel === 'agent-prompt' ? <AgentPromptPanel />
            : panel === 'agents-md' ? <AgentsMdPanel />
            : <StoryEditor />}
    </StrictMode>,
);
