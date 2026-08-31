import type { ApiClient } from 'jellyfin-apiclient';
import { captureFamilySession, familyRequest } from './familySession';
import { canonicalGuid } from './seriesPreferencePolicy';
import { objectValue } from './issuePolicy';

type Mapping = { preferenceId: string; at: number; stable: boolean };
const identities = new Map<string, Mapping>();
const flights = new Map<string, Promise<string>>();

export function cachedPreferenceSeriesId(seriesId: string, client?: ApiClient): string {
    const actual = canonicalGuid(seriesId) || seriesId;
    const session = captureFamilySession(client);
    return session ? identities.get(session.key + ':' + actual)?.preferenceId || actual : actual;
}

/** Uses a small portion of the existing total preferences budget; no migration or writes. */
export async function resolvePreferenceSeriesId(seriesId: string, client: ApiClient, timeout = 350, force = false): Promise<string> {
    const actual = canonicalGuid(seriesId);
    const session = captureFamilySession(client);
    if (!actual || !session) return actual || seriesId;
    const key = session.key + ':' + actual;
    const cached = identities.get(key);
    if (!force && cached && Date.now() - cached.at < (cached.stable ? 60_000 : 1500)) return cached.preferenceId;
    const previous = flights.get(key);
    if (previous) return previous;
    const work = (async () => {
        let preferenceId = actual;
        let stable = false;
        try {
            const dto = objectValue(await familyRequest(session, 'FamilyFlix/Playback/SeriesIdentity/' + actual, { timeout: Math.min(350, timeout) }));
            const resolved = typeof dto.preferenceSeriesId === 'string' && canonicalGuid(dto.preferenceSeriesId);
            const matchedBy = String(dto.matchedBy);
            if (dto.schema === 1 && canonicalGuid(String(dto.seriesId)) === actual && dto.ready === true && resolved
                && (matchedBy === 'providerIds' || (matchedBy === 'seriesId' && resolved === actual))) {
                preferenceId = resolved;
                stable = true;
            }
        } catch { /* An old/unavailable plugin retains current UUID behavior. */ }
        if (!session.current()) return actual;
        identities.set(key, { preferenceId, stable, at: Date.now() });
        while (identities.size > 300) identities.delete(identities.keys().next().value!);
        return preferenceId;
    })();
    flights.set(key, work);
    try {
        return await work;
    } finally {
        if (flights.get(key) === work) flights.delete(key);
    }
}
