import type { BaseItemDto, MediaStream } from '@jellyfin/sdk/lib/generated-client';

export const SERIES_DEFAULTS = {
    audioMode: 'SERVER_DEFAULT', preferredAudioLanguage: '',
    subtitleMode: 'SERVER_DEFAULT', preferredSubtitleLanguage: '',
    introSkipMode: 'APP_DEFAULT', autoplayMode: 'APP_DEFAULT'
};
export type SeriesKey = keyof typeof SERIES_DEFAULTS;
// Compatible future portable fields must survive read/modify/write by an older client.
export type SeriesValues = typeof SERIES_DEFAULTS & Record<string, string>;
export type SeriesDocument = {
    version: number; revision: number; updatedAtEpochMillis: number;
    writerDeviceId: string; values: SeriesValues;
};
export type SeriesCache = {
    base: SeriesDocument | null;
    baseObserved: boolean;
    values: SeriesValues;
    dirty: SeriesKey[];
    pendingSeed: boolean;
    editSequence: number;
    fieldEditVersions: Partial<Record<SeriesKey, string>>;
};
export const SERIES_KEYS = Object.keys(SERIES_DEFAULTS) as SeriesKey[];
const MODES: Partial<Record<SeriesKey, string[]>> = {
    audioMode: ['SERVER_DEFAULT', 'PREFER_LANGUAGE', 'REMEMBER_LAST_SELECTION'],
    subtitleMode: ['SERVER_DEFAULT', 'OFF', 'FORCED_ONLY', 'FULL'],
    introSkipMode: ['APP_DEFAULT', 'ASK', 'AUTO_SKIP', 'DO_NOT_SKIP'],
    autoplayMode: ['APP_DEFAULT', 'PLAY_NEXT', 'STOP_AFTER_EPISODE']
};
const reservedKey = (key: string) => ['__proto__', 'prototype', 'constructor'].includes(key);
export const isSeriesKey = (key: string): key is SeriesKey => Object.prototype.hasOwnProperty.call(SERIES_DEFAULTS, key);

export function canonicalGuid(value?: string | null): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().toLowerCase();
    if (!/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(normalized)) return undefined;
    const hex = normalized.replace(/-/g, '');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}

export function seriesIdForItem(item?: BaseItemDto): string | undefined {
    if (item?.Type === 'Series') return canonicalGuid(item.Id);
    if (item?.Type === 'Episode') return canonicalGuid(item.SeriesId);
    return undefined;
}

/** Normalize known values for use, retaining only string-valued compatible unknown fields. */
export function normalizeSeriesValues(values: Partial<SeriesValues> = {}): SeriesValues {
    const result: SeriesValues = { ...SERIES_DEFAULTS };
    Object.keys(values).forEach(key => {
        const value = values[key];
        if (typeof value !== 'string' || reservedKey(key)) return;
        if (!isSeriesKey(key)) {
            result[key] = value;
        } else if (MODES[key]) {
            if (MODES[key]?.includes(value)) result[key] = value;
        } else { result[key] = value.trim().toLowerCase().slice(0, 32); }
    });
    return result;
}

/** Unlike UI normalization, an unsupported remote schema/value must never be rewritten as defaults. */
export function validateSeriesDocument(value: unknown): SeriesDocument {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid shared show settings');
    const document = value as Partial<SeriesDocument>;
    if (document.version !== 1 || !Number.isSafeInteger(document.revision) || Number(document.revision) < 0
        || Number(document.revision) >= Number.MAX_SAFE_INTEGER || !Number.isSafeInteger(document.updatedAtEpochMillis)
        || Number(document.updatedAtEpochMillis) < 0 || typeof document.writerDeviceId !== 'string' || !document.writerDeviceId.trim()
        || !document.values || typeof document.values !== 'object' || Array.isArray(document.values)) {
        throw new TypeError('Unsupported shared show settings');
    }
    Object.keys(document.values).forEach(key => {
        const field = document.values![key];
        if (reservedKey(key) || typeof field !== 'string' || (isSeriesKey(key) && MODES[key] && !MODES[key]?.includes(field))) {
            throw new TypeError('Unsupported shared show setting value');
        }
    });
    return {
        version: 1, revision: document.revision!, updatedAtEpochMillis: document.updatedAtEpochMillis!,
        writerDeviceId: document.writerDeviceId, values: normalizeSeriesValues(document.values)
    };
}

export function sameSeriesValues(first: SeriesValues, second: SeriesValues): boolean {
    const keys = Object.keys(first);
    return keys.length === Object.keys(second).length && keys.every(key => first[key] === second[key]);
}

export function sameSeriesDocument(first: SeriesDocument | null, second: SeriesDocument | null): boolean {
    if (!first || !second) return first === second;
    return first.version === second.version && first.revision === second.revision
        && first.updatedAtEpochMillis === second.updatedAtEpochMillis && first.writerDeviceId === second.writerDeviceId
        && sameSeriesValues(first.values, second.values);
}

export function emptySeriesCache(): SeriesCache {
    return {
        base: null, baseObserved: false, values: { ...SERIES_DEFAULTS }, dirty: [],
        pendingSeed: false, editSequence: 0, fieldEditVersions: {}
    };
}

export function mergeSeriesValues(local: SeriesCache, remote: SeriesDocument | null): { values: SeriesValues; conflicts: SeriesKey[] } {
    if (!remote) return { values: normalizeSeriesValues(local.values), conflicts: [] };
    const remoteValues = normalizeSeriesValues(remote.values);
    if (!local.baseObserved) {
        return {
            values: remoteValues,
            conflicts: local.dirty.filter(key => local.values[key] !== remoteValues[key])
        };
    }
    const baseValues = normalizeSeriesValues(local.base?.values || SERIES_DEFAULTS);
    const values = { ...remoteValues };
    const conflicts: SeriesKey[] = [];
    local.dirty.filter(isSeriesKey).forEach(key => {
        if (remoteValues[key] === local.values[key]) return;
        if (remoteValues[key] !== baseValues[key]) conflicts.push(key);
        else values[key] = local.values[key];
    });
    return { values, conflicts };
}

/** Only known portable keys can be edited; explicit Reset versions every key, even an unchanged default. */
export function editSeriesCache(local: SeriesCache, patch: Partial<SeriesValues>, editId: string, reset = false): SeriesCache {
    const requested: Partial<SeriesValues> = {};
    SERIES_KEYS.forEach(key => {
        if (reset) {
            requested[key] = SERIES_DEFAULTS[key];
        } else if (Object.prototype.hasOwnProperty.call(patch, key)) {
            const value = patch[key];
            if (typeof value !== 'string' || (MODES[key] && !MODES[key]?.includes(value))) {
                throw new TypeError('Unsupported show setting edit');
            }
            requested[key] = value;
        }
    });
    const values = normalizeSeriesValues({ ...local.values, ...requested });
    const dirty = new Set(local.dirty);
    const fieldEditVersions = { ...local.fieldEditVersions };
    SERIES_KEYS.forEach(key => {
        if (reset || values[key] !== local.values[key]) {
            dirty.add(key);
            fieldEditVersions[key] = editId;
        }
    });
    return { ...local, values, dirty: Array.from(dirty), fieldEditVersions, editSequence: local.editSequence + 1 };
}

export function settledSeriesCache(local: SeriesCache, snapshot: SeriesCache, document: SeriesDocument | null): SeriesCache {
    const dirty = SERIES_KEYS.filter(key => local.fieldEditVersions[key] !== snapshot.fieldEditVersions[key]);
    const values = normalizeSeriesValues(document?.values || SERIES_DEFAULTS);
    dirty.forEach(key => {
        values[key] = local.values[key];
    });
    return { ...local, base: document, baseObserved: true, values, dirty, pendingSeed: false };
}

export function seriesTrackChoices(values: SeriesValues, streams: MediaStream[] = []) {
    const choices = normalizeSeriesValues(values);
    const tracks = Array.isArray(streams) ? streams : [];
    const languageMatches = (stream: MediaStream, language: string) => !language || stream.Language?.trim().toLowerCase() === language;
    const audio = choices.audioMode !== 'SERVER_DEFAULT' && choices.preferredAudioLanguage ?
        tracks.find(stream => stream.Type === 'Audio' && languageMatches(stream, choices.preferredAudioLanguage))?.Index : undefined;
    let subtitle: number | undefined;
    if (choices.subtitleMode === 'OFF') subtitle = -1;
    if (choices.subtitleMode === 'FORCED_ONLY') {
        subtitle = tracks.find(stream => stream.Type === 'Subtitle'
        && stream.IsForced && languageMatches(stream, choices.preferredSubtitleLanguage))?.Index ?? -1;
    }
    if (choices.subtitleMode === 'FULL') {
        subtitle = tracks.find(stream => stream.Type === 'Subtitle'
        && !stream.IsForced && languageMatches(stream, choices.preferredSubtitleLanguage))?.Index;
    }
    return { audio, subtitle };
}

export const seriesAutoplayAllowed = (values: SeriesValues, appDefault: boolean) => {
    const mode = normalizeSeriesValues(values).autoplayMode;
    return mode === 'APP_DEFAULT' ? appDefault : mode === 'PLAY_NEXT';
};
