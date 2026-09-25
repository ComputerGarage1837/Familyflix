/* eslint-disable @typescript-eslint/naming-convention -- Android uses stable wire-format preference keys. */
import './theme.scss';

const PREFERENCES_ID = 'familyflix-profile-settings-v1';
const PREFERENCES_CLIENT = 'familyflix-androidtv';
const PREFERENCES_KEY = 'familyFlixProfileSettingsV1';

// Screen, surface, accent, secondary accent, text, on-accent: the same
// palette roles and values used by Family Flix on Android TV.
export const familyThemes = {
    DARK: ['Ocean', '#071116', '#102028', '#20C5C7', '#9585FF', '#F4FBFC', '#042326'],
    MUTED_PURPLE: ['Violet', '#100A18', '#1B1226', '#B879EF', '#60DDE1', '#FBF7FF', '#23102E'],
    ROYAL_BLUE: ['Royal Blue', '#07101D', '#101E30', '#5AA2FF', '#FF91A6', '#F3F8FF', '#071B33'],
    EMERALD: ['Forest', '#08140D', '#102419', '#58CE83', '#E8BB60', '#F3FBF5', '#082415'],
    AMBER: ['Amber', '#171006', '#2A1D0B', '#F2AA3B', '#55D4C6', '#FFF8EA', '#2B1900'],
    ROSE: ['Rose', '#170A10', '#2A121D', '#EC79A8', '#66D6D0', '#FFF6FA', '#35101F'],
    CRIMSON: ['Crimson', '#160908', '#291311', '#EF756D', '#F2B84B', '#FFF7F5', '#35100D'],
    INDIGO: ['Indigo', '#0A0B18', '#15162A', '#8D94FF', '#52D6CE', '#F7F7FF', '#141636'],
    LIME: ['Lime', '#0D1508', '#192510', '#A4CF55', '#5FC6DD', '#F8FCEB', '#1B2808'],
    COPPER: ['Copper', '#160E09', '#291B13', '#DC8B5F', '#75C7C1', '#FFF8F3', '#32180B'],
    GRAPHITE: ['Graphite', '#0D0E10', '#1A1C1F', '#A4B0BA', '#E3A65A', '#F7F8F9', '#171B1E'],
    AURORA: ['Aurora', '#071326', '#101E32', '#42E0C5', '#B079FF', '#F5FBFF', '#031D24'],
    SUNSET_CINEMA: ['Sunset Cinema', '#180A19', '#271426', '#FFB44D', '#FF718F', '#FFF8EF', '#351700'],
    NEON_ARCADE: ['Neon Arcade', '#050817', '#0E1730', '#2DE2E6', '#FF4FD8', '#F7FBFF', '#0A1804'],
    CINEMA_NOIR: ['Cinema Noir', '#101113', '#1C1E21', '#E6E1D7', '#D45D68', '#F5F3EE', '#16130D']
};

function parseDocument(preferences) {
    const raw = preferences?.CustomPrefs?.[PREFERENCES_KEY];
    if (!raw) return { version: 1, revision: 0, values: {} };
    const document = JSON.parse(raw);
    if (document?.version !== 1 || !document.values || typeof document.values !== 'object') {
        throw new Error('Shared Family Flix settings have an unsupported format.');
    }
    return document;
}

export async function readFamilyTheme(apiClient, userId) {
    const values = await readFamilyProfileValues(apiClient, userId);
    return familyThemes[values.app_theme] ? values.app_theme : 'DARK';
}

export async function readFamilyProfileValues(apiClient, userId) {
    const preferences = await apiClient.getDisplayPreferences(PREFERENCES_ID, userId, PREFERENCES_CLIENT);
    return parseDocument(preferences).values;
}

export function applyFamilyTheme(name) {
    const selected = familyThemes[name] ? name : 'DARK';
    const [, screen, surface, accent, secondary, text, onAccent] = familyThemes[selected];
    const style = document.documentElement.style;
    style.setProperty('--ff-screen', screen);
    style.setProperty('--ff-surface', surface);
    style.setProperty('--ff-accent', accent);
    style.setProperty('--ff-secondary', secondary);
    style.setProperty('--ff-text', text);
    style.setProperty('--ff-on-accent', onAccent);
    document.documentElement.dataset.familyTheme = selected;
    document.getElementById('themeColor')?.setAttribute('content', screen);
}

export async function loadFamilyTheme(apiClient, userId) {
    const values = await readFamilyProfileValues(apiClient, userId);
    const selected = familyThemes[values.app_theme] ? values.app_theme : 'DARK';
    if (apiClient.getCurrentUserId() === userId) {
        applyFamilyTheme(selected);
        document.documentElement.dataset.familyClock = values.pref_clock_behavior || 'ALWAYS';
        document.documentElement.dataset.familyBackdrops = values.pref_show_backdrop || 'true';
        document.dispatchEvent(new Event('familyflix-settings-updated'));
    }
    return selected;
}

export async function saveFamilyTheme(apiClient, userId, selected, expected) {
    if (!familyThemes[selected]) throw new Error('Unknown Family Flix theme.');
    await saveFamilyProfileValues(apiClient, userId, { app_theme: selected }, { app_theme: expected });
    if (apiClient.getCurrentUserId() === userId) applyFamilyTheme(selected);
    return selected;
}

export async function saveFamilyProfileValues(apiClient, userId, changes, expected = {}) {
    // Refresh immediately before writing. Keep every unrelated Android setting.
    const preferences = await apiClient.getDisplayPreferences(PREFERENCES_ID, userId, PREFERENCES_CLIENT);
    const document = parseDocument(preferences);
    const updated = { ...document.values };
    const defaults = { app_theme: 'DARK', pref_clock_behavior: 'ALWAYS', pref_show_backdrop: 'true' };
    for (const [key, value] of Object.entries(changes)) {
        if (Object.prototype.hasOwnProperty.call(expected, key)
            && expected[key] !== (document.values[key] ?? defaults[key] ?? '')) {
            throw new Error('A Family Flix setting changed on another device. Reload settings first.');
        }
        updated[key] = value;
    }
    if (Object.keys(changes).some(key => updated[key] !== document.values[key])) {
        document.revision = Number(document.revision || 0) + 1;
        document.updatedAtEpochMillis = Date.now();
        document.writerDeviceId = apiClient.deviceId?.() || 'familyflix-windows';
        document.values = updated;
        preferences.CustomPrefs = { ...preferences.CustomPrefs, [PREFERENCES_KEY]: JSON.stringify(document) };
        await apiClient.updateDisplayPreferences(PREFERENCES_ID, preferences, userId, PREFERENCES_CLIENT);
    }
    return updated;
}

export function clearFamilyTheme() {
    delete document.documentElement.dataset.familyTheme;
    delete document.documentElement.dataset.familyClock;
    delete document.documentElement.dataset.familyBackdrops;
    document.dispatchEvent(new Event('familyflix-settings-updated'));
    for (const name of ['screen', 'surface', 'accent', 'secondary', 'text', 'on-accent']) {
        document.documentElement.style.removeProperty(`--ff-${name}`);
    }
}
/* eslint-enable @typescript-eslint/naming-convention */
