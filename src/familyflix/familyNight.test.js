import { describe, expect, it } from 'vitest';

import { matchingCandidates, pickCandidate, requiredAge } from './familyNightPicker';

const movie = (id, rating, minutes, genres = []) => ({
    Id: id, Type: 'Movie', OfficialRating: rating, RunTimeTicks: minutes * 600000000, Genres: genres
});

describe('Family Night', () => {
    it('uses Android-compatible rating limits', () => {
        expect(requiredAge('TV-MA')).toBe(17);
        expect(requiredAge('PG-13')).toBe(13);
        expect(requiredAge('not rated')).toBeNull();
    });

    it('filters unknown ratings conservatively and rerolls away from the previous title', () => {
        const items = [movie('one', 'PG-13', 100, ['Comedy']), movie('two', 'PG', 90, ['Comedy']),
            movie('three', null, 80, ['Comedy'])];
        const filter = { media: 'Movies', runtime: 120, genre: 'Comedy', age: 13 };
        expect(matchingCandidates(items, filter).map(item => item.Id)).toEqual(['one', 'two']);
        expect(pickCandidate(items, filter, 'one', () => 0).Id).toBe('two');
    });
});
