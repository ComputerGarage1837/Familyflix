import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';

export type FamilyNightCandidate = {
    item: BaseItemDto;
    id: string;
    kind: 'movie' | 'show';
    runtimeMinutes?: number;
    genres: string[];
    requiredAge?: number;
    profiles: string[];
};

export type FamilyNightFilter = {
    media: 'all' | 'movie' | 'show';
    maxRuntimeMinutes?: number;
    genre?: string;
    maxRequiredAge?: number;
};

const TICKS_PER_MINUTE = 600_000_000;
const RATINGS = new Map([
    ['TV-Y7', 7], ['TV-Y', 0], ['TV-G', 0], ['TV-PG', 10], ['TV-MA', 17],
    ['NC-17', 18], ['PG-13', 13], ['PG', 8], ['G', 0], ['R', 17]
]);

export function requiredAge(rating?: string | null): number | undefined {
    const normalized = rating?.trim().toUpperCase();
    if (!normalized) return undefined;
    for (const [label, age] of RATINGS) {
        if (normalized === label || normalized.endsWith('-' + label)) return age;
    }
    const numeric = /(?:^|[^0-9])(\d{1,2})(?:A|\+)?$/.exec(normalized);
    return numeric ? Number(numeric[1]) : undefined;
}

export function toFamilyNightCandidate(item: BaseItemDto, profile: string): FamilyNightCandidate | undefined {
    if (!item.Id || (item.Type !== 'Movie' && item.Type !== 'Series')) return undefined;
    const runtime = Number(item.RunTimeTicks);
    return {
        item,
        id: item.Id,
        kind: item.Type === 'Movie' ? 'movie' : 'show',
        runtimeMinutes: Number.isFinite(runtime) && runtime > 0 ? Math.ceil(runtime / TICKS_PER_MINUTE) : undefined,
        genres: (item.Genres || []).map(genre => genre.trim()).filter(Boolean),
        requiredAge: requiredAge(item.OfficialRating),
        profiles: [profile]
    };
}

export function mergeFamilyNightCandidates(candidates: FamilyNightCandidate[]): FamilyNightCandidate[] {
    const merged = new Map<string, FamilyNightCandidate>();
    for (const candidate of candidates) {
        const key = candidate.id.toLowerCase().replace(/-/g, '');
        const previous = merged.get(key);
        merged.set(key, previous ? {
            ...previous,
            profiles: [...new Set([...previous.profiles, ...candidate.profiles])]
        } : candidate);
    }
    return [...merged.values()];
}

export function matchesFamilyNight(candidate: FamilyNightCandidate, filter: FamilyNightFilter): boolean {
    return (filter.media === 'all' || candidate.kind === filter.media)
        && (filter.maxRuntimeMinutes === undefined || (candidate.runtimeMinutes !== undefined
            && candidate.runtimeMinutes <= filter.maxRuntimeMinutes))
        && (!filter.genre || candidate.genres.some(genre => genre.toLowerCase() === filter.genre?.toLowerCase()))
        && (filter.maxRequiredAge === undefined || (candidate.requiredAge !== undefined
            && candidate.requiredAge <= filter.maxRequiredAge));
}

export function pickFamilyNight(candidates: FamilyNightCandidate[], filter: FamilyNightFilter,
    excludeId?: string, random = Math.random): FamilyNightCandidate | undefined {
    const matches = candidates.filter(candidate => matchesFamilyNight(candidate, filter));
    if (!matches.length) return undefined;
    const pool = matches.filter(candidate => candidate.id !== excludeId);
    const choices = pool.length ? pool : matches;
    return choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)))];
}
