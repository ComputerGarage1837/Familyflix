import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';
import type { ApiClient } from 'jellyfin-apiclient';
import { ServerConnections } from '../lib/jellyfin-apiclient';
import Events from '../utils/events';
import {
    canonicalGuid, seriesIdForItem, SERIES_DEFAULTS, SERIES_KEYS, mergeSeriesValues,
    emptySeriesCache, editSeriesCache, settledSeriesCache, isSeriesKey, validateSeriesDocument,
    sameSeriesValues, sameSeriesDocument,
    type SeriesCache, type SeriesDocument, type SeriesKey, type SeriesValues
} from './seriesPreferencePolicy';

const DOCUMENT_KEY = 'familyFlixSeriesPlaybackV1';
const CACHE_PREFIX = 'familyflix-series-v1:';
const DEVICE_KEY = 'familyflix-series-web-device-v1';
const TOTAL_TIMEOUT_MS = 1500;
const FRESH_CACHE_MS = 60_000;
const MAX_ATTEMPTS = 3;
const MAX_PENDING_ON_WAKE = 8;
const memory = new Map<string, { raw: string | null; state: SeriesCache }>();
const lastRead = new Map<string, number>();
const pending = new Map<string, Flight>();
const controllers = new Set<AbortController>();
let deviceId: string | undefined;
let authEpoch = 0;
let lastIdentity: Identity | undefined;
let wakeRunning = false;
let authEventsBound = false;
let editSequence = 0;
// eslint-disable-next-line sonarjs/pseudo-random -- Local edit correlation only, never authentication or authorization.
const tabId = Math.random().toString(36).slice(2);

export type SeriesSyncResult = {
    values: SeriesValues;
    status: 'synced' | 'offline' | 'conflict' | 'no-series' | 'error' | 'local';
    conflicts?: SeriesKey[];
};
type Identity = { client: ApiClient; userId: string; token: string; serverId: string; address: string };
type Context = Identity & { seriesId: string; key: string; epoch: number };
type Flight = { context: Context; promise: Promise<SeriesSyncResult> };
type PreferencesDto = Record<string, unknown> & { CustomPrefs?: Record<string, unknown> | null };

class SeriesStorageError extends Error {}
class SeriesSchemaError extends Error {}
class SeriesSessionError extends Error {}

function sameIdentity(first?: Identity, second?: Identity): boolean {
    if (!first || !second) return first === second;
    return first.client === second.client && first.userId === second.userId && first.token === second.token
        && first.serverId === second.serverId && first.address === second.address;
}

function readIdentity(): Identity | undefined {
    try {
        const client = ServerConnections.currentApiClient();
        const userId = canonicalGuid(client?.getCurrentUserId());
        const token = client?.accessToken();
        const serverId = canonicalGuid(client?.serverId());
        const address = client?.serverAddress();
        return client && userId && token && serverId && address ? { client, userId, token, serverId, address } : undefined;
    } catch { return undefined; }
}

function invalidateAuthentication() {
    authEpoch++;
    lastIdentity = readIdentity();
    lastRead.clear();
    pending.clear();
    controllers.forEach(controller => {
        controller.abort();
    });
}

function observeAuthentication(): Identity | undefined {
    bindAuthenticationEvents();
    const identity = readIdentity();
    if (!sameIdentity(identity, lastIdentity)) {
        invalidateAuthentication();
        lastIdentity = identity;
    }
    return identity;
}

function bindAuthenticationEvents() {
    if (authEventsBound) return;
    // Bind only on first use, after the existing ServerConnections -> player import
    // cycle has initialized. Reading that singleton at module evaluation blanks startup.
    Events.on(ServerConnections, 'localusersignedin', invalidateAuthentication);
    Events.on(ServerConnections, 'localusersignedout', invalidateAuthentication);
    Events.on(ServerConnections, 'connected', invalidateAuthentication);
    authEventsBound = true;
}

/** Capture once when opening a dialog; the guard also detects server/address and auth-generation changes. */
export function captureSeriesPreferencesSession(client = ServerConnections.currentApiClient()): () => boolean {
    const identity = observeAuthentication();
    const epoch = authEpoch;
    return () => {
        const active = observeAuthentication();
        return Boolean(identity && identity.client === client && epoch === authEpoch && sameIdentity(identity, active));
    };
}

function contextFor(item: BaseItemDto, client = ServerConnections.currentApiClient()): Context | undefined {
    const identity = observeAuthentication();
    const seriesId = seriesIdForItem(item);
    if (!identity || identity.client !== client || !seriesId) return undefined;
    return {
        ...identity, seriesId, epoch: authEpoch,
        key: CACHE_PREFIX + identity.serverId + ':' + identity.userId + ':' + seriesId
    };
}

function current(context: Context): boolean {
    const identity = observeAuthentication();
    return context.epoch === authEpoch && sameIdentity(context, identity);
}

function decodeCache(raw: string | null): SeriesCache {
    if (!raw) return emptySeriesCache();
    let saved: Partial<SeriesCache> & { version?: number };
    try {
        saved = JSON.parse(raw);
    } catch {
        return emptySeriesCache();
    }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return emptySeriesCache();
    if (saved.version !== undefined && saved.version !== 1) throw new SeriesStorageError('Unsupported local show settings');
    if (!saved.values || typeof saved.values !== 'object' || Array.isArray(saved.values) || !Array.isArray(saved.dirty)) {
        return emptySeriesCache();
    }
    let base: SeriesDocument | null;
    let values: SeriesValues;
    try {
        base = saved.base ? validateSeriesDocument(saved.base) : null;
        values = validateSeriesDocument({
            version: 1, revision: 0, updatedAtEpochMillis: 0, writerDeviceId: 'local-cache', values: saved.values
        }).values;
    } catch { throw new SeriesStorageError('Unsupported local show settings base'); }
    const fieldEditVersions: Partial<Record<SeriesKey, string>> = {};
    SERIES_KEYS.forEach(key => {
        const version = saved.fieldEditVersions?.[key];
        if (typeof version === 'string') fieldEditVersions[key] = version;
    });
    return {
        base, baseObserved: saved.baseObserved === undefined ? Boolean(base) : saved.baseObserved === true,
        values,
        dirty: Array.from(new Set(saved.dirty.filter(isSeriesKey))),
        pendingSeed: saved.pendingSeed === true,
        editSequence: Number.isSafeInteger(saved.editSequence) && Number(saved.editSequence) >= 0 ? Number(saved.editSequence) : 0,
        fieldEditVersions
    };
}

function readLocal(key: string): SeriesCache {
    let raw: string | null;
    try {
        raw = localStorage.getItem(key);
    } catch {
        return memory.get(key)?.state || emptySeriesCache();
    }
    const previous = memory.get(key);
    if (previous && previous.raw === raw) return previous.state;
    const state = decodeCache(raw);
    memory.set(key, { raw, state });
    return state;
}

/** Never publish an in-memory success before the offline record has actually been stored. */
function writeLocal(context: Context, state: SeriesCache) {
    if (!current(context)) throw new SeriesSessionError();
    const raw = JSON.stringify({ version: 1, ...state });
    try {
        localStorage.setItem(context.key, raw);
    } catch {
        throw new SeriesStorageError('Unable to save show settings on this device');
    }
    if (!current(context)) throw new SeriesSessionError();
    memory.set(context.key, { raw, state });
}

function getDeviceId(): string {
    if (deviceId) return deviceId;
    try {
        deviceId = localStorage.getItem(DEVICE_KEY)?.trim() || undefined;
        if (!deviceId) {
            // eslint-disable-next-line sonarjs/pseudo-random -- Public writer identity only; it confers no access or authority.
            const value = 'familyflix-web-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            localStorage.setItem(DEVICE_KEY, value);
            deviceId = value;
        }
        return deviceId;
    } catch { throw new SeriesStorageError('Unable to store show settings writer identity'); }
}

function decodeDto(value: unknown): PreferencesDto {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SeriesSchemaError('Invalid display preferences');
    const dto = value as PreferencesDto;
    if (dto.CustomPrefs != null && (typeof dto.CustomPrefs !== 'object' || Array.isArray(dto.CustomPrefs))) {
        throw new SeriesSchemaError('Invalid custom display preferences');
    }
    return dto;
}

function decodeDocument(dto: PreferencesDto): SeriesDocument | null {
    const payload = dto.CustomPrefs?.[DOCUMENT_KEY];
    if (payload == null) return null;
    if (typeof payload !== 'string') throw new SeriesSchemaError('Invalid shared show settings');
    try {
        return validateSeriesDocument(JSON.parse(payload));
    } catch {
        throw new SeriesSchemaError('Unsupported shared show settings');
    }
}

function checkRequest(context: Context, signal: AbortSignal, deadline: number) {
    if (!current(context)) throw new SeriesSessionError();
    if (signal.aborted || Date.now() >= deadline) throw new DOMException('Show settings sync timed out', 'AbortError');
}

async function request(context: Context, signal: AbortSignal, deadline: number, method: 'GET' | 'POST', data?: PreferencesDto) {
    checkRequest(context, signal, deadline);
    const response = await fetch(context.client.getUrl('DisplayPreferences/familyflix-series-playback-v1-' + context.seriesId, {
        userId: context.userId, client: 'familyflix'
    }, context.address), {
        method, signal,
        headers: { 'X-Emby-Token': context.token, 'Content-Type': 'application/json' },
        ...(data ? { body: JSON.stringify(data) } : {})
    });
    if (!response.ok) throw new Error('Shared show settings are unavailable');
    checkRequest(context, signal, deadline);
    const result = method === 'GET' ? decodeDto(await response.json()) : {};
    checkRequest(context, signal, deadline);
    return result;
}

function resultFromCache(context: Context, status: SeriesSyncResult['status']): SeriesSyncResult {
    if (!current(context)) return { values: { ...SERIES_DEFAULTS }, status: 'no-series' };
    try {
        return { values: { ...readLocal(context.key).values }, status };
    } catch {
        return { values: { ...SERIES_DEFAULTS }, status: 'error' };
    }
}

function settle(context: Context, snapshot: SeriesCache, document: SeriesDocument | null, conflicts: SeriesKey[]): SeriesSyncResult {
    if (!current(context)) throw new SeriesSessionError();
    const state = settledSeriesCache(readLocal(context.key), snapshot, document);
    writeLocal(context, state);
    lastRead.set(context.key, Date.now());
    let status: SeriesSyncResult['status'] = conflicts.length ? 'conflict' : 'synced';
    if (state.dirty.length) status = 'local';
    return {
        values: { ...state.values },
        status,
        conflicts
    };
}

function uploadDocument(remote: SeriesDocument | null, values: SeriesValues): SeriesDocument {
    try {
        return validateSeriesDocument({
            version: 1, revision: (remote?.revision || 0) + 1, updatedAtEpochMillis: Date.now(),
            writerDeviceId: getDeviceId(), values
        });
    } catch (error) {
        if (error instanceof SeriesStorageError) throw error;
        throw new SeriesSchemaError('Unable to safely version shared show settings');
    }
}

function requiresUpload(local: SeriesCache, remote: SeriesDocument | null, values: SeriesValues): boolean {
    if (!remote) return local.dirty.length > 0 || local.pendingSeed;
    return !sameSeriesValues(values, remote.values);
}

async function sync(context: Context, signal: AbortSignal, deadline: number): Promise<SeriesSyncResult> {
    try {
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            const dto = await request(context, signal, deadline, 'GET');
            const remote = decodeDocument(dto);
            const local = readLocal(context.key);
            const merged = mergeSeriesValues(local, remote);
            if (!requiresUpload(local, remote, merged.values)) {
                return settle(context, local, remote, merged.conflicts);
            }
            // The existing endpoint has no atomic CAS. Compare the full fresh document (not only
            // its revision), preserve unrelated DTO fields, then verify the full written document.
            const freshDto = await request(context, signal, deadline, 'GET');
            const fresh = decodeDocument(freshDto);
            if (!sameSeriesDocument(fresh, remote)) continue;
            const document = uploadDocument(remote, merged.values);
            await request(context, signal, deadline, 'POST', {
                ...freshDto, CustomPrefs: { ...freshDto.CustomPrefs, [DOCUMENT_KEY]: JSON.stringify(document) }
            });
            const confirmed = decodeDocument(await request(context, signal, deadline, 'GET'));
            if (!sameSeriesDocument(confirmed, document)) continue;
            checkRequest(context, signal, deadline);
            return settle(context, local, confirmed, merged.conflicts);
        }
        // The result is still pending, not proof that a particular remote conflict was resolved.
        return resultFromCache(context, 'local');
    } catch (error) {
        if (error instanceof SeriesSessionError || !current(context)) return { values: { ...SERIES_DEFAULTS }, status: 'no-series' };
        return resultFromCache(context, error instanceof SeriesSchemaError || error instanceof SeriesStorageError ? 'error' : 'offline');
    }
}

function deadlineFrom(timeout: number): number {
    const bounded = Number.isFinite(timeout) ? Math.max(0, Math.min(TOTAL_TIMEOUT_MS, timeout)) : TOTAL_TIMEOUT_MS;
    return Date.now() + bounded;
}

function startFlight(context: Context, deadline: number): Flight {
    // eslint-disable-next-line compat/compat -- Legacy targets load abortcontroller-polyfill in src/lib/legacy/index.ts.
    const controller = new AbortController();
    controllers.add(controller);
    let onAbort: () => void;
    const interrupted = new Promise<SeriesSyncResult>(resolve => {
        onAbort = () => resolve(resultFromCache(context, 'offline'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
    // Start in a microtask so the coalescing entry exists even if fetch is answered synchronously.
    const work = Promise.resolve().then(() => sync(context, controller.signal, deadline));
    const flight: Flight = {
        context,
        promise: Promise.race([work, interrupted]).finally(() => {
            clearTimeout(timer);
            controller.signal.removeEventListener('abort', onAbort);
            controllers.delete(controller);
            if (pending.get(context.key) === flight) pending.delete(context.key);
        })
    };
    pending.set(context.key, flight);
    return flight;
}

async function waitForFlight(context: Context, flight: Flight, deadline: number): Promise<SeriesSyncResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<SeriesSyncResult>(resolve => {
        timer = setTimeout(() => resolve(resultFromCache(context, 'offline')), Math.max(0, deadline - Date.now()));
    });
    try {
        const result = await Promise.race([flight.promise, timeout]);
        if (!current(context)) return { values: { ...SERIES_DEFAULTS }, status: 'no-series' };
        const local = readLocal(context.key);
        const stillPending = local.dirty.length > 0 || local.pendingSeed;
        const status = stillPending && ['synced', 'conflict'].includes(result.status) ? 'local' : result.status;
        return { ...result, status, values: { ...local.values } };
    } catch {
        return resultFromCache(context, 'error');
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

function loadContext(context: Context, force: boolean, deadline: number): Promise<SeriesSyncResult> {
    if (!current(context)) return Promise.resolve({ values: { ...SERIES_DEFAULTS }, status: 'no-series' });
    const previous = pending.get(context.key);
    if (previous && previous.context.epoch === context.epoch) return waitForFlight(context, previous, deadline);
    try {
        const local = readLocal(context.key);
        const age = Date.now() - (lastRead.get(context.key) ?? -FRESH_CACHE_MS);
        if (!force && !local.dirty.length && !local.pendingSeed && age >= 0 && age < FRESH_CACHE_MS) {
            return Promise.resolve({ values: { ...local.values }, status: 'synced' });
        }
    } catch { return Promise.resolve(resultFromCache(context, 'error')); }
    if (Date.now() >= deadline) return Promise.resolve(resultFromCache(context, 'offline'));
    return waitForFlight(context, startFlight(context, deadline), deadline);
}

export function cachedSeriesPreferences(item: BaseItemDto, client = ServerConnections.currentApiClient()): SeriesValues {
    const context = contextFor(item, client);
    if (!context) return { ...SERIES_DEFAULTS };
    try {
        return { ...readLocal(context.key).values };
    } catch {
        return { ...SERIES_DEFAULTS };
    }
}

export function loadSeriesPreferences(item: BaseItemDto, client = ServerConnections.currentApiClient(), force = false, timeout = TOTAL_TIMEOUT_MS): Promise<SeriesSyncResult> {
    const context = contextFor(item, client);
    return context ? loadContext(context, force, deadlineFrom(timeout)) :
        Promise.resolve({ values: { ...SERIES_DEFAULTS }, status: 'no-series' });
}

async function savePatch(item: BaseItemDto, patch: Partial<SeriesValues>, client: ApiClient | undefined, reset: boolean): Promise<SeriesSyncResult> {
    const context = contextFor(item, client);
    if (!context) return { values: { ...SERIES_DEFAULTS }, status: 'no-series' };
    const deadline = deadlineFrom(TOTAL_TIMEOUT_MS);
    try {
        const local = readLocal(context.key);
        const state = editSeriesCache(local, patch, tabId + ':' + (++editSequence), reset);
        writeLocal(context, state);
    } catch (error) {
        return resultFromCache(context, error instanceof SeriesSessionError ? 'no-series' : 'error');
    }
    // A preceding upload may acknowledge an older edit. Wait within this same total budget,
    // then give newly persisted edits their own sync rather than returning that stale result.
    const previous = pending.get(context.key);
    if (previous) {
        const result = await waitForFlight(context, previous, deadline);
        if (['error', 'offline', 'no-series'].includes(result.status)) return result;
        if (!current(context)) return { values: { ...SERIES_DEFAULTS }, status: 'no-series' };
        try {
            const latest = readLocal(context.key);
            if (!latest.dirty.length && !latest.pendingSeed) return result;
        } catch { return resultFromCache(context, 'error'); }
    }
    return loadContext(context, true, deadline);
}

export function saveSeriesPreferences(item: BaseItemDto, patch: Partial<SeriesValues>, client = ServerConnections.currentApiClient()): Promise<SeriesSyncResult> {
    return savePatch(item, patch, client, false);
}

/** Persist all default fields explicitly, including defaults that currently compare equal. */
export function resetSeriesPreferences(item: BaseItemDto, client = ServerConnections.currentApiClient()): Promise<SeriesSyncResult> {
    return savePatch(item, SERIES_DEFAULTS, client, true);
}

export function rememberSeriesAudio(item: BaseItemDto, language?: string | null) {
    if (language && cachedSeriesPreferences(item).audioMode === 'REMEMBER_LAST_SELECTION') {
        void saveSeriesPreferences(item, { preferredAudioLanguage: language });
    }
}

async function retryPendingOnWake() {
    const identity = observeAuthentication();
    if (!identity || wakeRunning) return;
    const session = captureSeriesPreferencesSession(identity.client);
    const prefix = CACHE_PREFIX + identity.serverId + ':' + identity.userId + ':';
    const keys = new Set(Array.from(memory.keys()).filter(key => key.startsWith(prefix)));
    try {
        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (key?.startsWith(prefix)) keys.add(key);
        }
    } catch { return; }
    wakeRunning = true;
    try {
        let count = 0;
        for (const key of keys) {
            if (!session() || count >= MAX_PENDING_ON_WAKE) break;
            const state = readLocal(key);
            const seriesId = canonicalGuid(key.slice(prefix.length));
            if (!seriesId || (!state.dirty.length && !state.pendingSeed)) continue;
            count++;
            const result = await loadSeriesPreferences({ Type: 'Series', Id: seriesId }, identity.client, true);
            if (result.status === 'offline' || result.status === 'no-series') break;
        }
    } catch { /* Preserve any pending choices; a later explicit retry can report the error. */ } finally { wakeRunning = false; }
}

if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        void retryPendingOnWake();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void retryPendingOnWake();
    });
}
