import type { ApiClient } from 'jellyfin-apiclient';
import { captureFamilySession } from './familySession';

export const SPEED_STAGES = {
    'home-ready': 'Home ready (data + page update)',
    'deck-ready': 'Next Up / Deck row ready (data + page update)',
    'season-ready': 'Season ready (data + page update)',
    'playback-start': 'Playback start (player acknowledged)',
    'artwork-decode': 'Artwork decode'
} as const;
export type SpeedStage = keyof typeof SPEED_STAGES;
export type SpeedSample = { stage: SpeedStage; durationMs: number; at: number };
const LIMIT = 120;
const PREFIX = 'familyflix-speed-v1:';
const memory = new Map<string, SpeedSample[]>();

export function appendSpeedSample(samples: SpeedSample[], sample: SpeedSample): SpeedSample[] {
    if (!Object.prototype.hasOwnProperty.call(SPEED_STAGES, sample.stage)
        || !Number.isFinite(sample.durationMs) || sample.durationMs < 0 || sample.durationMs > 600_000
        || !Number.isFinite(sample.at) || sample.at < 0) return samples;
    return [...samples, { stage: sample.stage, durationMs: Math.round(sample.durationMs), at: sample.at }].slice(-LIMIT);
}

export function summarizeSpeed(samples: SpeedSample[]) {
    return Object.entries(SPEED_STAGES).map(([stage, label]) => {
        const matches = samples.filter(sample => sample.stage === stage);
        const sorted = matches.map(sample => sample.durationMs).sort((first, second) => first - second);
        const middle = Math.floor(sorted.length / 2);
        let median: number | undefined;
        if (sorted.length) {
            median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
        }
        return { stage, label, count: matches.length, recentMs: matches[matches.length - 1]?.durationMs, medianMs: median };
    });
}

function readSamples(key: string): SpeedSample[] {
    if (memory.has(key)) return memory.get(key)!;
    let result: SpeedSample[] = [];
    try {
        const raw: unknown = JSON.parse(localStorage.getItem(PREFIX + key) || '[]');
        if (Array.isArray(raw)) {
            raw.slice(-LIMIT).forEach(sample => {
                if (sample && typeof sample === 'object') result = appendSpeedSample(result, sample as SpeedSample);
            });
        }
    } catch { /* Diagnostics must never block normal app use. */ }
    memory.set(key, result);
    return result;
}

/** No title, item id, path, token, URL or media history is accepted by this API. */
export function beginFamilySpeed(stage: SpeedStage, client?: ApiClient, clock: () => number = () => performance.now()): () => void {
    const session = captureFamilySession(client);
    const started = clock();
    let finished = false;
    return () => {
        if (finished) return;
        finished = true;
        if (!session?.current() || document.hidden) return;
        const samples = appendSpeedSample(readSamples(session.key), { stage, durationMs: clock() - started, at: Date.now() });
        memory.set(session.key, samples);
        try {
            localStorage.setItem(PREFIX + session.key, JSON.stringify(samples));
        } catch { /* Memory-only if storage is full/disabled. */ }
    };
}

export function familySpeedSummary(client?: ApiClient) {
    const session = captureFamilySession(client);
    return summarizeSpeed(session ? readSamples(session.key) : []);
}

export function clearFamilySpeed(client?: ApiClient): boolean {
    const session = captureFamilySession(client);
    if (!session?.current()) return false;
    memory.set(session.key, []);
    try {
        localStorage.removeItem(PREFIX + session.key);
        return true;
    } catch {
        return false;
    }
}
