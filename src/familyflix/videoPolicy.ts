import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';

// Client presentation only. Never change server libraries, access rules or media.
export const isFamilyLibrary = (item: BaseItemDto) =>
    !['music', 'musicvideos', 'livetv'].includes(item.CollectionType || '')
    && !['LiveTvChannel', 'LiveTvProgram', 'TvChannel', 'MusicArtist', 'MusicAlbum', 'MusicVideo'].includes(item.Type || '');

export const isFamilyHomeSection = (section: string) =>
    !['resumeaudio', 'livetv', 'activerecordings'].includes(section);

// The legacy "Audio" Favorites section is explicitly Songs, not video tracks or the Books library.
export const isFamilyFavoriteSection = (type: string) =>
    !['MusicVideo', 'MusicArtist', 'MusicAlbum', 'Audio', 'LiveTVChannel', 'LiveTvChannel', 'TvChannel'].includes(type);

export type FamilySearchFilter = 'video' | 'people' | 'playlists' | 'collections' | 'other';

export function familySearchTypes(filter: FamilySearchFilter, collectionType?: CollectionType): BaseItemKind[] {
    if (filter === 'people') return [BaseItemKind.Person];
    if (filter === 'playlists') return [BaseItemKind.Playlist];
    if (filter === 'collections') return [BaseItemKind.BoxSet];
    if (filter === 'other') return [BaseItemKind.Video, BaseItemKind.Book, BaseItemKind.AudioBook, BaseItemKind.Photo, BaseItemKind.PhotoAlbum];
    if (collectionType === 'movies') return [BaseItemKind.Movie];
    if (collectionType === 'tvshows') return [BaseItemKind.Series, BaseItemKind.Episode];
    if (collectionType === 'books') return [BaseItemKind.Book, BaseItemKind.AudioBook];
    return [BaseItemKind.Movie, BaseItemKind.Series, BaseItemKind.Episode];
}

export function retryFamilyRead(failureCount: number, error: unknown): boolean {
    const failure = error as { name?: string; status?: number; response?: { status?: number } } | undefined;
    const status = failure?.response?.status ?? failure?.status;
    return failureCount < 1 && !isCancelledFamilyRead(error)
        && (status === undefined || status === 0 || status === 408 || status === 429 || status >= 500);
}

export function isCancelledFamilyRead(error: unknown): boolean {
    const name = (error as { name?: string } | undefined)?.name;
    return name === 'AbortError' || name === 'CanceledError';
}
