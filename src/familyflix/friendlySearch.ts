import type { Api } from '@jellyfin/sdk/lib/api';
import { getItemsApi } from '@jellyfin/sdk/lib/utils/api/items-api';
import type { ItemsApiGetItemsRequest } from '@jellyfin/sdk/lib/generated-client/api/items-api';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { AxiosRequestConfig } from 'axios';

export function compactTitle(value: string): string {
    return value.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(new RegExp('[^\\p{L}\\p{N}]', 'gu'), '');
}

function distance(a: string, b: string): number {
    const rows = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) rows[i][0] = i;
    for (let j = 0; j <= b.length; j++) rows[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
        rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
    return rows[a.length][b.length];
}

/** Lower is better. Punctuation equivalents precede conservative spelling suggestions. */
export function titleMatchScore(title: string, query: string): number {
    const term = compactTitle(query).slice(0, 100);
    const name = compactTitle(title).slice(0, 300);
    if (!term) return Infinity;
    if (title.trim().toLowerCase() === query.trim().toLowerCase()) return 0;
    if (name === term) return 1;
    if (name.startsWith(term)) return 2;
    if (name.includes(term)) return 3;
    if (term.length < 4) return Infinity;
    const allowance = term.length >= 8 ? 2 : 1;
    const candidates = [name, ...title.split(new RegExp('[^\\p{L}\\p{N}]+', 'u')).map(compactTitle)];
    for (let length = Math.max(1, term.length - allowance); length <= term.length + allowance; length++) candidates.push(name.slice(0, length));
    let best = Infinity;
    for (const candidate of candidates) if (Math.abs(candidate.length - term.length) <= allowance) best = Math.min(best, distance(term, candidate));
    return best <= allowance ? 10 + best : Infinity;
}

const indexes = new WeakMap<Api, Map<string, { at: number; pending: Promise<BaseItemDto[]> }>>();
async function titleIndex(api: Api, userId: string, params: ItemsApiGetItemsRequest, options?: AxiosRequestConfig) {
    let cache = indexes.get(api);
    if (!cache) { cache = new Map(); indexes.set(api, cache); }
    const types = params.includeItemTypes?.filter(type => type === 'Movie' || type === 'Series') || [];
    if (!types.length) return [];
    const key = JSON.stringify([userId, params.parentId, types]);
    const previous = cache.get(key);
    if (previous && Date.now() - previous.at < 120000) return previous.pending;
    const pending = (async () => {
        const items: BaseItemDto[] = [];
        for (let startIndex = 0; ; startIndex += 1000) {
            const response = await getItemsApi(api).getItems({ userId, parentId: params.parentId, includeItemTypes: types,
                recursive: true, startIndex, limit: 1000, imageTypeLimit: 0, enableUserData: false, enableTotalRecordCount: false }, options);
            items.push(...(response.data.Items || []));
            if ((response.data.Items?.length || 0) < 1000) return items;
        }
    })();
    const entry = { at: Date.now(), pending };
    cache.set(key, entry);
    try { return await pending; } catch (error) { if (cache.get(key) === entry) cache.delete(key); throw error; }
}

export async function friendlySearchItems(api: Api, userId: string, params: ItemsApiGetItemsRequest, options?: AxiosRequestConfig) {
    const query = params.searchTerm || '';
    const original = await getItemsApi(api).getItems({ ...params, userId, recursive: true }, options);
    if (compactTitle(query).length < 2) return original.data;
    let titles: BaseItemDto[];
    try { titles = await titleIndex(api, userId, params, options); }
    catch (error) { if (options?.signal?.aborted) throw error; return original.data; }
    const limit = params.limit || 100;
    const matches = titles.map(item => ({ item, score: titleMatchScore(item.Name || '', query) }))
        .filter(match => Number.isFinite(match.score)).sort((a, b) => a.score - b.score || (a.item.Name || '').localeCompare(b.item.Name || '')).slice(0, limit);
    const known = new Set((original.data.Items || []).map(item => item.Id));
    const ids = [...new Set(matches.filter(match => !known.has(match.item.Id)).map(match => match.item.Id!).filter(Boolean))];
    let extra: BaseItemDto[] = [];
    try { if (ids.length) extra = (await getItemsApi(api).getItems({ ...params, userId, searchTerm: undefined, ids, recursive: true, limit: ids.length }, options)).data.Items || []; }
    catch (error) { if (options?.signal?.aborted) throw error; return original.data; }
    const merged = [...(original.data.Items || []), ...extra];
    return { ...original.data, Items: merged.sort((a, b) => {
        const score = (item: BaseItemDto) => Math.min(titleMatchScore(item.Name || '', query), known.has(item.Id) ? 9 : Infinity);
        return score(a) - score(b) || (a.Name || '').localeCompare(b.Name || '');
    }).slice(0, limit) };
}
