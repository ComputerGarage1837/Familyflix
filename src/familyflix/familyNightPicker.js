const ratings = new Map([
    ['TV-Y', 0], ['TV-Y7', 7], ['TV-G', 0], ['TV-PG', 10], ['TV-MA', 17],
    ['G', 0], ['PG', 8], ['PG-13', 13], ['R', 17], ['NC-17', 18]
]);

export function requiredAge(rating) {
    const normalized = String(rating || '').trim().toUpperCase();
    for (const [name, age] of ratings) {
        if (normalized === name || normalized.endsWith(`-${name}`)) return age;
    }
    const match = /(?:^|\D)(\d{1,2})[A+]?$/i.exec(normalized);
    return match ? Number(match[1]) : null;
}

export function matchingCandidates(items, filter) {
    return items.filter(item => {
        if (filter.media !== 'All' && item.Type !== (filter.media === 'Movies' ? 'Movie' : 'Series')) return false;
        if (filter.runtime && (!item.RunTimeTicks || Math.ceil(item.RunTimeTicks / 600000000) > filter.runtime)) return false;
        if (filter.genre && !(item.Genres || []).some(genre => genre.toLowerCase() === filter.genre.toLowerCase())) return false;
        return filter.age === null || (requiredAge(item.OfficialRating) ?? Number.POSITIVE_INFINITY) <= filter.age;
    });
}

export function pickCandidate(items, filter, previousId, random = Math.random) {
    const candidates = matchingCandidates(items, filter);
    const pool = candidates.filter(item => item.Id !== previousId);
    const choices = pool.length ? pool : candidates;
    return choices[Math.floor(random() * choices.length)] || null;
}
