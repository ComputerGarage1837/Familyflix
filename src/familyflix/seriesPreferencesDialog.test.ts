import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from 'jellyfin-apiclient';
import { SERIES_DEFAULTS } from './seriesPreferencePolicy';
import type { SeriesSyncResult } from './seriesPreferences';

const mock = vi.hoisted(() => ({ active: true, load: vi.fn(), save: vi.fn(), reset: vi.fn(), cached: vi.fn() }));
vi.mock('./seriesPreferences', () => ({
    captureSeriesPreferencesSession: () => () => mock.active,
    cachedSeriesPreferences: () => mock.cached(),
    loadSeriesPreferences: (...args: unknown[]) => mock.load(...args),
    saveSeriesPreferences: (...args: unknown[]) => mock.save(...args),
    resetSeriesPreferences: (...args: unknown[]) => mock.reset(...args)
}));
vi.mock('components/dialogHelper/dialogHelper', () => ({ default: {
    createDialog: () => document.createElement('div'),
    open: (dialog: HTMLElement) => {
        document.body.append(dialog);
        return Promise.resolve();
    },
    close: (dialog: HTMLElement) => {
        dialog.dispatchEvent(new Event('close'));
        dialog.remove();
    }
} }));
import { openSeriesPreferences } from './seriesPreferencesDialog';

const show = { Id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', Type: 'Series', Name: 'Example show' } as const;
const client = {} as ApiClient;
const result = (patch: Record<string, string> = {}, status: SeriesSyncResult['status'] = 'synced'): SeriesSyncResult =>
    ({ values: { ...SERIES_DEFAULTS, ...patch }, status });
const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
};
function select(name: string, value: string) {
    const input = document.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input;
}
function press(css: string) {
    document.querySelector<HTMLButtonElement>(css)!.click();
}
function deferred() {
    let resolve!: (value: SeriesSyncResult) => void;
    const promise = new Promise<SeriesSyncResult>(done => {
        resolve = done;
    });
    return { promise, resolve };
}

beforeEach(() => {
    document.body.replaceChildren();
    mock.active = true;
    mock.load.mockReset().mockResolvedValue(result());
    mock.save.mockReset().mockResolvedValue(result());
    mock.reset.mockReset().mockResolvedValue(result());
    mock.cached.mockReset().mockReturnValue({ ...SERIES_DEFAULTS });
});

describe('shared show settings browser form', () => {
    it('opens with six labelled controls and no save/reset call', async () => {
        openSeriesPreferences(show, client);
        await flush();
        expect(document.querySelectorAll('label select')).toHaveLength(6);
        expect(document.querySelector('[aria-label="Show playback settings"]')).not.toBeNull();
        expect(mock.save).not.toHaveBeenCalled();
        expect(mock.reset).not.toHaveBeenCalled();
    });
    it('does not overwrite a choice made before the initial read finishes', async () => {
        const read = deferred();
        mock.load.mockReturnValue(read.promise);
        openSeriesPreferences(show, client);
        const input = select('introSkipMode', 'ASK');
        read.resolve(result({ introSkipMode: 'AUTO_SKIP' }));
        await flush();
        expect(input.value).toBe('ASK');
    });
    it('keeps edits made while saving and does not submit twice', async () => {
        openSeriesPreferences(show, client);
        await flush();
        const write = deferred();
        mock.save.mockReturnValue(write.promise);
        select('introSkipMode', 'ASK');
        press('.familySeriesSave');
        const input = select('introSkipMode', 'AUTO_SKIP');
        press('.familySeriesSave');
        write.resolve(result({ introSkipMode: 'ASK' }));
        await flush();
        expect(mock.save).toHaveBeenCalledTimes(1);
        expect(input.value).toBe('AUTO_SKIP');
        expect(document.querySelector('.familySeriesStatus')!.textContent).toContain('unsaved edits');
    });
    it('keeps unsaved form edits when retrying pending synchronization', async () => {
        mock.load.mockResolvedValue(result({}, 'offline'));
        openSeriesPreferences(show, client);
        await flush();
        select('autoplayMode', 'STOP_AFTER_EPISODE');
        mock.load.mockResolvedValue(result({ autoplayMode: 'PLAY_NEXT' }));
        press('.familySeriesRetry');
        await flush();
        expect(document.querySelector<HTMLSelectElement>('[name="autoplayMode"]')!.value).toBe('STOP_AFTER_EPISODE');
        expect(mock.save).not.toHaveBeenCalled();
    });
    it('reports a failed durable save without discarding the form choice', async () => {
        mock.save.mockResolvedValue(result({}, 'error'));
        openSeriesPreferences(show, client);
        await flush();
        select('subtitleMode', 'OFF');
        press('.familySeriesSave');
        await flush();
        expect(document.querySelector<HTMLSelectElement>('[name="subtitleMode"]')!.value).toBe('OFF');
        expect(document.querySelector('.familySeriesStatus')!.textContent).toContain('Could not safely save');
    });
    it('closes an obsolete-profile dialog instead of applying a late read', async () => {
        const read = deferred();
        mock.load.mockReturnValue(read.promise);
        openSeriesPreferences(show, client);
        mock.active = false;
        read.resolve(result({ subtitleMode: 'OFF' }));
        await flush();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(mock.save).not.toHaveBeenCalled();
    });
    it('uses the explicit reset API and leaves newer form edits intact', async () => {
        const reset = deferred();
        mock.reset.mockReturnValue(reset.promise);
        openSeriesPreferences(show, client);
        await flush();
        select('introSkipMode', 'AUTO_SKIP');
        press('.familySeriesReset');
        select('introSkipMode', 'ASK');
        reset.resolve(result());
        await flush();
        expect(mock.reset).toHaveBeenCalledTimes(1);
        expect(document.querySelector<HTMLSelectElement>('[name="introSkipMode"]')!.value).toBe('ASK');
    });
    it('does not reopen a closed dialog when an old response arrives', async () => {
        const read = deferred();
        mock.load.mockReturnValue(read.promise);
        const close = openSeriesPreferences(show, client);
        close();
        read.resolve(result());
        await flush();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
});
