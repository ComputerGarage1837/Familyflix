import { beforeEach, describe, expect, it } from 'vitest';
import type { FamilySession } from './familySession';
import { activeCoWatchParticipants, disableCoWatch, readCoWatchState, writeCoWatchState } from './coWatchProfiles';

const session = (userId: string): FamilySession => ({
    userId, serverId: 'server', token: 'primary-token', address: 'https://example.test',
    client: {} as FamilySession['client'], key: 'server:' + userId, current: () => true
});

describe('Watching Together local profile scope', () => {
    beforeEach(() => localStorage.clear());

    it('keeps participants under the primary user and server, never including the primary token', () => {
        const dylan = session('dylan');
        writeCoWatchState(dylan, {
            profiles: [
                { serverId: 'server', userId: 'amanda', name: 'Amanda', token: 'a' },
                { serverId: 'server', userId: 'dylan', name: 'Dylan', token: 'wrong' },
                { serverId: 'other', userId: 'kristine', name: 'Kristine', token: 'wrong' }
            ],
            presets: [], activeIds: ['amanda', 'dylan', 'kristine'], homeUserId: 'amanda'
        });
        expect(activeCoWatchParticipants(dylan).map(profile => profile.userId)).toEqual(['amanda']);
        expect(readCoWatchState(session('amanda')).profiles).toEqual([]);
        disableCoWatch(dylan);
        expect(activeCoWatchParticipants(dylan)).toEqual([]);
        expect(readCoWatchState(dylan).profiles).toHaveLength(1);
    });

    it('fails closed on corrupt saved state', () => {
        localStorage.setItem('familyFlixCoWatchV1:server:dylan', '{');
        expect(readCoWatchState(session('dylan')).activeIds).toEqual([]);
    });
});
