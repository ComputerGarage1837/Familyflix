import { describe, expect, it } from 'vitest';

import { mergeGroupDecks } from './groupDeck';

const episode = (id, season, number, played = false) => ({
    Id: id, SeriesId: 'show', ParentIndexNumber: season, IndexNumber: number, UserData: { Played: played }
});

describe('Watching Together group Deck', () => {
    it('keeps different progress points but deduplicates the same episode', () => {
        const merged = mergeGroupDecks([
            [episode('a', 20, 4), episode('b', 20, 5)],
            [episode('c', 20, 4), episode('d', 24, 1)]
        ], 10);
        expect(merged.map(item => item.Id)).toEqual(['a', 'b', 'd']);
    });

    it('never displays watched episodes', () => {
        expect(mergeGroupDecks([[episode('watched', 2, 1, true)]], 10)).toEqual([]);
    });
});
