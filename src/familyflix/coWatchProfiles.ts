import type { ApiClient } from 'jellyfin-apiclient';
import type { FamilySession } from './familySession';
import type { CoWatchParticipant } from './coWatchReporter';

export type CoWatchPreset = { name: string; participantIds: string[]; homeUserId: string };
export type CoWatchState = {
    profiles: CoWatchParticipant[];
    presets: CoWatchPreset[];
    activeIds: string[];
    homeUserId: string;
};

const PREFIX = 'familyFlixCoWatchV1:';
const MAX_PROFILES = 20;
const emptyState = (): CoWatchState => ({ profiles: [], presets: [], activeIds: [], homeUserId: '' });

function key(session: FamilySession) {
    return PREFIX + session.serverId + ':' + session.userId;
}
const id = (value: string) => value.toLowerCase().replace(/-/g, '');

/** Each signed-in primary profile owns its own saved participants and presets. */
export function readCoWatchState(session: FamilySession): CoWatchState {
    try {
        const raw = JSON.parse(localStorage.getItem(key(session)) || 'null') as Partial<CoWatchState> | null;
        if (!raw || !Array.isArray(raw.profiles) || !Array.isArray(raw.presets)) return emptyState();
        const profiles = raw.profiles.filter(profile => profile && typeof profile.name === 'string'
            && typeof profile.userId === 'string' && typeof profile.token === 'string'
            && profile.serverId === session.serverId && id(profile.userId) !== id(session.userId))
            .slice(0, MAX_PROFILES);
        const allowed = new Set(profiles.map(profile => id(profile.userId)));
        const activeIds = Array.isArray(raw.activeIds) ? raw.activeIds.filter(value => allowed.has(id(value))) : [];
        const presets = raw.presets.filter(preset => preset && typeof preset.name === 'string'
            && Array.isArray(preset.participantIds)).map(preset => ({
            name: preset.name.slice(0, 40),
            participantIds: preset.participantIds.filter(value => allowed.has(id(value))),
            homeUserId: preset.homeUserId || session.userId
        })).slice(0, 20);
        const homeUserId = raw.homeUserId && (id(raw.homeUserId) === id(session.userId) || allowed.has(id(raw.homeUserId))) ?
            raw.homeUserId : session.userId;
        return { profiles, presets, activeIds, homeUserId };
    } catch { return emptyState(); }
}

export function writeCoWatchState(session: FamilySession, state: CoWatchState): void {
    if (!session.current()) throw new Error('The signed-in profile changed.');
    const validated = {
        ...state,
        profiles: state.profiles.filter(profile => profile.serverId === session.serverId
            && id(profile.userId) !== id(session.userId)).slice(0, MAX_PROFILES),
        presets: state.presets.slice(0, 20)
    };
    localStorage.setItem(key(session), JSON.stringify(validated));
    window.dispatchEvent(new CustomEvent('familyflix-cowatch-changed'));
}

export function activeCoWatchParticipants(session: FamilySession): CoWatchParticipant[] {
    if (!session.current()) return [];
    const state = readCoWatchState(session);
    const selected = new Set(state.activeIds.map(id));
    return state.profiles.filter(profile => selected.has(id(profile.userId)));
}

/** Never display a saved participant's name without checking the visible login list. */
export async function visibleActiveCoWatchNames(session: FamilySession): Promise<string[]> {
    const users = await session.client.getPublicUsers();
    if (!session.current()) return [];
    const visible = new Set(users.map(user => id(user.Id || '')));
    return activeCoWatchParticipants(session).filter(profile => visible.has(id(profile.userId)))
        .map(profile => profile.name);
}

/** Authenticates without changing the browser's primary Jellyfin session. */
export async function addCoWatchProfile(session: FamilySession, client: ApiClient,
    user: { Id?: string | null; Name?: string | null }, password: string): Promise<CoWatchParticipant> {
    if (!session.current() || !user.Id || !user.Name || id(user.Id) === id(session.userId)) {
        throw new Error('Choose another visible user.');
    }
    const response = await fetch(client.getUrl('Users/AuthenticateByName'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Emby-Authorization': `MediaBrowser Client="Family Flix", Device="Windows", DeviceId="${client.deviceId()}-cowatch", Version="${client.appVersion()}"`
        },
        body: JSON.stringify({ Username: user.Name, Pw: password })
    });
    if (!session.current()) throw new Error('The signed-in profile changed.');
    if (!response.ok) throw new Error('That user could not be signed in. Check the password.');
    const result = await response.json() as { User?: { Id?: string; Name?: string }; AccessToken?: string };
    if (!result.AccessToken || id(result.User?.Id || '') !== id(user.Id)) throw new Error('The login response was invalid.');
    const profile: CoWatchParticipant = {
        serverId: session.serverId, userId: user.Id, name: result.User?.Name || user.Name, token: result.AccessToken
    };
    const state = readCoWatchState(session);
    state.profiles = [...state.profiles.filter(saved => id(saved.userId) !== id(profile.userId)), profile];
    writeCoWatchState(session, state);
    return profile;
}

export function disableCoWatch(session: FamilySession): void {
    const state = readCoWatchState(session);
    state.activeIds = [];
    state.homeUserId = session.userId;
    writeCoWatchState(session, state);
}
