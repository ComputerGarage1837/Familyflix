import { describe, expect, it } from 'vitest';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';
import { matchesFamilyNight, mergeFamilyNightCandidates, pickFamilyNight, requiredAge, toFamilyNightCandidate } from './familyNightPolicy';

const item = (id: string, type: 'Movie' | 'Series', rating?: string): BaseItemDto => ({
    Id: id, Type: type, Name: id, OfficialRating: rating,
    RunTimeTicks: 90 * 600_000_000, Genres: ['Drama']
});

describe('Family Night picker', () => {
    it('uses the same conservative age and runtime rules as the TV client', () => {
        expect(requiredAge('CA-TV-PG')).toBe(10);
        expect(requiredAge('PG-13')).toBe(13);
        expect(requiredAge('unrated')).toBeUndefined();
        const candidate = toFamilyNightCandidate(item('one', 'Movie', 'PG-13'), 'Dylan')!;
        expect(candidate.runtimeMinutes).toBe(90);
        expect(matchesFamilyNight(candidate, { media: 'movie', maxRequiredAge: 12 })).toBe(false);
        expect(matchesFamilyNight(candidate, { media: 'show' })).toBe(false);
        expect(matchesFamilyNight(candidate, { media: 'all', genre: 'drama', maxRuntimeMinutes: 90 })).toBe(true);
    });

    it('merges duplicate picks and excludes the previous pick when rerolling', () => {
        const first = toFamilyNightCandidate(item('a', 'Movie'), 'Dylan')!;
        const duplicate = toFamilyNightCandidate(item('a', 'Movie'), 'Amanda')!;
        const second = toFamilyNightCandidate(item('b', 'Series'), 'Dylan')!;
        const merged = mergeFamilyNightCandidates([first, duplicate, second]);
        expect(merged).toHaveLength(2);
        expect(merged[0].profiles).toEqual(['Dylan', 'Amanda']);
        expect(pickFamilyNight(merged, { media: 'all' }, 'a', () => 0)?.id).toBe('b');
        expect(pickFamilyNight(merged, { media: 'movie' }, 'a', () => 0)?.id).toBe('a');
    });
});
