import { beforeEach, expect, it, vi } from 'vitest';
import { clearDiagnostics, diagnosticSnapshot, recordDiagnostic, redactDiagnostic, sendDiagnostics } from './diagnostics';
import { relatedCast } from './relatedCast';
import { readShortcuts, shortcutCommand } from './desktopShortcuts';

beforeEach(() => {
    clearDiagnostics();
    localStorage.clear();
    vi.restoreAllMocks();
});
it('bounds diagnostics and redacts stream URLs and credentials', () => {
    // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Synthetic redaction test fixture.
    expect(redactDiagnostic('https://host/video?api_key=secret password=secret')).not.toContain('secret');
    for (let index = 0; index < 200; index++) recordDiagnostic('failure', String(index));
    expect(diagnosticSnapshot().split('\n')).toHaveLength(120);
    clearDiagnostics();
    expect(diagnosticSnapshot()).toBe('');
});
it('uploads text reports only on explicit request and surfaces failures', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500 });
    const api = { getCurrentUserId: () => 'user', accessToken: () => 'secret', getUrl: path => 'https://server/' + path };
    await expect(sendDiagnostics(api)).rejects.toThrow('HTTP 500');
    expect(fetcher.mock.calls[0][1].body).not.toContain('secret');
    fetcher.mockResolvedValue({ ok: true });
    await expect(sendDiagnostics(api)).resolves.toBeTruthy();
});
it('keeps episode guest stars without requesting unrelated cast', async () => {
    const api = { getItem: vi.fn() };
    const people = [{ Id: 'guest', Type: 'GuestStar' }];
    expect(await relatedCast({ Type: 'Episode', People: people }, api, 'u')).toEqual(people);
    expect(api.getItem).not.toHaveBeenCalled();
});
it('prefers seasonal cast and falls back to the series when empty', async () => {
    const api = { getItem: vi.fn().mockResolvedValueOnce({ People: [] }).mockResolvedValueOnce({ People: [{ Id: 'actor', Type: 'Actor' }] }) };
    const cast = await relatedCast({ Type: 'Episode', SeasonId: 'season', SeriesId: 'series' }, api, 'u');
    expect(cast[0].Id).toBe('actor');
    expect(api.getItem.mock.calls).toEqual([['u', 'season'], ['u', 'series']]);
});
it('maps native and keyboard shortcuts from one persisted device configuration', () => {
    expect(readShortcuts()).toEqual({ audio: 'KeyA', subtitles: 'KeyL' });
    localStorage.setItem('familyflix-windows-shortcuts-v1', JSON.stringify({ audio: 'F8', subtitles: 'Disabled' }));
    expect(shortcutCommand('F8', readShortcuts())).toBe('changeaudiotrack');
    expect(shortcutCommand('KeyL', readShortcuts())).toBeNull();
    expect(shortcutCommand('Disabled', readShortcuts())).toBeNull();
});
