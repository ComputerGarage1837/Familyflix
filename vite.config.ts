/// <reference types="vitest" />
/// <reference types="vite/client" />
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    resolve: {
        alias: Object.fromEntries(['apps', 'components', 'constants', 'elements', 'hooks', 'lib', 'scripts', 'types', 'utils', 'familyflix']
            .map(name => [name, fileURLToPath(new URL(`./src/${name}`, import.meta.url))]))
    },
    test: {
        coverage: {
            include: [ 'src' ]
        },
        environment: 'jsdom',
        restoreMocks: true
    }
});
