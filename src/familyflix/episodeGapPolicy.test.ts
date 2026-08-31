import { describe, expect, it } from 'vitest';
import {
    calculateEpisodeGaps, formatEpisodeNumbers, gapsBeforeEpisode, seasonNumberFor, type NumberedEpisode
} from './episodeGapPolicy';

const SERIES = '10000000-0000-4000-8000-000000000001';
const episode = (index: number, patch: Partial<NumberedEpisode> = {}): NumberedEpisode => ({
    Type: 'Episode' as const, SeriesId: SERIES, ParentIndexNumber: 1, IndexNumber: index, ...patch
});

describe('complete season gap policy', () => {
    it('includes watched and combined episodes while excluding known future numbers', () => {
        const result = calculateEpisodeGaps([
            episode(1, { UserData: { Played: true } }),
            episode(3, { IndexNumberEnd: 4 }),
            episode(5, { PremiereDate: '2026-01-01T00:00:00Z' }),
            episode(6, { IsVirtualItem: true, PremiereDate: '2020-01-01T00:00:00Z' }),
            episode(7, { IsVirtualItem: true }),
            episode(8, { IsUnaired: true })
        ], 1, true, Date.parse('2025-01-01T00:00:00Z'));
        expect(result).toEqual({ state: 'known', seasonNumber: 1, missing: [2, 6], highestKnown: 6 });
    });

    it('does not claim completeness from partial inventory or specials', () => {
        expect(calculateEpisodeGaps([episode(1)], 1, false).state).toBe('unavailable');
        expect(calculateEpisodeGaps([episode(1)], 0, true).state).toBe('not-applicable');
        expect(calculateEpisodeGaps([episode(1)], Number.NaN, true).state).toBe('unavailable');
    });

    it('warns only for proven holes crossed by this start/jump', () => {
        const result = calculateEpisodeGaps([episode(1), episode(3, { IndexNumberEnd: 4 }), episode(6)], 1, true);
        expect(result.missing).toEqual([2, 5]);
        expect(gapsBeforeEpisode(result, episode(3), episode(1))).toEqual([2]);
        expect(gapsBeforeEpisode(result, episode(6), episode(3, { IndexNumberEnd: 4 }))).toEqual([5]);
        expect(gapsBeforeEpisode(result, episode(3), episode(6))).toEqual([]);
        expect(gapsBeforeEpisode(result, episode(6, { SeriesId: '10000000-0000-4000-8000-000000000002' }), episode(3))).toEqual([2, 5]);
    });

    it('reads the season number from both season and episode DTOs and formats ranges', () => {
        expect(seasonNumberFor({ Type: 'Season', IndexNumber: 2 })).toBe(2);
        expect(seasonNumberFor(episode(1))).toBe(1);
        expect(formatEpisodeNumbers([5, 2, 3, 2, 8])).toBe('2–3, 5, 8');
    });
});
