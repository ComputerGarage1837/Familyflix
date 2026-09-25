import { partyFor, savedProfile, visibleProfiles } from './profiles';
import { readKidsSettings } from './kidsMode';

const active = new Map();
const cleanId = id => String(id || '').replaceAll('-', '').toLowerCase();
const endpoints = {
    reportPlaybackStart: 'Sessions/Playing',
    reportPlaybackProgress: 'Sessions/Playing/Progress',
    reportPlaybackStopped: 'Sessions/Playing/Stopped'
};

function sessionKey(info) {
    return info.PlaySessionId || `item:${cleanId(info.ItemId)}`;
}

async function begin(apiClient) {
    if (readKidsSettings(apiClient).enabled) return null;
    const party = partyFor(apiClient);
    if (!party?.participantUserIds?.length) return null;
    const visible = await visibleProfiles(apiClient);
    const visibleIds = new Set(visible.map(profile => cleanId(profile.id)));
    const participants = party.participantUserIds
        .filter(id => visibleIds.has(cleanId(id)))
        .map(id => savedProfile(apiClient.serverId(), id))
        .filter(profile => profile?.token);
    if (!participants.length) return null;
    return { participants, queue: Promise.resolve(), owner: cleanId(apiClient.getCurrentUserId()) };
}

function send(apiClient, participant, endpoint, info) {
    return fetch(apiClient.getUrl(endpoint), {
        method: 'POST',
        headers: {
            'X-Emby-Token': participant.token,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(info)
    }).then(response => {
        if (!response.ok) throw new Error(`Watching Together report failed (${response.status})`);
    });
}

/** Mirror the normal Jellyfin playback reports through each participant's own saved login. */
export async function reportCoWatch(apiClient, method, info) {
    const endpoint = endpoints[method];
    if (!endpoint) return;
    const key = sessionKey(info);
    let session = active.get(key);
    if (method === 'reportPlaybackStart') {
        session = {
            participants: [],
            owner: cleanId(apiClient.getCurrentUserId()),
            queue: begin(apiClient).then(captured => {
                if (captured) session.participants = captured.participants;
            })
        };
        active.set(key, session);
    }
    if (!session) return;
    const currentParty = partyFor(apiClient);
    if (!currentParty || session.owner !== cleanId(apiClient.getCurrentUserId())) {
        active.delete(key);
        return;
    }
    session.queue = session.queue.then(async () => {
        if (active.get(key) !== session) return;
        await Promise.allSettled(session.participants.map(participant => send(apiClient, participant, endpoint, info)));
    });
    if (method === 'reportPlaybackStopped') {
        await session.queue;
        active.delete(key);
    }
}

export function abandonCoWatch() {
    active.clear();
}

export async function reportCoWatchPlayed(apiClient, itemId, played) {
    const captured = await begin(apiClient);
    if (!captured || !partyFor(apiClient)) return;
    const endpoint = `UserPlayedItems/${encodeURIComponent(itemId)}`;
    await Promise.allSettled(captured.participants.map(participant => fetch(apiClient.getUrl(endpoint, {
        userId: participant.id,
        ...(played ? { datePlayed: new Date().toISOString() } : {})
    }), {
        method: played ? 'POST' : 'DELETE',
        headers: { 'X-Emby-Token': participant.token }
    }).then(response => {
        if (!response.ok) throw new Error(`Watching Together watched-state update failed (${response.status})`);
    })));
}
