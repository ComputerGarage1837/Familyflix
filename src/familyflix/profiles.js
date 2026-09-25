const STORAGE_KEY = 'familyflix-desktop-saved-profiles-v1';
const PARTY_KEY = 'familyflix-desktop-active-party-v1';

const cleanId = id => String(id || '').replaceAll('-', '').toLowerCase();

function read(key) {
    try {
        return JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
        return {};
    }
}

function scope(serverId, userId) {
    return `${cleanId(serverId)}:${cleanId(userId)}`;
}

export function rememberProfile(serverId, user, token) {
    if (!serverId || !user?.Id || !token) return;
    const saved = read(STORAGE_KEY);
    saved[scope(serverId, user.Id)] = {
        id: user.Id, name: user.Name, serverId, token
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

export function savedProfile(serverId, userId) {
    return read(STORAGE_KEY)[scope(serverId, userId)] || null;
}

export async function visibleProfiles(apiClient) {
    const users = await apiClient.getPublicUsers();
    // The public login list is authoritative: never reveal cached hidden users.
    return users.map(user => ({
        id: user.Id,
        name: user.Name,
        imageTag: user.PrimaryImageTag,
        saved: Boolean(savedProfile(apiClient.serverId(), user.Id)?.token),
        current: cleanId(user.Id) === cleanId(apiClient.getCurrentUserId())
    }));
}

export async function activateProfile(connection, profile) {
    const apiClient = connection.currentApiClient();
    const saved = savedProfile(apiClient.serverId(), profile.id);
    if (!saved?.token) throw new Error('This profile needs its password on this computer.');
    const response = await fetch(apiClient.getUrl('Users/Me'), {
        headers: { 'X-Emby-Token': saved.token }
    });
    if (!response.ok) throw new Error('Saved sign-in has expired. Enter the password again.');
    const user = await response.json();
    if (cleanId(user.Id) !== cleanId(profile.id)) throw new Error('The saved sign-in belongs to another user.');
    await apiClient.onAuthenticated(apiClient, {
        ServerId: apiClient.serverId(), AccessToken: saved.token, User: user
    });
    // A fresh page clears old-user cards, focus state, and playback state atomically.
    window.location.hash = '#/home';
    window.location.reload();
}

export function partyFor(apiClient) {
    return read(PARTY_KEY)[scope(apiClient.serverId(), apiClient.getCurrentUserId())] || null;
}

export function setParty(apiClient, party) {
    const saved = read(PARTY_KEY);
    const key = scope(apiClient.serverId(), apiClient.getCurrentUserId());
    if (party?.participantUserIds?.length) saved[key] = party;
    else delete saved[key];
    localStorage.setItem(PARTY_KEY, JSON.stringify(saved));
    document.dispatchEvent(new Event('familyflix-party-updated'));
}

export async function reconcileParty(apiClient) {
    const party = partyFor(apiClient);
    if (!party) return;
    // A failed public-directory request is not evidence that a profile was hidden.
    const visible = await visibleProfiles(apiClient);
    const allowed = new Set(visible.map(profile => cleanId(profile.id)));
    const participantUserIds = party.participantUserIds.filter(id => allowed.has(cleanId(id))
        && savedProfile(apiClient.serverId(), id)?.token);
    if (participantUserIds.length === party.participantUserIds.length) return;
    const homeFeedOwnerUserId = participantUserIds.some(id => cleanId(id) === cleanId(party.homeFeedOwnerUserId)) ?
        party.homeFeedOwnerUserId : apiClient.getCurrentUserId();
    setParty(apiClient, { ...party, participantUserIds, homeFeedOwnerUserId });
}

export async function readPresets(apiClient) {
    const prefs = await apiClient.getDisplayPreferences('familyflix-cowatch-presets',
        apiClient.getCurrentUserId(), 'familyflix-androidtv');
    const raw = prefs.CustomPrefs?.presetsV1;
    if (!raw) return { prefs, presets: [] };
    const document = JSON.parse(raw);
    if (document.version !== 1 || !Array.isArray(document.presets)) {
        throw new Error('This Watching Together preset format is not supported. No changes were made.');
    }
    return { prefs, presets: document.presets };
}

export async function savePreset(apiClient, preset) {
    // Read immediately before writing so other Android-created presets are retained.
    const { prefs, presets } = await readPresets(apiClient);
    const updated = presets.filter(item => cleanId(item.id) !== cleanId(preset.id)
        && item.name.toLowerCase() !== preset.name.toLowerCase());
    updated.push(preset);
    prefs.CustomPrefs = {
        ...prefs.CustomPrefs,
        presetsV1: JSON.stringify({ version: 1, presets: updated.slice(-20) })
    };
    await apiClient.updateDisplayPreferences('familyflix-cowatch-presets', prefs,
        apiClient.getCurrentUserId(), 'familyflix-androidtv');
}
