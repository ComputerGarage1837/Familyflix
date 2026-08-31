import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';
import { canonicalGuid } from './seriesPreferencePolicy';

export type NumberedEpisode = BaseItemDto & { IsVirtualItem?: boolean; IsMissing?: boolean; IsUnaired?: boolean };
export type EpisodeGapResult = {
    state: 'known' | 'unavailable' | 'not-applicable'; seasonNumber: number; missing: number[]; highestKnown: number;
};
const MAX_EPISODE_NUMBER = 10_000;

function number(value: unknown): number | undefined {
    return Number.isInteger(value) && Number(value) > 0 && Number(value) <= MAX_EPISODE_NUMBER ? Number(value) : undefined;
}

export function seasonNumberFor(item: BaseItemDto): number {
    const value = item.Type === 'Season' ? item.IndexNumber : item.ParentIndexNumber;
    return value == null ? Number.NaN : Number(value);
}

/** Pure numbering only: watched flags never affect coverage or create Deck entries. */
export function calculateEpisodeGaps(items: NumberedEpisode[], seasonNumber: number, complete: boolean, now = Date.now()): EpisodeGapResult {
    const result: EpisodeGapResult = { state: 'known', seasonNumber, missing: [], highestKnown: 0 };
    if (seasonNumber === 0) return { ...result, state: 'not-applicable' };
    if (!complete || !number(seasonNumber) || !Number.isFinite(now)) return { ...result, state: 'unavailable' };
    const covered = new Set<number>();
    const future = new Set<number>();
    // eslint-disable-next-line sonarjs/cognitive-complexity -- Each branch represents one explicit inventory exclusion in the contract.
    items.forEach(item => {
        if (item.Type && item.Type !== 'Episode') return;
        if (item.ParentIndexNumber != null && item.ParentIndexNumber !== seasonNumber) return;
        const start = number(item.IndexNumber);
        const end = item.IndexNumberEnd == null ? start : number(item.IndexNumberEnd);
        if (!start || !end || end < start) return;
        const premiere = item.PremiereDate ? Date.parse(item.PremiereDate) : NaN;
        const unaired = item.IsUnaired === true || (Number.isFinite(premiere) && premiere > now);
        if (unaired) {
            for (let episode = start; episode <= end; episode++) future.add(episode);
            return;
        }
        const virtual = item.IsVirtualItem || item.IsMissing || item.IsPlaceHolder || item.LocationType === 'Virtual';
        // An undated virtual placeholder cannot establish a guessed season end.
        if (virtual && !Number.isFinite(premiere)) return;
        result.highestKnown = Math.max(result.highestKnown, end);
        if (!virtual) for (let episode = start; episode <= end; episode++) covered.add(episode);
    });
    for (let episode = 1; episode <= result.highestKnown; episode++) {
        if (!covered.has(episode) && !future.has(episode)) result.missing.push(episode);
    }
    return result;
}

export function gapsBeforeEpisode(result: EpisodeGapResult, next: BaseItemDto, previous?: BaseItemDto | null): number[] {
    const nextStart = number(next.IndexNumber);
    if (result.state !== 'known' || next.Type !== 'Episode' || !nextStart || seasonNumberFor(next) !== result.seasonNumber) return [];
    const sameSeason = previous?.Type === 'Episode' && seasonNumberFor(previous) === result.seasonNumber
        && !!canonicalGuid(next.SeriesId) && canonicalGuid(previous.SeriesId) === canonicalGuid(next.SeriesId);
    const previousEnd = sameSeason ? number(previous!.IndexNumberEnd ?? previous!.IndexNumber) || 0 : 0;
    // Starting a season manually considers proven earlier holes. A backwards jump
    // cannot jump forward over the previous episode's following gap.
    return result.missing.filter(episode => episode > previousEnd && episode < nextStart);
}

export function formatEpisodeNumbers(numbers: number[]): string {
    const sorted = Array.from(new Set(numbers)).sort((first, second) => first - second);
    const ranges: Array<{ start: number; end: number }> = [];
    sorted.forEach(value => {
        const previous = ranges[ranges.length - 1];
        if (previous && previous.end + 1 === value) previous.end = value;
        else ranges.push({ start: value, end: value });
    });
    return ranges.map(range => range.start === range.end ? String(range.start) : `${range.start}–${range.end}`).join(', ');
}
