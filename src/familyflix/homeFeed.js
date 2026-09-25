import { ApiClient } from 'jellyfin-apiclient';

import { appHost } from 'components/apphost';
import { getFamilyDeck } from './deck';
import { mergeGroupDecks } from './groupDeck';
import { readKidsSettings } from './kidsMode';
import { partyFor, savedProfile } from './profiles';

const cleanId = id => String(id || '').replaceAll('-', '').toLowerCase();

export function alternateClient(primary, userId) {
    if (cleanId(userId) === cleanId(primary.getCurrentUserId())) return primary;
    const saved = savedProfile(primary.serverId(), userId);
    if (!saved?.token) return null;
    const client = new ApiClient(primary.serverAddress(), appHost.appName(), appHost.appVersion(),
        appHost.deviceName(), appHost.deviceId());
    client.serverInfo(primary.serverInfo());
    client.setAuthenticationInfo(saved.token, userId);
    return client;
}

export function homeFeedClient(primary) {
    if (readKidsSettings(primary).enabled) return primary;
    const party = partyFor(primary);
    if (!party?.homeFeedOwnerUserId) return primary;
    return alternateClient(primary, party.homeFeedOwnerUserId) || primary;
}

export async function homeDeck(primary, options, limit) {
    if (readKidsSettings(primary).enabled) return getFamilyDeck(primary, options, limit);
    const party = partyFor(primary);
    if (!party?.combinedGroupDeckEnabled || !party.participantUserIds?.length) {
        const client = homeFeedClient(primary);
        return getFamilyDeck(client, { ...options, UserId: client.getCurrentUserId() }, limit);
    }
    const clients = [primary, ...party.participantUserIds.map(id => alternateClient(primary, id)).filter(Boolean)];
    const results = await Promise.allSettled(clients.map(client => getFamilyDeck(client, {
        ...options, UserId: client.getCurrentUserId()
    }, limit)));
    const decks = results.filter(result => result.status === 'fulfilled').map(result => result.value.Items || []);
    const items = mergeGroupDecks(decks, limit);
    return { Items: items, TotalRecordCount: items.length };
}
