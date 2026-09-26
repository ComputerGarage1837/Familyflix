/* eslint-disable @typescript-eslint/naming-convention -- Android preference wire format. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentPlaybackPreferences, loadPlaybackPreferences, normalizePlaybackPreferences, resumedPosition, savePlaybackPreferences, UninterruptedEpisodes } from './playbackPreferences';
import { readFamilyProfileValues, saveFamilyProfileValues } from './theme';
vi.mock('./theme', () => ({ readFamilyProfileValues: vi.fn(), saveFamilyProfileValues: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

describe('Android playback rules on Windows', () => {
    it('uses Android defaults and clamps untrusted persisted numbers', () => {
        expect(normalizePlaybackPreferences()).toEqual({ autoPlay: true, nextUp: 'EXTENDED', nextUpSeconds: 7, resumeRewindSeconds: 0, stillWatching: 'DISABLED' });
        expect(normalizePlaybackPreferences({ next_up_timeout: '999999', pref_resume_preroll: '-4' })).toMatchObject({ nextUpSeconds: 30, resumeRewindSeconds: 0 });
        expect(normalizePlaybackPreferences({ next_up_timeout: 'invalid', pref_resume_preroll: 'NaN' })).toMatchObject({ nextUpSeconds: 7, resumeRewindSeconds: 0 });
    });
    it('rewinds only a resumed video, never live TV or stream switches', () => {
        const preferences = { resumeRewindSeconds: 10 };
        expect(resumedPosition(200000000, preferences, { Type: 'Episode' })).toBe(100000000);
        expect(resumedPosition(50000000, preferences, { Type: 'Movie' })).toBe(0);
        expect(resumedPosition(200000000, preferences, { Type: 'TvChannel' })).toBe(200000000);
        expect(resumedPosition(200000000, preferences, { Type: 'Episode' }, true)).toBe(200000000);
    });
    it('isolates the settings cache by server and user', async () => {
        const api = { serverId: () => 'isolation', getCurrentUserId: () => 'amanda' };
        readFamilyProfileValues.mockResolvedValueOnce({ pref_resume_preroll: '20' }).mockResolvedValueOnce({ pref_resume_preroll: '5' });
        await loadPlaybackPreferences(api, 'amanda', true);
        await loadPlaybackPreferences(api, 'dylan', true);
        expect(currentPlaybackPreferences(api).resumeRewindSeconds).toBe(20);
        expect(currentPlaybackPreferences(api, 'dylan').resumeRewindSeconds).toBe(5);
        expect(currentPlaybackPreferences({ ...api, serverId: () => 'other' }).resumeRewindSeconds).toBe(0);
    });
    it('sends only edited settings and the exact original values for conflict detection', async () => {
        const api = { serverId: () => 'save' };
        saveFamilyProfileValues.mockResolvedValue({ pref_resume_preroll: '10' });
        await savePlaybackPreferences(api, 'amanda', { pref_enable_tv_queuing: 'true', next_up_behavior: 'EXTENDED', next_up_timeout: '7000', pref_resume_preroll: '10', enable_still_watching: 'DISABLED' }, {});
        expect(saveFamilyProfileValues).toHaveBeenCalledWith(api, 'amanda', { pref_resume_preroll: '10' }, { pref_resume_preroll: '' });
    });
    it('matches the Android episode/time thresholds and interaction reset', () => {
        const session = new UninterruptedEpisodes();
        session.completed(20 * 600000000);
        expect(session.needsConfirmation('SHORT')).toBe(false);
        session.completed(20 * 600000000);
        expect(session.needsConfirmation('SHORT')).toBe(true);
        expect(session.needsConfirmation('DISABLED')).toBe(false);
        session.interaction();
        session.completed(10 * 600000000);
        expect(session.count).toBe(0);
        expect(session.needsConfirmation('SHORT')).toBe(false);
        session.completed(80 * 600000000);
        expect(session.needsConfirmation('DEFAULT')).toBe(true);
    });
});
/* eslint-enable @typescript-eslint/naming-convention */
