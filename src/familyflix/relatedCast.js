const requests = new WeakMap();
export function uniqueCast(people) {
    const seen = new Set();
    return (people || []).filter(person => {
        const key = person.Id || person.Name;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
export async function relatedCast(item, api, userId) {
    const own = uniqueCast(item.People);
    if (item.Type === 'Episode' && own.some(person => person.Type === 'GuestStar')) return own;
    if (!['Episode', 'Season'].includes(item.Type)) return own;
    for (const id of [...new Set([item.Type === 'Episode' ? item.SeasonId : null, item.SeriesId].filter(Boolean))]) {
        try {
            const parent = await api.getItem(userId, id);
            const actors = uniqueCast(parent.People).filter(person => ['Actor', 'GuestStar'].includes(person.Type));
            if (actors.length) return actors;
        } catch { /* Preserve the item's own cast if a parent is unavailable. */ }
    }
    return own;
}
export function refreshRelatedCast(page, item, api, render) {
    const key = {};
    requests.set(page, key);
    const user = api.getCurrentUserId();
    const stop = () => {
        requests.delete(page);
    };
    page.addEventListener('viewbeforehide', stop, { once: true });
    relatedCast(item, api, user).then(people => {
        if (requests.get(page) === key && api.getCurrentUserId() === user) render(people);
    }).finally(() => page.removeEventListener('viewbeforehide', stop));
}
