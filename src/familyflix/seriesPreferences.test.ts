/* eslint-disable compat/compat -- Tests execute in Node/jsdom and are not shipped to legacy browsers. */
import type { ApiClient } from 'jellyfin-apiclient';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Events from '../utils/events';
import { SERIES_DEFAULTS, SERIES_KEYS, type SeriesDocument, type SeriesValues } from './seriesPreferencePolicy';
import {
    cachedSeriesPreferences, captureSeriesPreferencesSession, loadSeriesPreferences,
    rememberSeriesAudio, resetSeriesPreferences, saveSeriesPreferences
} from './seriesPreferences';

const connections = vi.hoisted(() => ({ currentApiClient: vi.fn() }));
vi.mock('../lib/jellyfin-apiclient', () => ({ ServerConnections: connections }));

const SERVER = '20000000-0000-0000-0000-000000000001';
const USER = '00000000-0000-0000-0000-000000000001';
const SHOW = '10000000-0000-0000-0000-000000000001';
const ITEM = { Type: 'Episode' as const, Id: '30000000-0000-0000-0000-000000000001', SeriesId: SHOW };
const KEY = 'familyflix-series-v1:' + SERVER + ':' + USER + ':' + SHOW;
const DOC_KEY = 'familyFlixSeriesPlaybackV1';
const doc = (patch: Partial<SeriesValues> = {}, revision = 1): SeriesDocument => ({
    version: 1, revision, updatedAtEpochMillis: 1000, writerDeviceId: 'android-tv', values: { ...SERIES_DEFAULTS, ...patch } as SeriesValues
});
const deferred = () => {
    let resolve: () => void;
    const promise = new Promise<void>(done => {
        resolve = done;
    });
    return { promise, resolve: () => resolve() };
};
const tick = async () => {
    for (let count = 0; count < 12; count++) await Promise.resolve();
};
const stored = () => JSON.parse(localStorage.getItem(KEY) || 'null');

type RequestRecord = { method: string; url: string; init: RequestInit };
let client: ApiClient;
let userId: string;
let token: string;
let address: string;
let remote: SeriesDocument | null;
let available: boolean;
let requests: RequestRecord[];
let hook: ((request: RequestRecord, count: number) => Promise<void> | void) | undefined;
let afterPost: (() => Promise<void> | void) | undefined;

beforeEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    userId = USER;
    token = 'test-token-a';
    address = 'https://familyflix.test';
    client = {
        getCurrentUserId: () => userId, accessToken: () => token, serverId: () => SERVER,
        serverAddress: () => address,
        getUrl: (path: string, params: Record<string, string>, base?: string) => (base || address) + '/' + path + '?' + new URLSearchParams(params).toString()
    } as unknown as ApiClient;
    connections.currentApiClient.mockReturnValue(client);
    Events.trigger(connections, 'localusersignedout');
    remote = null;
    available = true;
    requests = [];
    hook = undefined;
    afterPost = undefined;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
        const record = { method: init.method || 'GET', url, init };
        requests.push(record);
        if (!available) throw new TypeError('Test server offline');
        await hook?.(record, requests.length);
        if (record.method === 'POST') {
            const body = JSON.parse(String(init.body));
            remote = JSON.parse(body.CustomPrefs[DOC_KEY]);
            await afterPost?.();
            return { ok: true, json: async () => ({}) } as Response;
        }
        const body = { Id: 'preserve-id', SortBy: 'SortName', CustomPrefs: {
            unrelated: 'keep-me', ...(remote ? { [DOC_KEY]: JSON.stringify(remote) } : {})
        } };
        return { ok: true, json: async () => body } as Response;
    }));
});

afterEach(async () => {
    Events.trigger(connections, 'localusersignedout');
    await tick();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('shared per-series preference runtime', () => {
    it('reads the exact shared endpoint without a default-only POST and records observed absence', async () => {
        const result = await loadSeriesPreferences(ITEM, client, true);
        expect(result.status).toBe('synced');
        expect(requests).toHaveLength(1);
        expect(requests[0].url).toContain('/DisplayPreferences/familyflix-series-playback-v1-' + SHOW);
        expect(new URL(requests[0].url).searchParams.get('client')).toBe('familyflix');
        expect(new URL(requests[0].url).searchParams.get('userId')).toBe(USER);
        expect(stored().baseObserved).toBe(true);
        expect(stored().base).toBeNull();
    });

    it('writes only the shared portable fields and preserves the entire surrounding DTO', async () => {
        remote = doc({ futurePortableMode: 'quiet' });
        await loadSeriesPreferences(ITEM, client, true);
        const result = await saveSeriesPreferences(ITEM, { introSkipMode: 'ASK', preferredAudioLanguage: ' JPN ', decoder: 'software' }, client);
        expect(result.status).toBe('synced');
        const body = JSON.parse(String(requests.find(request => request.method === 'POST')?.init.body));
        expect(body.Id).toBe('preserve-id');
        expect(body.SortBy).toBe('SortName');
        expect(body.CustomPrefs.unrelated).toBe('keep-me');
        const values = JSON.parse(body.CustomPrefs[DOC_KEY]).values;
        expect(values).toEqual({ ...SERIES_DEFAULTS, introSkipMode: 'ASK', preferredAudioLanguage: 'jpn', futurePortableMode: 'quiet' });
        expect(values.decoder).toBeUndefined();
    });

    it('commits an offline edit durably before starting network work and later reconciles it', async () => {
        remote = doc();
        await loadSeriesPreferences(ITEM, client, true);
        available = false;
        const save = saveSeriesPreferences(ITEM, { introSkipMode: 'ASK' }, client);
        expect(stored().values.introSkipMode).toBe('ASK');
        expect(stored().dirty).toEqual(['introSkipMode']);
        expect((await save).status).toBe('offline');
        expect(cachedSeriesPreferences(ITEM, client).introSkipMode).toBe('ASK');
        available = true;
        remote = doc({ subtitleMode: 'OFF' }, 2);
        const result = await loadSeriesPreferences(ITEM, client, true);
        expect(result.values).toEqual({ ...SERIES_DEFAULTS, introSkipMode: 'ASK', subtitleMode: 'OFF' });
        expect(stored().dirty).toEqual([]);
    });

    it('keeps server conflicts and merges independent local fields', async () => {
        remote = doc();
        await loadSeriesPreferences(ITEM, client, true);
        available = false;
        await saveSeriesPreferences(ITEM, { introSkipMode: 'AUTO_SKIP', subtitleMode: 'OFF' }, client);
        available = true;
        remote = doc({ introSkipMode: 'ASK' }, 2);
        const result = await loadSeriesPreferences(ITEM, client, true);
        expect(result.status).toBe('conflict');
        expect(result.conflicts).toEqual(['introSkipMode']);
        expect(result.values).toEqual({ ...SERIES_DEFAULTS, introSkipMode: 'ASK', subtitleMode: 'OFF' });
    });

    it('an existing first server copy wins over an unverified offline seed', async () => {
        available = false;
        await saveSeriesPreferences(ITEM, { introSkipMode: 'AUTO_SKIP' }, client);
        available = true;
        remote = doc({ introSkipMode: 'ASK' }, 5);
        const result = await loadSeriesPreferences(ITEM, client, true);
        expect(result.values.introSkipMode).toBe('ASK');
        expect(requests.some(request => request.method === 'POST')).toBe(false);
    });

    it('explicit reset writes a defaults document even when the known server was empty', async () => {
        await loadSeriesPreferences(ITEM, client, true);
        const result = await resetSeriesPreferences(ITEM, client);
        expect(result.status).toBe('synced');
        expect(remote?.values).toEqual(SERIES_DEFAULTS);
        expect(requests.filter(request => request.method === 'POST')).toHaveLength(1);
        available = false;
        await resetSeriesPreferences(ITEM, client);
        expect(stored().dirty).toEqual(expect.arrayContaining(SERIES_KEYS));
    });

    it('failed localStorage saves neither change the memory value nor send a remote request', async () => {
        await loadSeriesPreferences(ITEM, client, true);
        const count = requests.length;
        const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('Full', 'QuotaExceededError');
        });
        const result = await saveSeriesPreferences(ITEM, { subtitleMode: 'OFF' }, client);
        expect(result.status).toBe('error');
        expect(cachedSeriesPreferences(ITEM, client)).toEqual(SERIES_DEFAULTS);
        expect(requests).toHaveLength(count);
        storage.mockRestore();
    });

    it.each([{ version: 99 }, { values: { ...SERIES_DEFAULTS, introSkipMode: 'FUTURE' } }])('fails closed for unsupported remote content %j', async invalid => {
        available = false;
        await saveSeriesPreferences(ITEM, { subtitleMode: 'OFF' }, client);
        available = true;
        remote = { ...doc(), ...invalid } as SeriesDocument;
        expect((await loadSeriesPreferences(ITEM, client, true)).status).toBe('error');
        expect(cachedSeriesPreferences(ITEM, client).subtitleMode).toBe('OFF');
        expect(stored().dirty).toEqual(['subtitleMode']);
        expect(requests.some(request => request.method === 'POST')).toBe(false);
    });

    it('coalesces same-profile reads without reusing a flight after a token/profile change', async () => {
        const gate = deferred();
        hook = async (_request, count) => {
            if (count === 1) await gate.promise;
        };
        const first = loadSeriesPreferences(ITEM, client, true);
        const duplicate = loadSeriesPreferences(ITEM, client, true);
        await tick();
        expect(requests).toHaveLength(1);
        userId = '00000000-0000-0000-0000-000000000002';
        token = 'test-token-b';
        const second = loadSeriesPreferences(ITEM, client, true);
        expect((await first).status).toBe('no-series');
        expect((await duplicate).values).toEqual(SERIES_DEFAULTS);
        expect((await second).status).toBe('synced');
        gate.resolve();
        await tick();
        expect(requests.filter(request => request.method === 'POST')).toHaveLength(0);
    });

    it('fences A-to-B-to-A sessions and old dialog guards even when the original client/token returns', async () => {
        available = false;
        await saveSeriesPreferences(ITEM, { subtitleMode: 'OFF' }, client);
        available = true;
        const gate = deferred();
        hook = async () => gate.promise;
        const guard = captureSeriesPreferencesSession(client);
        const old = loadSeriesPreferences(ITEM, client, true);
        await tick();
        userId = '00000000-0000-0000-0000-000000000002';
        token = 'test-token-b';
        Events.trigger(connections, 'localusersignedin');
        userId = USER;
        token = 'test-token-a';
        Events.trigger(connections, 'localusersignedin');
        expect(guard()).toBe(false);
        expect((await old).status).toBe('no-series');
        gate.resolve();
        await tick();
        expect(stored().dirty).toEqual(['subtitleMode']);
        expect(requests.some(request => request.method === 'POST')).toBe(false);
    });

    it('rejects an in-flight response after the same client changes server address', async () => {
        const gate = deferred();
        hook = async () => gate.promise;
        const loading = loadSeriesPreferences(ITEM, client, true);
        await tick();
        address = 'https://different-server.test';
        gate.resolve();
        expect((await loading).status).toBe('no-series');
        expect(requests).toHaveLength(1);
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('uses one 1.5-second total deadline, not a new timeout for every network step', async () => {
        remote = doc();
        await loadSeriesPreferences(ITEM, client, true);
        vi.useFakeTimers();
        hook = async () => new Promise(resolve => setTimeout(resolve, 600));
        const saving = saveSeriesPreferences(ITEM, { subtitleMode: 'OFF' }, client);
        await vi.advanceTimersByTimeAsync(1500);
        expect((await saving).status).toBe('offline');
        expect(stored().dirty).toEqual(['subtitleMode']);
        const count = requests.length;
        await vi.advanceTimersByTimeAsync(1000);
        expect(requests).toHaveLength(count);
    });

    it('a shorter waiting caller does not extend its deadline or abort an earlier flight', async () => {
        vi.useFakeTimers();
        const gate = deferred();
        hook = async () => gate.promise;
        const original = loadSeriesPreferences(ITEM, client, true, 1500);
        await tick();
        const short = loadSeriesPreferences(ITEM, client, true, 20);
        await vi.advanceTimersByTimeAsync(20);
        expect((await short).status).toBe('offline');
        gate.resolve();
        await tick();
        expect((await original).status).toBe('synced');
        expect(requests).toHaveLength(1);
    });

    it('preserves all explicit reset generations while an older upload is being acknowledged', async () => {
        remote = doc();
        await loadSeriesPreferences(ITEM, client, true);
        const firstPost = deferred();
        const secondRead = deferred();
        const reachedSecondRead = deferred();
        let posted = false;
        afterPost = async () => {
            if (!posted) {
                posted = true;
                await firstPost.promise;
            }
        };
        hook = async (_request, count) => {
            if (count === 6) {
                reachedSecondRead.resolve();
                await secondRead.promise;
            }
        };
        const old = saveSeriesPreferences(ITEM, { audioMode: 'PREFER_LANGUAGE' }, client);
        await tick();
        expect(posted).toBe(true);
        const reset = resetSeriesPreferences(ITEM, client);
        expect(stored().dirty).toEqual(expect.arrayContaining(SERIES_KEYS));
        firstPost.resolve();
        await reachedSecondRead.promise;
        expect((await old).status).toBe('local');
        expect(stored().dirty).toEqual(expect.arrayContaining(SERIES_KEYS));
        secondRead.resolve();
        expect((await reset).status).toBe('synced');
        expect(remote?.values).toEqual(SERIES_DEFAULTS);
    });

    it('verifies full post-write values even when revision and writer identity match', async () => {
        remote = doc();
        await loadSeriesPreferences(ITEM, client, true);
        afterPost = () => {
            remote = { ...remote!, values: { ...remote!.values, introSkipMode: 'ASK' } };
        };
        const result = await saveSeriesPreferences(ITEM, { introSkipMode: 'AUTO_SKIP' }, client);
        expect(result.status).toBe('conflict');
        expect(result.values.introSkipMode).toBe('ASK');
    });

    it('returns pending-local rather than a fictitious resolved conflict when compare retries are exhausted', async () => {
        remote = doc();
        await loadSeriesPreferences(ITEM, client, true);
        hook = () => {
            remote = { ...remote!, revision: remote!.revision + 1 };
        };
        const result = await saveSeriesPreferences(ITEM, { subtitleMode: 'OFF' }, client);
        expect(result.status).toBe('local');
        expect(stored().dirty).toEqual(['subtitleMode']);
        expect(requests.some(request => request.method === 'POST')).toBe(false);
    });

    it('returns defensive cached copies and remembers audio only when the show opted in', async () => {
        await loadSeriesPreferences(ITEM, client, true);
        const copy = cachedSeriesPreferences(ITEM, client);
        copy.subtitleMode = 'OFF';
        expect(cachedSeriesPreferences(ITEM, client).subtitleMode).toBe('SERVER_DEFAULT');
        const count = requests.length;
        rememberSeriesAudio(ITEM, 'jpn');
        await tick();
        expect(requests).toHaveLength(count);
        await saveSeriesPreferences(ITEM, { audioMode: 'REMEMBER_LAST_SELECTION' }, client);
        rememberSeriesAudio(ITEM, ' JPN ');
        await vi.waitFor(() => expect(remote?.values.preferredAudioLanguage).toBe('jpn'));
    });

    it('only retries already-pending shows for the current profile when connectivity returns', async () => {
        await loadSeriesPreferences(ITEM, client, true);
        available = false;
        await saveSeriesPreferences(ITEM, { subtitleMode: 'OFF' }, client);
        available = true;
        userId = '00000000-0000-0000-0000-000000000002';
        token = 'test-token-b';
        Events.trigger(connections, 'localusersignedin');
        const count = requests.length;
        window.dispatchEvent(new Event('online'));
        await tick();
        expect(requests).toHaveLength(count);
        userId = USER;
        token = 'test-token-a';
        Events.trigger(connections, 'localusersignedin');
        window.dispatchEvent(new Event('online'));
        await vi.waitFor(() => expect(remote?.values.subtitleMode).toBe('OFF'));
    });
});

it('does not read the circular ServerConnections export until preferences are used', async () => {
    vi.resetModules();
    let dependenciesReady = false;
    const readConnections = vi.fn(() => {
        if (!dependenciesReady) throw new ReferenceError('ServerConnections is still initializing');
        return connections;
    });
    vi.doMock('../lib/jellyfin-apiclient', () => ({
        get ServerConnections() { return readConnections(); }
    }));
    try {
        const lazyPreferences = await import('./seriesPreferences');
        expect(readConnections).not.toHaveBeenCalled();
        expect(requests).toHaveLength(0);
        dependenciesReady = true;
        const sameSession = lazyPreferences.captureSeriesPreferencesSession(client);
        expect(sameSession()).toBe(true);
        expect(readConnections).toHaveBeenCalled();
    } finally {
        vi.doMock('../lib/jellyfin-apiclient', () => ({ ServerConnections: connections }));
        vi.resetModules();
    }
});

/* eslint-enable compat/compat */
