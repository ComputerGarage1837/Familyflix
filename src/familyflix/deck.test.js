import { describe, expect, it } from 'vitest';

import { getFamilyDeck } from './deck';

const episode = (id, season, number, played, lastPlayedDate) => ({
    Id: id, Type: 'Episode', SeriesId: 'show', SeasonId: `season-${season}`,
    ParentIndexNumber: season, IndexNumber: number,
    UserData: { Played: played, PlaybackPositionTicks: 0, LastPlayedDate: lastPlayedDate }
});

describe('Family Flix Deck', () => {
    it('follows the older unwatched season after recent playback without showing watched episodes', async () => {
        const normal = episode('s24e10', 24, 10, false);
        const rewatch = episode('s20e03', 20, 3, true);
        const nextOlder = episode('s20e04', 20, 4, false);
        const client = {
            getCurrentUserId: () => 'user',
            getNextUpEpisodes: async () => ({ Items: [normal, rewatch] }),
            getItems: async (_userId, options) => options.ParentId
                ? { Items: [rewatch, nextOlder] }
                : { Items: [episode('s20e03', 20, 3, true, '2026-09-25T10:00:00Z')] }
        };
        const result = await getFamilyDeck(client, {}, 15);
        expect(result.Items.map(item => item.Id)).toEqual(['s20e04']);
    });

    it('keeps partially watched episodes in Continue Watching rather than Deck', async () => {
        const partlyPlayed = episode('s20e03', 20, 3, false, '2026-09-25T10:00:00Z');
        partlyPlayed.UserData.PlaybackPositionTicks = 42;
        const client = {
            getCurrentUserId: () => 'user',
            getNextUpEpisodes: async () => ({ Items: [episode('s24e10', 24, 10, false)] }),
            getItems: async () => ({ Items: [partlyPlayed] })
        };
        const result = await getFamilyDeck(client, {}, 15);
        expect(result.Items).toEqual([]);
    });
});
