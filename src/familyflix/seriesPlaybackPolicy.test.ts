import { describe, expect, it } from 'vitest';
import { SERIES_DEFAULTS, seriesIdForItem } from './seriesPreferencePolicy';
import { seriesPlaybackIdentity, sharedIntroAction, sharedSeriesTrackOptions } from './seriesPlaybackPolicy';

const streams = [
    { Type: 'Audio' as const, Index: 7, Language: 'eng' },
    { Type: 'Audio' as const, Index: 9, Language: 'jpn' },
    { Type: 'Subtitle' as const, Index: 13, Language: 'eng', IsForced: true },
    { Type: 'Subtitle' as const, Index: 15, Language: 'eng', IsForced: false }
];
const values = { ...SERIES_DEFAULTS, audioMode: 'PREFER_LANGUAGE', preferredAudioLanguage: 'jpn',
    subtitleMode: 'FULL', preferredSubtitleLanguage: 'eng' };

describe('per-show browser playback integration policy', () => {
    it('retains episode type and parent identity for the actual segment-settings lookup', () => {
        const item = { Id: null, Type: 'Episode', SeriesId: 'aaaaaaaaBBBB4ccc8dddEEEEeeeeeeee' };
        expect(seriesIdForItem(seriesPlaybackIdentity(item))).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
        expect(seriesIdForItem(seriesPlaybackIdentity({ ...item, Type: 'Movie' }))).toBeUndefined();
    });
    it('uses actual fresh stream indices, never array offsets', () => {
        expect(sharedSeriesTrackOptions(values, streams, {})).toMatchObject({ audioStreamIndex: 9, subtitleStreamIndex: 15 });
    });
    it('does not override explicit choices from the playback caller', () => {
        expect(sharedSeriesTrackOptions(values, streams, { audioStreamIndex: 7, subtitleStreamIndex: -1 }))
            .toMatchObject({ audioStreamIndex: undefined, subtitleStreamIndex: undefined });
    });
    it('can override generated detail defaults but not manually selected detail tracks', () => {
        expect(sharedSeriesTrackOptions(values, streams, { audioStreamIndex: 7, familyExplicitAudio: false }).audioStreamIndex).toBe(9);
        expect(sharedSeriesTrackOptions(values, streams, { audioStreamIndex: 7, familyExplicitAudio: true }).audioStreamIndex).toBeUndefined();
    });
    it('clears the secondary subtitle when the show says Off', () => {
        expect(sharedSeriesTrackOptions({ ...values, subtitleMode: 'OFF' }, streams, {}))
            .toMatchObject({ subtitleStreamIndex: -1, clearSecondarySubtitle: true });
    });
    it('does not clear an explicitly chosen subtitle', () => {
        expect(sharedSeriesTrackOptions({ ...values, subtitleMode: 'OFF' }, streams, { subtitleStreamIndex: 15 }))
            .toMatchObject({ subtitleStreamIndex: undefined, clearSecondarySubtitle: false });
    });
    it('does not select an unrelated track when the preferred language is missing', () => {
        expect(sharedSeriesTrackOptions({ ...values, preferredAudioLanguage: 'deu' }, streams, {}).audioStreamIndex).toBeUndefined();
    });
    it('preserves app-default Ask and never applies intro overrides to outros', () => {
        expect(sharedIntroAction(SERIES_DEFAULTS, 'Intro', 'AskToSkip')).toBe('AskToSkip');
        expect(sharedIntroAction({ ...values, introSkipMode: 'AUTO_SKIP' }, 'Outro', 'AskToSkip')).toBe('AskToSkip');
    });
    it('supports each explicit intro setting', () => {
        expect(sharedIntroAction({ ...values, introSkipMode: 'ASK' }, 'Intro', 'Skip')).toBe('AskToSkip');
        expect(sharedIntroAction({ ...values, introSkipMode: 'AUTO_SKIP' }, 'Intro', 'None')).toBe('Skip');
        expect(sharedIntroAction({ ...values, introSkipMode: 'DO_NOT_SKIP' }, 'Intro', 'AskToSkip')).toBe('None');
    });
});
