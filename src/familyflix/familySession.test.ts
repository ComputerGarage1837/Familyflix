import type { ApiClient } from 'jellyfin-apiclient';
import { afterEach, describe, expect, it, vi } from 'vitest';

const USER = '11111111-2222-4333-8444-555555555551';
const SERVER = '55555555-aaaa-4bbb-8ccc-111111111111';

describe('Family Flix authenticated session boundary', () => {
    afterEach(() => {
        vi.doUnmock('../lib/jellyfin-apiclient');
        vi.resetModules();
    });

    it('does not read the circular ServerConnections export until the runtime is first used', async () => {
        let dependenciesReady = false;
        const client = {
            getCurrentUserId: () => USER, serverId: () => SERVER, accessToken: () => 'fixture-token',
            serverAddress: () => 'https://familyflix.invalid'
        } as ApiClient;
        const connections = { currentApiClient: vi.fn(() => client) };
        const readConnections = vi.fn(() => {
            if (!dependenciesReady) throw new ReferenceError('ServerConnections is still initializing');
            return connections;
        });
        vi.doMock('../lib/jellyfin-apiclient', () => ({
            get ServerConnections() { return readConnections(); }
        }));
        const runtime = await import('./familySession');
        expect(readConnections).not.toHaveBeenCalled();
        dependenciesReady = true;
        const session = runtime.captureFamilySession(client);
        expect(session).toMatchObject({ userId: USER, serverId: SERVER, token: 'fixture-token' });
        expect(session?.current()).toBe(true);
        expect(readConnections).toHaveBeenCalled();
    });

    it('generates public canonical operation identifiers', async () => {
        vi.doMock('../lib/jellyfin-apiclient', () => ({ ServerConnections: { currentApiClient: () => undefined } }));
        const { familyOperationId } = await import('./familySession');
        expect(familyOperationId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
});
