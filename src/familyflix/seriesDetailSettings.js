import { openSeriesPreferences } from './seriesPreferencesDialog';
import { seriesIdForItem, seriesTrackChoices } from './seriesPreferencePolicy';
import { loadSeriesPreferences, rememberSeriesAudio } from './seriesPreferences';

const bindings = new WeakMap();
export function bindSeriesSettings(page, item, api) {
    bindings.get(page)?.();
    page.querySelector('.familyShowSettings')?.remove();
    if (!seriesIdForItem(item)) return;
    const parent = page.querySelector('.mainDetailButtons');
    if (!parent) return;
    const userId = api.getCurrentUserId();
    const applyTracks = async () => {
        const result = await loadSeriesPreferences(item, api);
        if (bindings.get(page) !== cleanup || api.getCurrentUserId() !== userId) return;
        const sourceId = page.querySelector('.selectSource')?.value;
        const source = item.MediaSources?.find(value => value.Id === sourceId) || item.MediaSources?.[0];
        const choices = seriesTrackChoices(result.values, source?.MediaStreams || item.MediaStreams || []);
        for (const [selector, index] of [['.selectAudio', choices.audio], ['.selectSubtitles', choices.subtitle]]) {
            const select = page.querySelector(selector);
            if (select && select.dataset.familyExplicit !== 'true' && index != null && [...select.options].some(option => option.value === String(index))) select.value = String(index);
        }
    };
    const selections = [...page.querySelectorAll('.selectAudio,.selectSubtitles')];
    const onTrackChange = event => {
        event.target.dataset.familyExplicit = 'true';
        if (event.target.matches('.selectAudio')) {
            const sourceId = page.querySelector('.selectSource')?.value;
            const source = item.MediaSources?.find(value => value.Id === sourceId) || item.MediaSources?.[0];
            const track = (source?.MediaStreams || item.MediaStreams || []).find(stream => stream.Type === 'Audio' && stream.Index === Number(event.target.value));
            if (track) rememberSeriesAudio(item, track.Language);
        }
    };
    selections.forEach(select => {
        delete select.dataset.familyExplicit;
        select.addEventListener('change', onTrackChange);
    });
    const observer = new MutationObserver(() => {
        void applyTracks();
    });
    selections.forEach(select => {
        observer.observe(select, { childList: true });
    });
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'emby-button raised show-focus familyShowSettings';
    button.textContent = 'Show settings';
    let close;
    button.addEventListener('click', () => {
        close?.();
        close = openSeriesPreferences(item, api, button);
    });
    const cleanup = () => {
        close?.();
        observer.disconnect();
        selections.forEach(select => {
            select.removeEventListener('change', onTrackChange);
        });
        page.removeEventListener('viewbeforehide', cleanup);
        bindings.delete(page);
    };
    page.addEventListener('viewbeforehide', cleanup);
    bindings.set(page, cleanup);
    parent.appendChild(button);
    void applyTracks();
}
