import { familyRequest, type FamilySession } from './familySession';
import { type HealthSnapshot, parseHealthSnapshot } from './healthPolicy';
import { objectValue } from './issuePolicy';

const PREFIX = 'FamilyFlix/Health/';
const FRESH_MS = 30_000;
export type HealthCapabilities = { isAdmin: boolean; version: string };
const capabilities = new Map<string, { value?: HealthCapabilities; readAt: number; session: FamilySession }>();
const flights = new Map<string, { session: FamilySession; promise: Promise<HealthCapabilities | undefined> }>();

export async function healthCapabilities(session: FamilySession, force = false): Promise<HealthCapabilities | undefined> {
    if (!session.current()) return undefined;
    const cached = capabilities.get(session.key);
    if (!force && cached?.session.current() && Date.now() - cached.readAt < (cached.value ? FRESH_MS : 2000)) return cached.value;
    const previous = flights.get(session.key);
    if (previous?.session.current()) return previous.promise;
    const promise = (async () => {
        let value: HealthCapabilities | undefined;
        try {
            const dto = objectValue(await familyRequest(session, PREFIX + 'Capabilities'));
            if (dto.schema !== 1 || typeof dto.isAdmin !== 'boolean' || typeof dto.version !== 'string' || !dto.version) {
                throw new Error('Invalid Health Centre capability response');
            }
            value = { isAdmin: dto.isAdmin, version: dto.version };
        } catch { /* A missing endpoint, failed request, or malformed response is never administrator access. */ }
        if (!session.current()) return undefined;
        capabilities.set(session.key, { value, readAt: Date.now(), session });
        return value;
    })();
    const flight = { session, promise };
    flights.set(session.key, flight);
    try {
        return await promise;
    } finally {
        if (flights.get(session.key) === flight) flights.delete(session.key);
    }
}

export async function loadHealthSnapshot(session: FamilySession, forceCapabilities = false): Promise<HealthSnapshot> {
    const capability = await healthCapabilities(session, forceCapabilities);
    if (!capability?.isAdmin || !session.current()) throw new Error('Health Centre administrator access is unavailable');
    const snapshot = parseHealthSnapshot(await familyRequest(session, PREFIX + 'Snapshot', { timeout: 3000 }));
    if (!session.current()) throw new Error('The active profile changed while Health Centre was loading');
    return snapshot;
}
