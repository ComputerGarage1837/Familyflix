import { describe, expect, it, vi } from 'vitest';
vi.mock('./familySession', () => ({ captureFamilySession: vi.fn() }));
import { secondaryFeedRoute, selectedHomeProfile } from './coWatchFeed';
import type { CoWatchState } from './coWatchProfiles';

const state: CoWatchState = {
    profiles: [{ serverId: 'server', userId: 'amanda', name: 'Amanda', token: 'secondary' }],
    presets: [], activeIds: ['amanda'], homeUserId: 'amanda'
};

describe('Watching Together home feed', () => {
    it('only selects an active authenticated participant', () => {
        expect(selectedHomeProfile(state)?.name).toBe('Amanda');
        expect(selectedHomeProfile({ ...state, activeIds: [] })).toBeUndefined();
        expect(selectedHomeProfile({ ...state, homeUserId: 'dylan' })).toBeUndefined();
    });

    it('requests the secondary user for Continue Watching and the Deck', () => {
        expect(secondaryFeedRoute('Users/{userId}/Items/Resume', { Limit: '12' }, 'amanda'))
            .toEqual({ path: 'Users/amanda/Items/Resume', query: { Limit: '12' } });
        expect(secondaryFeedRoute('Shows/NextUp', { UserId: 'dylan' }, 'amanda'))
            .toEqual({ path: 'Shows/NextUp', query: { UserId: 'amanda' } });
    });
});
