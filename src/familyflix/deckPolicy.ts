import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';

function seriesKey(item: BaseItemDto): string {
    return item.SeriesId || item.SeriesName?.trim().toLowerCase() || item.Id || '';
}

/** Leave resumable episodes to Continue Watching and never resurface completed ones. */
export function eligibleDeckEpisodes(items: BaseItemDto[], limit: number): BaseItemDto[] {
    const seen = new Set<string>();
    const result: BaseItemDto[] = [];
    for (const item of items) {
        if (item.UserData?.Played === true || Number(item.UserData?.PlaybackPositionTicks || 0) > 0) continue;
        const key = seriesKey(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(item);
        if (result.length >= limit) break;
    }
    return result;
}
