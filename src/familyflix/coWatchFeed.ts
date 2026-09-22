import type { ApiClient } from 'jellyfin-apiclient';
import type { BaseItemDtoQueryResult } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto-query-result';
import { captureFamilySession } from './familySession';
import { readCoWatchState, type CoWatchState } from './coWatchProfiles';
import type { CoWatchParticipant } from './coWatchReporter';

const canonical = (value: string) => value.toLowerCase().replace(/-/g, '');

export function selectedHomeProfile(state: CoWatchState): CoWatchParticipant | undefined {
    return state.profiles.find(candidate => canonical(candidate.userId) === canonical(state.homeUserId)
        && state.activeIds.some(value => canonical(value) === canonical(candidate.userId)));
}

export function secondaryFeedRoute(path: string, query: Record<string, string>, userId: string) {
    return {
        path: path.replace('{userId}', userId),
        query: { ...query, ...(path === 'Shows/NextUp' ? { UserId: userId } : {}) }
    };
}

/** A selected home feed is never fetched using the primary user's token. */
export async function selectedCoWatchFeed(client: ApiClient, path: string,
    query: Record<string, string>): Promise<BaseItemDtoQueryResult | undefined> {
    const session = captureFamilySession(client);
    if (!session) return undefined;
    const state = readCoWatchState(session);
    const profile = selectedHomeProfile(state);
    if (!profile) return undefined;
    // eslint-disable-next-line compat/compat -- The legacy entrypoint supplies an AbortController polyfill.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
        const route = secondaryFeedRoute(path, query, profile.userId);
        const response = await fetch(client.getUrl(route.path, route.query), {
            signal: controller.signal,
            headers: { 'X-Emby-Token': profile.token }
        });
        if (!response.ok || !session.current()) throw new Error('The selected home feed is unavailable.');
        const result = await response.json() as BaseItemDtoQueryResult;
        if (!session.current() || !Array.isArray(result.Items)) throw new Error('The home feed changed.');
        return result;
    } finally { clearTimeout(timer); }
}
