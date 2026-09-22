import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from 'jellyfin-apiclient';
import { expandPlaylistIds, playlistBatches } from './playlistExpansion';

describe('mixed Family Flix playlists', () => {
    it('expands shows while keeping movie and episode order', async () => {
        const getItem = vi.fn(async (_user, id) => ({ Type: id === 'show' ? 'Series' : 'Movie' }));
        const getItems = vi.fn(async () => ({ Items: [
            { Id: 'show-e1' }, { Id: 'show-e2' }, { Id: 'missing', IsPlaceHolder: true }
        ] }));
        const client = { getCurrentUserId: () => 'user', getItem, getItems } as unknown as ApiClient;
        expect(await expandPlaylistIds(client, ['movie', 'show', 'episode']))
            .toEqual(['movie', 'show-e1', 'show-e2', 'episode']);
        expect(getItems).toHaveBeenCalledWith('user', expect.objectContaining({
            ParentId: 'show', IncludeItemTypes: 'Episode', IsMissing: false
        }));
    });

    it('does not insert an unplayable series folder', async () => {
        const client = {
            getCurrentUserId: () => 'user', getItem: async () => ({ Type: 'Series' }),
            getItems: async () => ({ Items: [] })
        } as unknown as ApiClient;
        await expect(expandPlaylistIds(client, ['show'])).rejects.toThrow('no playable episodes');
    });

    it('batches additions without changing their order', () => {
        expect(playlistBatches(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
    });
});
