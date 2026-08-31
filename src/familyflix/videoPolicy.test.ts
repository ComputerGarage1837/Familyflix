import { describe, expect, it } from 'vitest';
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import { familySearchTypes, isCancelledFamilyRead, isFamilyFavoriteSection, isFamilyHomeSection, isFamilyLibrary, retryFamilyRead } from './videoPolicy';

describe('Family Flix video-first presentation policy', () => {
    it('searches only movies, shows and episodes by default', () => {
        expect(familySearchTypes('video')).toEqual([BaseItemKind.Movie, BaseItemKind.Series, BaseItemKind.Episode]);
        expect(familySearchTypes('video', 'movies')).toEqual([BaseItemKind.Movie]);
        expect(familySearchTypes('video', 'tvshows')).toEqual([BaseItemKind.Series, BaseItemKind.Episode]);
    });
    it('retains people, collections, mixed playlists and books as explicit searches', () => {
        expect(familySearchTypes('people')).toEqual([BaseItemKind.Person]);
        expect(familySearchTypes('collections')).toEqual([BaseItemKind.BoxSet]);
        expect(familySearchTypes('playlists')).toEqual([BaseItemKind.Playlist]);
        expect(familySearchTypes('video', 'books')).toEqual([BaseItemKind.Book, BaseItemKind.AudioBook]);
        expect(familySearchTypes('other')).toContain(BaseItemKind.AudioBook);
        expect(familySearchTypes('other')).not.toContain(BaseItemKind.Audio);
        expect(familySearchTypes('other')).not.toContain(BaseItemKind.LiveTvChannel);
    });
    it('excludes unused music and Live TV libraries without removing video audio or spoken books', () => {
        for (const CollectionType of ['music', 'musicvideos', 'livetv'] as const) {
            expect(isFamilyLibrary({ CollectionType })).toBe(false);
        }
        expect(isFamilyLibrary({ CollectionType: 'books', Type: BaseItemKind.AudioBook })).toBe(true);
        expect(isFamilyLibrary({ CollectionType: 'books', Type: BaseItemKind.Audio })).toBe(true);
        expect(isFamilyLibrary({ Type: BaseItemKind.Movie, MediaStreams: [{ Type: 'Audio' }] })).toBe(true);
        expect(isFamilyLibrary({ CollectionType: 'playlists', Type: BaseItemKind.Playlist })).toBe(true);
    });
    it('avoids the five unused Favorites reads while keeping video, people and books intact', () => {
        for (const type of ['MusicVideo', 'MusicArtist', 'MusicAlbum', 'Audio', 'LiveTVChannel']) {
            expect(isFamilyFavoriteSection(type)).toBe(false);
        }
        for (const type of ['Movie', 'Series', 'Season', 'Episode', 'Person', 'Playlist', 'Book', 'AudioBook', 'BoxSet']) {
            expect(isFamilyFavoriteSection(type)).toBe(true);
        }
    });
    it('keeps video/resume-book sections while excluding TV and music home jobs', () => {
        for (const section of ['resume', 'resumebook', 'nextup', 'latestmedia']) expect(isFamilyHomeSection(section)).toBe(true);
        for (const section of ['resumeaudio', 'livetv', 'activerecordings']) expect(isFamilyHomeSection(section)).toBe(false);
    });
    it('permits one bounded retry for transient failure but none for authorization or missing resources', () => {
        for (const status of [0, 408, 429, 500, 502, 503, 504]) expect(retryFamilyRead(0, { status })).toBe(true);
        for (const status of [400, 401, 403, 404]) expect(retryFamilyRead(0, { response: { status } })).toBe(false);
        expect(retryFamilyRead(0, new TypeError('network failure'))).toBe(true);
        expect(retryFamilyRead(1, new TypeError('network failure'))).toBe(false);
        expect(retryFamilyRead(2, { status: 503 })).toBe(false);
    });
    it('distinguishes SDK/browser cancellation from an error that needs recovery', () => {
        for (const name of ['AbortError', 'CanceledError']) {
            expect(isCancelledFamilyRead({ name })).toBe(true);
            expect(retryFamilyRead(0, { name })).toBe(false);
        }
        expect(isCancelledFamilyRead(new Error('offline'))).toBe(false);
    });
});
