import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        exclude: ['src/test/**'],   // keep @vscode/test-electron tests separate
        environment: 'node',
    },
});
