import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StoryEditor } from './StoryEditor';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <StoryEditor />
    </StrictMode>,
);
