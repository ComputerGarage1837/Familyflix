import { describe, expect, it } from 'vitest';
import {
    SERIES_DEFAULTS, SERIES_KEYS, canonicalGuid, seriesIdForItem, normalizeSeriesValues, validateSeriesDocument,
    mergeSeriesValues, emptySeriesCache, editSeriesCache, settledSeriesCache, sameSeriesDocument,
    seriesTrackChoices, seriesAutoplayAllowed,
    type SeriesCache, type SeriesDocument, type SeriesValues
} from './seriesPreferencePolicy';

const SHOW = '10000000-0000-0000-0000-000000000001';
const doc = (patch: Partial<SeriesValues> = {}, revision = 1): SeriesDocument => ({
    version: 1, revision, updatedAtEpochMillis: 1000, writerDeviceId: 'android-tv', values: { ...SERIES_DEFAULTS, ...patch } as SeriesValues
});
const based = (base: SeriesDocument | null = doc()): SeriesCache => ({
    ...emptySeriesCache(), base, baseObserved: true, values: { ...(base?.values || SERIES_DEFAULTS) }
});

describe('shared per-series preference policy', () => {
    it('uses only actual canonical show GUIDs for series and episode items', () => {
        expect(canonicalGuid('10000000000000000000000000000001')).toBe(SHOW);
        expect(canonicalGuid('ABCDEF00000000000000000000000001')).toBe('abcdef00-0000-0000-0000-000000000001');
        expect(canonicalGuid('--10000000000000000000000000000001')).toBeUndefined();
        expect(canonicalGuid('not-a-guid')).toBeUndefined();
        expect(seriesIdForItem({ Type: 'Series', Id: SHOW })).toBe(SHOW);
        expect(seriesIdForItem({ Type: 'Episode', Id: 'episode', SeriesId: SHOW })).toBe(SHOW);
        expect(seriesIdForItem({ Type: 'Movie', SeriesId: SHOW })).toBeUndefined();
        expect(seriesIdForItem({ Type: 'Episode' })).toBeUndefined();
    });

    it('normalizes portable language intent and preserves compatible unknown strings', () => {
        expect(normalizeSeriesValues({ preferredAudioLanguage: ' JPN ', futurePortableMode: 'Quiet' })).toEqual({
            ...SERIES_DEFAULTS, preferredAudioLanguage: 'jpn', futurePortableMode: 'Quiet'
        });
        expect(normalizeSeriesValues({ preferredSubtitleLanguage: 'A'.repeat(40) }).preferredSubtitleLanguage).toHaveLength(32);
    });

    it('rejects unsupported remote schemas and enum values instead of silently replacing them with defaults', () => {
        expect(() => validateSeriesDocument({ ...doc(), version: 2 })).toThrow();
        expect(() => validateSeriesDocument(doc({ introSkipMode: 'FUTURE_SKIP' }))).toThrow();
        expect(() => validateSeriesDocument({ ...doc(), values: { subtitleMode: null } })).toThrow();
        expect(() => validateSeriesDocument({ ...doc(), writerDeviceId: '  ' })).toThrow();
        expect(() => validateSeriesDocument({ ...doc(), revision: Number.MAX_SAFE_INTEGER })).toThrow();
        expect(validateSeriesDocument({ ...doc(), values: { introSkipMode: 'ASK', futurePortableMode: 'quiet' } }).values).toEqual({
            ...SERIES_DEFAULTS, introSkipMode: 'ASK', futurePortableMode: 'quiet'
        });
    });

    it('distinguishes an unverified first pull from a successfully observed missing document', () => {
        const pending = editSeriesCache(emptySeriesCache(), { preferredAudioLanguage: 'eng' }, 'first');
        const remote = doc({ subtitleMode: 'OFF' });
        expect(mergeSeriesValues(pending, remote).values.preferredAudioLanguage).toBe('');
        const observedMissing = { ...pending, baseObserved: true };
        expect(mergeSeriesValues(observedMissing, remote)).toEqual({
            values: { ...SERIES_DEFAULTS, subtitleMode: 'OFF', preferredAudioLanguage: 'eng' }, conflicts: []
        });
    });

    it('keeps newer server conflicts and merges independent edits without dropping future fields', () => {
        const local = editSeriesCache(based(), { introSkipMode: 'AUTO_SKIP', subtitleMode: 'OFF' }, 'local');
        expect(mergeSeriesValues(local, doc({ introSkipMode: 'ASK', futurePortableMode: 'quiet' }, 2))).toEqual({
            values: { ...SERIES_DEFAULTS, introSkipMode: 'ASK', subtitleMode: 'OFF', futurePortableMode: 'quiet' },
            conflicts: ['introSkipMode']
        });
        expect(mergeSeriesValues(local, doc({ introSkipMode: 'AUTO_SKIP', subtitleMode: 'OFF' }, 2)).conflicts).toEqual([]);
    });

    it('reset versions every portable key and a previous acknowledgement cannot consume that newer reset', () => {
        const snapshot = editSeriesCache(based(), { audioMode: 'PREFER_LANGUAGE' }, 'edit');
        const reset = editSeriesCache(snapshot, {}, 'reset', true);
        expect(reset.dirty).toEqual(expect.arrayContaining(SERIES_KEYS));
        const settled = settledSeriesCache(reset, snapshot, doc({ audioMode: 'PREFER_LANGUAGE', subtitleMode: 'OFF' }, 2));
        expect(settled.values).toEqual(SERIES_DEFAULTS);
        expect(settled.dirty).toEqual(SERIES_KEYS);
        expect(settled.baseObserved).toBe(true);
    });

    it('ignores device/play-state edits and rejects an invalid explicit mode edit', () => {
        const edited = editSeriesCache(based(), {
            decoder: 'software', bitrate: '100', audioOutput: 'passthrough', subtitleDelayMillis: '500', played: 'true'
        }, 'bad-fields');
        expect(edited.values).toEqual(SERIES_DEFAULTS);
        expect(edited.dirty).toEqual([]);
        expect(() => editSeriesCache(based(), { autoplayMode: 'FUTURE' }, 'bad')).toThrow();
    });

    it('compares full document content, not just revision or property order', () => {
        const original = doc();
        const reordered = { ...original, values: Object.fromEntries(Object.entries(original.values).reverse()) as SeriesValues };
        expect(sameSeriesDocument(original, reordered)).toBe(true);
        expect(sameSeriesDocument(original, { ...original, values: { ...original.values, introSkipMode: 'ASK' } })).toBe(false);
        expect(sameSeriesDocument(original, { ...original, writerDeviceId: 'other-tv' })).toBe(false);
    });

    it('resolves only requested track overrides and preserves profile defaults', () => {
        const streams = [
            { Type: 'Audio' as const, Index: 1, Language: 'eng' },
            { Type: 'Audio' as const, Index: 2, Language: 'JPN' },
            { Type: 'Subtitle' as const, Index: 3, Language: 'eng', IsForced: true },
            { Type: 'Subtitle' as const, Index: 4, Language: 'eng', IsForced: false }
        ];
        expect(seriesTrackChoices({ ...SERIES_DEFAULTS, preferredAudioLanguage: 'jpn' }, streams)).toEqual({ audio: undefined, subtitle: undefined });
        expect(seriesTrackChoices({ ...SERIES_DEFAULTS, audioMode: 'PREFER_LANGUAGE', preferredAudioLanguage: 'jpn', subtitleMode: 'FORCED_ONLY' }, streams))
            .toEqual({ audio: 2, subtitle: 3 });
        expect(seriesTrackChoices({ ...SERIES_DEFAULTS, subtitleMode: 'FULL' }, streams).subtitle).toBe(4);
        expect(seriesTrackChoices({ ...SERIES_DEFAULTS, subtitleMode: 'FORCED_ONLY', preferredSubtitleLanguage: 'fra' }, streams).subtitle).toBe(-1);
        expect(seriesTrackChoices({ ...SERIES_DEFAULTS, subtitleMode: 'OFF' }, streams).subtitle).toBe(-1);
    });

    it('retains app-default, ask-to-skip and explicit autoplay behavior', () => {
        expect(SERIES_DEFAULTS.introSkipMode).toBe('APP_DEFAULT');
        expect(validateSeriesDocument(doc({ introSkipMode: 'ASK' })).values.introSkipMode).toBe('ASK');
        expect(seriesAutoplayAllowed(SERIES_DEFAULTS, false)).toBe(false);
        expect(seriesAutoplayAllowed(SERIES_DEFAULTS, true)).toBe(true);
        expect(seriesAutoplayAllowed({ ...SERIES_DEFAULTS, autoplayMode: 'STOP_AFTER_EPISODE' }, true)).toBe(false);
        expect(seriesAutoplayAllowed({ ...SERIES_DEFAULTS, autoplayMode: 'PLAY_NEXT' }, false)).toBe(true);
    });
});
