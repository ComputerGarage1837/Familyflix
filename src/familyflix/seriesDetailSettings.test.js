import { beforeEach, expect, it, vi } from 'vitest';
import { SERIES_DEFAULTS } from './seriesPreferencePolicy';
import { bindSeriesSettings } from './seriesDetailSettings';
import { loadSeriesPreferences } from './seriesPreferences';
vi.mock('./seriesPreferencesDialog', () => ({ openSeriesPreferences: vi.fn(() => vi.fn()) }));
vi.mock('./seriesPreferences', () => ({ loadSeriesPreferences: vi.fn(), rememberSeriesAudio: vi.fn() }));
const item = { Type: 'Episode', SeriesId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', MediaStreams: [{ Index: 0, Type: 'Audio', Language: 'eng' }, { Index: 1, Type: 'Audio', Language: 'jpn' }] };
let page;
beforeEach(() => {
    page = document.createElement('div');
    page.innerHTML = '<div class="mainDetailButtons"></div><select class="selectAudio"><option value="0">English</option><option value="1">Japanese</option></select><select class="selectSubtitles"></select>';
    loadSeriesPreferences.mockResolvedValue({ values: { ...SERIES_DEFAULTS, audioMode: 'PREFER_LANGUAGE', preferredAudioLanguage: 'jpn' } });
});
it('shows the preferred language without marking it as an explicit user selection', async () => {
    bindSeriesSettings(page, item, { getCurrentUserId: () => 'amanda' });
    await Promise.resolve();
    expect(page.querySelector('.selectAudio').value).toBe('1');
    expect(page.querySelector('.selectAudio').dataset.familyExplicit).toBeUndefined();
    page.dispatchEvent(new Event('viewbeforehide'));
});
it('does not apply a delayed preference result after leaving the page', async () => {
    let resolve;
    loadSeriesPreferences.mockReturnValue(new Promise(done => {
        resolve = done;
    }));
    bindSeriesSettings(page, item, { getCurrentUserId: () => 'amanda' });
    page.dispatchEvent(new Event('viewbeforehide'));
    resolve({ values: { ...SERIES_DEFAULTS, audioMode: 'PREFER_LANGUAGE', preferredAudioLanguage: 'jpn' } });
    await Promise.resolve();
    expect(page.querySelector('.selectAudio').value).toBe('0');
});
