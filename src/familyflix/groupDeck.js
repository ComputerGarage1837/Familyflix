const cleanId = id => String(id || '').replaceAll('-', '').toLowerCase();

export function mergeGroupDecks(decks, limit) {
    const items = [];
    const seen = new Set();
    const length = Math.max(0, ...decks.map(deck => deck.length));
    for (let index = 0; index < length; index++) {
        for (const deck of decks) {
            const item = deck[index];
            if (!item || item.UserData?.Played) continue;
            const series = cleanId(item.SeriesId || item.SeriesName);
            const key = series && item.ParentIndexNumber != null && item.IndexNumber != null ?
                `episode:${series}:${item.ParentIndexNumber}:${item.IndexNumber}` : `item:${cleanId(item.Id)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            items.push(item);
            if (items.length >= limit) return items;
        }
    }
    return items;
}
