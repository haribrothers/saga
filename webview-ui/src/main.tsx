import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StoryEditor } from './StoryEditor';
import { SettingsEditor } from './SettingsEditor';

const rootEl = document.getElementById('root')!;
const panel = rootEl.dataset.panel;

createRoot(rootEl).render(
    <StrictMode>
        {panel === 'settings' ? <SettingsEditor /> : <StoryEditor />}
    </StrictMode>,
);
