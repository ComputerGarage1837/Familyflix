import { describe, expect, it } from 'vitest';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import { eligibleDeckEpisodes } from './deckPolicy';

const episode = (id: string, seriesId: string, played = false, position = 0): BaseItemDto => ({
    Id: id, SeriesId: seriesId, Type: 'Episode', UserData: { Played: played, PlaybackPositionTicks: position }
}) as BaseItemDto;

describe('Family Flix Deck', () => {
    it('never shows watched or resumable episodes', () => {
        expect(eligibleDeckEpisodes([
            episode('watched', 'a', true), episode('partial', 'b', false, 100),
            episode('next', 'a'), episode('duplicate', 'a'), episode('other', 'b')
        ], 10).map(item => item.Id)).toEqual(['next', 'other']);
    });

    it('keeps at most the requested number of distinct shows', () => {
        expect(eligibleDeckEpisodes([episode('a', 'a'), episode('b', 'b')], 1).map(item => item.Id))
            .toEqual(['a']);
    });
});
