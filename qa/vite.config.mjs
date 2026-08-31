import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const qaRoot = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
    root: qaRoot,
    resolve: { alias: {
        'lib/jellyfin-apiclient': path.join(qaRoot, 'fakeConnections.ts'),
        '../lib/jellyfin-apiclient': path.join(qaRoot, 'fakeConnections.ts'),
        'components/dialogHelper/dialogHelper': path.join(qaRoot, 'dialogAdapter.ts')
    } },
    server: { host: '127.0.0.1', port: 51724, strictPort: true,
        fs: { allow: [path.dirname(qaRoot)] } }
});
