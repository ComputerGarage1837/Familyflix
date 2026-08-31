import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';
import type { ApiClient } from 'jellyfin-apiclient';
import dialogHelper from 'components/dialogHelper/dialogHelper';
import { cachedSeriesPreferences, loadSeriesPreferences, saveSeriesPreferences, resetSeriesPreferences,
    captureSeriesPreferencesSession,
    type SeriesSyncResult } from './seriesPreferences';
import { SERIES_DEFAULTS, seriesIdForItem, type SeriesKey, type SeriesValues } from './seriesPreferencePolicy';
import './seriesPreferences.scss';

const FIELDS: { key: SeriesKey; label: string; options?: [string, string][] }[] = [
    { key: 'audioMode', label: 'Audio preference', options: [
        ['SERVER_DEFAULT', 'Use profile default'], ['PREFER_LANGUAGE', 'Prefer a language'],
        ['REMEMBER_LAST_SELECTION', 'Remember the last language I choose']
    ] },
    { key: 'preferredAudioLanguage', label: 'Audio language' },
    { key: 'subtitleMode', label: 'Subtitles', options: [
        ['SERVER_DEFAULT', 'Use profile default'], ['OFF', 'Off'],
        ['FORCED_ONLY', 'Only forced subtitles'], ['FULL', 'Full subtitles']
    ] },
    { key: 'preferredSubtitleLanguage', label: 'Subtitle language' },
    { key: 'introSkipMode', label: 'Intro behaviour', options: [
        ['APP_DEFAULT', 'Use this app’s setting'], ['ASK', 'Ask to skip'],
        ['AUTO_SKIP', 'Skip automatically'], ['DO_NOT_SKIP', 'Do not skip']
    ] },
    { key: 'autoplayMode', label: 'After an episode', options: [
        ['APP_DEFAULT', 'Use this app’s setting'], ['PLAY_NEXT', 'Play the next episode'],
        ['STOP_AFTER_EPISODE', 'Stop after this episode']
    ] }
];

const LANGUAGES: [string, string][] = [
    ['', 'No language override'], ['eng', 'English'], ['jpn', 'Japanese'], ['fra', 'French'],
    ['spa', 'Spanish'], ['deu', 'German'], ['ita', 'Italian'], ['kor', 'Korean'], ['zho', 'Chinese'],
    ['por', 'Portuguese'], ['hin', 'Hindi']
];

/** The existing dialog helper supplies history/Back support and the TV focus scope. */
export function openSeriesPreferences(item: BaseItemDto, client: ApiClient, origin?: HTMLElement): () => void {
    if (!seriesIdForItem(item)) return () => undefined;
    const activeSession = captureSeriesPreferencesSession(client);
    const dialog = dialogHelper.createDialog({ removeOnClose: true, scrollY: true }) as HTMLElement;
    dialog.classList.add('familySeriesDialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Show playback settings');
    dialog.innerHTML = '<h2 class="familySeriesTitle"></h2>'
        + '<p>These settings follow this show and profile between Family Flix TVs and the browser. '
        + 'Audio output, streaming quality and subtitle timing stay on each device.</p>'
        + '<form><div class="familySeriesFields"></div>'
        + '<p class="familySeriesStatus" role="status" aria-live="polite"></p>'
        + '<div class="familySeriesActions"><button type="submit" class="emby-button button-raised familySeriesSave">Save</button>'
        + '<button type="button" class="emby-button button-raised familySeriesReset">Reset this show</button>'
        + '<button type="button" class="emby-button button-raised familySeriesRetry hide">Retry sync</button>'
        + '<button type="button" class="emby-button button-raised familySeriesClose">Close</button></div></form>';
    dialog.querySelector('.familySeriesTitle')!.textContent = `Show settings · ${item.SeriesName || item.Name || 'This show'}`;
    const controls = new Map<SeriesKey, HTMLSelectElement>();
    const changed = new Set<SeriesKey>();
    const editVersions = new Map<SeriesKey, number>();
    const fields = dialog.querySelector('.familySeriesFields')!;
    const status = dialog.querySelector<HTMLElement>('.familySeriesStatus')!;
    const retry = dialog.querySelector<HTMLButtonElement>('.familySeriesRetry')!;
    let closed = false;
    let busy = false;

    FIELDS.forEach(field => {
        const label = document.createElement('label');
        const text = document.createElement('span');
        text.textContent = field.label;
        const select = document.createElement('select');
        select.className = 'emby-select';
        select.name = field.key;
        (field.options || LANGUAGES).forEach(([value, title]) => {
            select.add(new Option(title, value));
        });
        select.addEventListener('change', () => {
            changed.add(field.key);
            editVersions.set(field.key, (editVersions.get(field.key) || 0) + 1);
        });
        label.append(text, select);
        fields.append(label);
        controls.set(field.key, select);
    });

    function paint(values: SeriesValues, keepEdits = false) {
        controls.forEach((select, key) => {
            if (keepEdits && changed.has(key)) return;
            const value = values[key];
            if (!Array.from(select.options).some(option => option.value === value)) select.add(new Option(value, value));
            select.value = value;
        });
    }
    function describe(result: SeriesSyncResult) {
        const messages: Record<SeriesSyncResult['status'], string> = {
            synced: 'Up to date across Family Flix. Changes apply when the next episode starts.',
            offline: 'Using this device’s saved settings. Pending changes will sync when the connection returns.',
            local: 'Saved on this device. Some changes are still waiting to sync.',
            conflict: 'Another device changed these settings too. Its newer conflicting choices were kept; review the choices below.',
            error: 'Could not safely save or read these settings. Your previous settings have not been replaced.',
            'no-series': 'This profile or show is no longer active.'
        };
        status.textContent = messages[result.status];
        retry.classList.toggle('hide', !['offline', 'local', 'error', 'conflict'].includes(result.status));
    }
    function close() {
        if (closed) return;
        closed = true;
        dialogHelper.close(dialog);
    }
    function setBusy(value: boolean) {
        busy = value;
        dialog.setAttribute('aria-busy', String(value));
        dialog.querySelectorAll<HTMLButtonElement>('.familySeriesSave, .familySeriesReset, .familySeriesRetry')
            .forEach(button => {
                button.setAttribute('aria-disabled', String(value));
            });
    }
    async function perform(action: 'save' | 'reset' | 'retry') {
        if (busy || closed) return;
        if (!activeSession()) {
            close();
            return;
        }
        const patch: Partial<SeriesValues> = {};
        const submittedVersions = new Map(editVersions);
        changed.forEach(key => {
            patch[key] = controls.get(key)!.value;
        });
        setBusy(true);
        status.textContent = action === 'retry' ? 'Checking shared settings…' : 'Saving…';
        try {
            // The first bounded read resolves a verified provider-stable preference
            // identity before a quick Save can choose a DisplayPreferences document.
            if (action !== 'retry') await initialLoad;
            if (!activeSession()) {
                close();
                return;
            }
            const operations = {
                save: () => saveSeriesPreferences(item, patch, client),
                reset: () => resetSeriesPreferences(item, client),
                retry: () => loadSeriesPreferences(item, client, true, 4000)
            };
            const result = await operations[action]();
            if (closed) return;
            if (!activeSession() || result.status === 'no-series') {
                close();
                return;
            }
            if (result.status !== 'error') {
                if (action !== 'retry') {
                    changed.forEach(key => {
                        if ((editVersions.get(key) || 0) === (submittedVersions.get(key) || 0)) changed.delete(key);
                    });
                }
                paint(result.values, true);
            }
            describe(result);
            if (changed.size) status.textContent += ' There are also unsaved edits in this form.';
        } catch {
            if (!closed) status.textContent = 'Could not finish. Your existing show settings are still available; please retry.';
        } finally {
            if (!closed) setBusy(false);
        }
    }
    paint(cachedSeriesPreferences(item, client) || { ...SERIES_DEFAULTS });
    status.textContent = 'Checking shared settings…';
    dialog.querySelector('form')!.addEventListener('submit', event => {
        event.preventDefault();
        void perform('save');
    });
    dialog.querySelector('.familySeriesReset')!.addEventListener('click', () => {
        void perform('reset');
    });
    retry.addEventListener('click', () => {
        void perform('retry');
    });
    dialog.querySelector('.familySeriesClose')!.addEventListener('click', close);
    dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
        }
    });
    dialog.addEventListener('close', () => {
        closed = true;
        if (activeSession() && origin?.isConnected && (!document.activeElement || document.activeElement === document.body)) origin.focus();
    }, { once: true });
    void dialogHelper.open(dialog);
    const initialLoad = loadSeriesPreferences(item, client, true, 1500);
    void initialLoad.then(result => {
        if (closed || busy) return;
        if (!activeSession()) {
            close();
            return;
        }
        paint(result.values, true);
        describe(result);
    });
    return close;
}
