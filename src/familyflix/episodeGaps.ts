import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';
import { familyRequest, type FamilySession } from './familySession';
import { canonicalGuid } from './seriesPreferencePolicy';
import { calculateEpisodeGaps, seasonNumberFor, type EpisodeGapResult, type NumberedEpisode } from './episodeGapPolicy';
import { objectValue } from './issuePolicy';

const cache = new Map<string, { at: number; result: EpisodeGapResult }>();
const flights = new Map<string, { session: FamilySession; promise: Promise<EpisodeGapResult> }>();

/** Complete, explicitly paged season inventory. Never use unwatched/Deck queries. */
export async function loadEpisodeGaps(item: BaseItemDto, session: FamilySession, force = false): Promise<EpisodeGapResult> {
    const seasonNumber = seasonNumberFor(item);
    const empty = calculateEpisodeGaps([], seasonNumber, false);
    if (!['Episode', 'Season'].includes(item.Type || '') || seasonNumber === 0) return { ...empty, state: 'not-applicable' };
    const seriesId = canonicalGuid(item.SeriesId);
    const seasonId = canonicalGuid(item.Type === 'Season' ? item.Id : item.SeasonId);
    if (!seriesId || !seasonId || !session.current()) return empty;
    const key = session.key + ':' + seriesId + ':' + seasonId;
    const cached = cache.get(key);
    if (!force && cached && Date.now() - cached.at >= 0 && Date.now() - cached.at < 30_000) return cached.result;
    const previous = flights.get(key);
    if (previous?.session.current()) return previous.promise;
    // eslint-disable-next-line sonarjs/cognitive-complexity -- Pagination fails closed at each completeness invariant.
    const promise = (async () => {
        const deadline = Date.now() + 1200;
        const episodes: NumberedEpisode[] = [];
        let total: number | undefined;
        try {
            for (let page = 0; page < 10; page++) {
                if (!session.current() || Date.now() >= deadline) return empty;
                const dto = objectValue(await familyRequest(session, 'Shows/' + seriesId + '/Episodes', {
                    query: {
                        userId: session.userId, seasonId, StartIndex: String(episodes.length), Limit: '200',
                        EnableTotalRecordCount: 'true', Fields: 'PremiereDate', EnableImages: 'false'
                    }, timeout: deadline - Date.now()
                }));
                if (!Array.isArray(dto.Items) || !Number.isSafeInteger(dto.TotalRecordCount) || Number(dto.TotalRecordCount) < 0) return empty;
                if (total !== undefined && total !== dto.TotalRecordCount) return empty;
                total = Number(dto.TotalRecordCount);
                if (dto.Items.length === 0 && episodes.length < total) return empty;
                episodes.push(...dto.Items as NumberedEpisode[]);
                if (episodes.length > total) return empty;
                if (episodes.length === total && session.current()) {
                    const result = calculateEpisodeGaps(episodes, seasonNumber, true);
                    cache.set(key, { at: Date.now(), result });
                    while (cache.size > 100) cache.delete(cache.keys().next().value!);
                    return result;
                }
            }
        } catch { /* Partial/error inventories must not be labeled complete. */ }
        return empty;
    })();
    const flight = { session, promise };
    flights.set(key, flight);
    try {
        return await promise;
    } finally {
        if (flights.get(key) === flight) flights.delete(key);
    }
}
