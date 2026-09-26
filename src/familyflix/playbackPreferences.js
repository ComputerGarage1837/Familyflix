/* eslint-disable @typescript-eslint/naming-convention -- Android preference wire format. */
import { readFamilyProfileValues, saveFamilyProfileValues } from './theme';

export const playbackDefaults = {
    pref_enable_tv_queuing: 'true',
    next_up_behavior: 'EXTENDED',
    next_up_timeout: '7000',
    pref_resume_preroll: '0',
    enable_still_watching: 'DISABLED'
};
const records = new Map();
let profileGeneration = 0;
export const playbackProfileGeneration = () => profileGeneration;
export function changePlaybackProfile() {
    profileGeneration++;
}
const keyFor = (api, userId) => `${api.serverId()}:${userId}`;
const bounded = (value, fallback, max) => {
    const number = Number(value);
    return value == null || value === '' || !Number.isFinite(number) ? fallback : Math.max(0, Math.min(max, Math.round(number)));
};

export function normalizePlaybackPreferences(values = {}) {
    return {
        autoPlay: values.pref_enable_tv_queuing !== 'false',
        nextUp: ['EXTENDED', 'MINIMAL', 'DISABLED'].includes(values.next_up_behavior) ? values.next_up_behavior : 'EXTENDED',
        nextUpSeconds: bounded(values.next_up_timeout, 7000, 30000) / 1000,
        resumeRewindSeconds: bounded(values.pref_resume_preroll, 0, 300),
        stillWatching: ['SHORT', 'DEFAULT', 'LONG', 'VERY_LONG'].includes(values.enable_still_watching) ? values.enable_still_watching : 'DISABLED'
    };
}

export function currentPlaybackPreferences(api, userId = api?.getCurrentUserId()) {
    return normalizePlaybackPreferences(api ? records.get(keyFor(api, userId))?.values : {});
}

export async function loadPlaybackPreferences(api, userId = api.getCurrentUserId(), force = false) {
    const key = keyFor(api, userId);
    const cached = records.get(key);
    if (!force && cached && Date.now() - cached.loaded < 60000) return cached.values;
    const values = await readFamilyProfileValues(api, userId);
    records.set(key, { values, loaded: Date.now() });
    return values;
}

export async function preparePlaybackPreferences(api) {
    if (!api) return;
    // A slow/offline preferences endpoint must not hold up playback indefinitely.
    let timer;
    try {
        await Promise.race([
            loadPlaybackPreferences(api),
            new Promise(resolve => { timer = setTimeout(resolve, 1500); })
        ]);
    } catch (error) {
        console.warn('Using cached Family Flix playback preferences:', error);
    } finally {
        clearTimeout(timer);
    }
}

export async function savePlaybackPreferences(api, userId, changes, original) {
    const expected = {};
    const changed = {};
    for (const key of Object.keys(playbackDefaults)) {
        if (changes[key] !== (original[key] ?? playbackDefaults[key])) {
            changed[key] = changes[key];
            expected[key] = original[key] ?? '';
        }
    }
    const values = await saveFamilyProfileValues(api, userId, changed, expected);
    records.set(keyFor(api, userId), { values, loaded: Date.now() });
    return values;
}

export function resumedPosition(ticks, preferences, item, changingStream = false) {
    if (changingStream || item?.Type === 'TvChannel' || !ticks || ticks < 0) return ticks;
    return Math.max(0, ticks - preferences.resumeRewindSeconds * 10000000);
}

const stillWatchingThresholds = { SHORT: [2, 60], DEFAULT: [3, 90], LONG: [5, 150], VERY_LONG: [8, 240] };
export class UninterruptedEpisodes {
    constructor() { this.reset(); }
    reset() {
        this.count = 0;
        this.minutes = 0;
        this.interrupted = false;
    }
    interaction() {
        this.reset();
        this.interrupted = true;
    }
    completed(runtimeTicks) {
        if (!this.interrupted) this.count++;
        this.minutes += Math.max(0, Number(runtimeTicks) || 0) / 600000000;
        this.interrupted = false;
    }
    needsConfirmation(mode) {
        const threshold = stillWatchingThresholds[mode];
        return Boolean(threshold && (this.count >= threshold[0] || this.minutes >= threshold[1]));
    }
}
/* eslint-enable @typescript-eslint/naming-convention */
