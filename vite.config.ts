import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
    plugins: [react()],
    build: {
        outDir: 'dist/webview',
        emptyOutDir: true,
        rollupOptions: {
            input: resolve(__dirname, 'webview-ui/index.html'),
        },
    },
    base: './',
});
