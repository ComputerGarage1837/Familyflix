import type { ApiClient } from 'jellyfin-apiclient';

const EPISODE_LIMIT = 10000;

/** Jellyfin playlists queue videos, not Series folders. Preserve every other item type. */
export async function expandPlaylistIds(client: ApiClient, ids: string[]): Promise<string[]> {
    const userId = client.getCurrentUserId();
    const expanded: string[] = [];
    for (const itemId of ids.filter(Boolean)) {
        const item = await client.getItem(userId, itemId);
        if (item.Type !== 'Series') {
            expanded.push(itemId);
            continue;
        }
        const result = await client.getItems(userId, {
            ParentId: itemId,
            IncludeItemTypes: 'Episode',
            Recursive: true,
            IsMissing: false,
            SortBy: 'ParentIndexNumber,IndexNumber',
            SortOrder: 'Ascending',
            Limit: EPISODE_LIMIT
        });
        const episodes = (result.Items || []).filter(episode => episode.Id && !episode.IsPlaceHolder)
            .map(episode => episode.Id!);
        if (!episodes.length) throw new Error('This show has no playable episodes to add.');
        if (episodes.length >= EPISODE_LIMIT) throw new Error('This show has too many episodes for one playlist action.');
        expanded.push(...episodes);
    }
    return expanded;
}

export function playlistBatches(ids: string[], size = 100): string[][] {
    const batches: string[][] = [];
    for (let index = 0; index < ids.length; index += size) batches.push(ids.slice(index, index + size));
    return batches;
}
