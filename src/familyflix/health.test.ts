/* eslint-disable sonarjs/no-hardcoded-ip -- Values such as 1.0.0.4 are plugin semantic versions, not IP addresses. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FamilySession } from './familySession';
import { parseHealthSnapshot } from './healthPolicy';

const request = vi.hoisted(() => vi.fn());
vi.mock('./familySession', () => ({ familyRequest: request }));

import { healthCapabilities, loadHealthSnapshot } from './health';

let current = true;
let counter = 0;
let session: FamilySession;

function snapshot() {
    return {
        schema: 1,
        generatedAtUtc: '2026-08-31T23:00:00Z',
        overallStatus: 'attention',
        server: {
            name: 'Fixture Jellyfin', version: '10.11.5', coreStartupComplete: true, pendingRestart: false,
            startedAtUtc: '2026-08-31T20:00:00Z', uptimeSeconds: 10800
        },
        plugin: { name: 'Family Flix Watchlists', version: '1.0.0.4', enabled: true, startedAtUtc: '2026-08-31T20:00:02Z' },
        issues: { available: true, revision: 3, openCount: 1, newCount: 1 },
        watchlists: {
            available: true, currentAdministratorPersonalRevision: 2, currentAdministratorPersonalEntries: 4,
            householdRevision: 5, householdEntries: 6
        },
        devices: [{
            name: 'Living room', appName: 'Family Flix', appVersion: '0.19.10-family.26',
            lastUserName: 'Fixture', lastSeenAtUtc: '2026-08-31T22:59:00Z', isFamilyFlix: true, updateStatus: 'notReported',
            accessToken: 'must be discarded'
        }],
        sessions: [{
            deviceName: 'Living room', userName: 'Fixture', client: 'Family Flix', appVersion: '0.19.10-family.26',
            lastActivityAtUtc: '2026-08-31T22:59:00Z', isActive: true, isPlaying: true, isPaused: false,
            playback: {
                title: 'Fixture episode', itemType: 'Episode', seriesName: 'Fixture series', seasonNumber: 1,
                episodeNumber: 2, positionTicks: 100, runtimeTicks: 200, playMethod: 'DirectPlay', filePath: 'D:\\private.mkv'
            },
            transcode: null
        }],
        tasks: [{ name: 'Scan media library', key: 'RefreshLibrary', state: 'Idle', progress: null, lastStatus: 'Completed', lastEndedAtUtc: '2026-08-31T22:00:00Z' }],
        crashes: {
            available: true, filesScanned: 1, items: [{
                appName: 'Family Flix', appVersion: '0.19.10-family.24', kind: 'temporaryOutage',
                exceptionType: 'InvalidStatusException', summary: 'Temporary server response (503)',
                fingerprint: '012345abcdef', occurrences: 2, firstSeenAtUtc: '2026-08-31T18:00:00Z',
                lastSeenAtUtc: '2026-08-31T18:01:00Z', logcat: 'must be discarded'
            }]
        }
    };
}

describe('Health Centre contract', () => {
    beforeEach(() => {
        current = true;
        session = { key: `server:admin:${counter++}`, current: () => current } as FamilySession;
        request.mockReset();
    });

    it('explicitly projects the snapshot and discards unknown sensitive fields', () => {
        const parsed = parseHealthSnapshot(snapshot());
        expect(parsed.devices[0]).toMatchObject({ name: 'Living room', updateStatus: 'notReported' });
        expect(parsed.sessions[0].playback).toMatchObject({ title: 'Fixture episode' });
        const json = JSON.stringify(parsed);
        expect(json).not.toContain('must be discarded');
        expect(json).not.toContain('accessToken');
        expect(json).not.toContain('filePath');
        expect(json).not.toContain('logcat');
    });

    it('fails closed when the server does not confirm administrator access', async () => {
        request.mockResolvedValueOnce({ schema: 1, version: '1.0.0.4', isAdmin: false });
        expect(await healthCapabilities(session, true)).toEqual({ version: '1.0.0.4', isAdmin: false });
        await expect(loadHealthSnapshot(session)).rejects.toThrow('administrator access is unavailable');
        expect(request).toHaveBeenCalledOnce();
    });

    it('loads a validated snapshot only for the still-current profile', async () => {
        request
            .mockResolvedValueOnce({ schema: 1, version: '1.0.0.4', isAdmin: true })
            .mockResolvedValueOnce(snapshot());
        await expect(loadHealthSnapshot(session, true)).resolves.toMatchObject({
            server: { name: 'Fixture Jellyfin' }, plugin: { version: '1.0.0.4' }
        });
        expect(request.mock.calls.map(call => call[1])).toEqual([
            'FamilyFlix/Health/Capabilities', 'FamilyFlix/Health/Snapshot'
        ]);

        session = { key: `server:admin:${counter++}`, current: () => current } as FamilySession;
        request
            .mockResolvedValueOnce({ schema: 1, version: '1.0.0.4', isAdmin: true })
            .mockImplementationOnce(async () => {
                current = false;
                return snapshot();
            });
        await expect(loadHealthSnapshot(session, true)).rejects.toThrow('active profile changed');
    });

    it('rejects malformed or oversized health responses', () => {
        expect(() => parseHealthSnapshot({ ...snapshot(), overallStatus: 'invented' })).toThrow();
        expect(() => parseHealthSnapshot({ ...snapshot(), devices: Array.from({ length: 101 }, () => snapshot().devices[0]) })).toThrow();
        const invalid = snapshot();
        invalid.crashes.items[0].fingerprint = 'not-a-fingerprint';
        expect(() => parseHealthSnapshot(invalid)).toThrow();
    });
});
/* eslint-enable sonarjs/no-hardcoded-ip */
