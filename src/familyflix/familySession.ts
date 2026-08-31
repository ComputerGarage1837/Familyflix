/* eslint-disable @stylistic/max-statements-per-line -- Short fail-closed guards stay adjacent to the operation they protect. */
import type { ApiClient } from 'jellyfin-apiclient';
import { ServerConnections } from '../lib/jellyfin-apiclient';
import Events from '../utils/events';
import { canonicalGuid } from './seriesPreferencePolicy';

type Identity = { client: ApiClient; userId: string; serverId: string; token: string; address: string };
export type FamilySession = Identity & { key: string; current: () => boolean };
let previous: Identity | undefined;
let epoch = 0;
let bound = false;
const listeners = new Set<() => void>();
const requests = new Set<AbortController>();

function identity(): Identity | undefined {
    try {
        const client = ServerConnections.currentApiClient();
        const userId = canonicalGuid(client?.getCurrentUserId());
        const serverId = canonicalGuid(client?.serverId());
        const token = client?.accessToken();
        const address = client?.serverAddress();
        return client && userId && serverId && token && address ? { client, userId, serverId, token, address } : undefined;
    } catch { return undefined; }
}

function same(first?: Identity, second?: Identity) {
    return first && second ? first.client === second.client && first.userId === second.userId
        && first.serverId === second.serverId && first.token === second.token && first.address === second.address : first === second;
}

function invalidate() {
    epoch++;
    previous = identity();
    requests.forEach(request => { request.abort(); });
    listeners.forEach(listener => { listener(); });
}

function observe() {
    // Never read the singleton during module initialization: the existing player
    // imports participate in the ServerConnections -> Dashboard -> player cycle.
    if (!bound) {
        Events.on(ServerConnections, 'localusersignedin', invalidate);
        Events.on(ServerConnections, 'localusersignedout', invalidate);
        Events.on(ServerConnections, 'connected', invalidate);
        bound = true;
    }
    const active = identity();
    if (!same(active, previous)) invalidate();
    return active;
}

export function captureFamilySession(client?: ApiClient): FamilySession | undefined {
    const active = observe();
    if (!active || (client && active.client !== client)) return undefined;
    const generation = epoch;
    return {
        ...active, key: active.serverId + ':' + active.userId,
        current: () => {
            const next = observe();
            return generation === epoch && same(active, next);
        }
    };
}

export function onFamilySessionChange(listener: () => void): () => void {
    observe();
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export class FamilyRequestError extends Error {
    constructor(message: string, readonly status = 0, readonly payload?: unknown) { super(message); }
}

/** A total deadline also settles fetch implementations which ignore AbortSignal. */
export async function familyRequest(session: FamilySession, path: string, options: {
    method?: 'GET' | 'POST' | 'PUT'; body?: unknown; query?: Record<string, string>; timeout?: number
} = {}): Promise<unknown> {
    if (!session.current()) throw new FamilyRequestError('This profile is no longer active', 401);
    // eslint-disable-next-line compat/compat -- AbortController is polyfilled by the existing legacy entrypoint.
    const controller = new AbortController();
    requests.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: () => void = () => undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
        abort = () => reject(new FamilyRequestError('The request could not be completed'));
        controller.signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => controller.abort(), Math.max(0, Math.min(3000, options.timeout ?? 1500)));
    });
    const work = async () => {
        const response = await fetch(session.client.getUrl(path, options.query || {}, session.address), {
            method: options.method || 'GET', signal: controller.signal,
            headers: { 'X-Emby-Token': session.token, 'Content-Type': 'application/json' },
            ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
        });
        if (!session.current() || controller.signal.aborted) throw new FamilyRequestError('This profile is no longer active', 401);
        let payload: unknown;
        try { payload = await response.json(); } catch { payload = undefined; }
        if (!session.current() || controller.signal.aborted) throw new FamilyRequestError('This profile is no longer active', 401);
        if (!response.ok) throw new FamilyRequestError('The server did not accept this request', response.status, payload);
        return payload;
    };
    try { return await Promise.race([work(), interrupted]); } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', abort);
        requests.delete(controller);
    }
}

/** A public idempotency key, never an authentication credential. */
export function familyOperationId(): string {
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) { globalThis.crypto.getRandomValues(bytes); } else {
        // eslint-disable-next-line sonarjs/pseudo-random -- Public operation correlation only.
        for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}
/* eslint-enable @stylistic/max-statements-per-line */
