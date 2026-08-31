import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import type { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import { getPersonsApi } from '@jellyfin/sdk/lib/utils/api/persons-api';
import { useQueries } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';

import { familySearchTypes, retryFamilyRead, type FamilySearchFilter } from 'familyflix/videoPolicy';
import { useApi } from 'hooks/useApi';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { toApi } from 'utils/jellyfin-apiclient/compat';
import { getCardOptionsFromType, getTitleFromType } from '../utils/search';
import { QUERY_OPTIONS } from '../constants/queryOptions';
import { fetchItemsByType } from './fetchItemsByType';

const sessionKeys = new WeakMap<object, { token?: string; key: number }>();
let nextSessionKey = 0;

function searchResultTitle(type: BaseItemKind) {
    if (type === BaseItemKind.Person) return 'People';
    if (type === BaseItemKind.Video) return 'HeaderVideos';
    return getTitleFromType(type);
}

export const useSearchItems = (
    parentId?: string,
    collectionType?: CollectionType,
    searchTerm?: string,
    filter: FamilySearchFilter = 'video'
) => {
    const { user, __legacyApiClient__: client } = useApi();
    const userId = user?.Id;
    const token = client?.accessToken();
    // ApiProvider can briefly still hold the previous SDK instance while its legacy client changes user.
    const api = useMemo(() => client && token && client.getCurrentUserId() === userId ? toApi(client) : undefined,
        [client, token, userId]);
    const activeRead = useRef<string>();
    let identity = client && sessionKeys.get(client);
    if (client && (!identity || identity.token !== token)) {
        identity = { token, key: ++nextSessionKey };
        sessionKeys.set(client, identity);
    }
    const types = familySearchTypes(filter, collectionType);
    const sessionCurrent = () => !!client && !!token && ServerConnections.currentApiClient() === client
        && client.getCurrentUserId() === userId && client.accessToken() === token;
    const enabled = !!api && !!userId && !!searchTerm && sessionCurrent();
    const results = useQueries({
        queries: types.map(type => ({
            queryKey: ['FamilyFlixSearch', identity?.key, userId, collectionType, parentId, searchTerm, type],
            queryFn: async ({ signal }: { signal: AbortSignal }) => {
                if (signal.aborted || !sessionCurrent()) throw new DOMException('Search session changed', 'AbortError');
                const response = type === BaseItemKind.Person ?
                    (await getPersonsApi(api!).getPersons({
                        ...QUERY_OPTIONS, userId, searchTerm, limit: 25
                    }, { signal, timeout: 12000 })).data :
                    await fetchItemsByType(api!, userId, {
                        includeItemTypes: [type], parentId, searchTerm, limit: 25
                    }, { signal, timeout: 12000 });
                if (signal.aborted || !sessionCurrent()) {
                    throw new DOMException('Search session changed', 'AbortError');
                }
                return response;
            },
            enabled,
            retry: retryFamilyRead,
            retryDelay: 750,
            staleTime: 1000,
            gcTime: 60000,
            refetchOnWindowFocus: false
        }))
    });
    const refetch = async (errorsOnly: boolean) => {
        const key = JSON.stringify([identity?.key, userId, collectionType, parentId, searchTerm, filter]);
        if (!enabled || !sessionCurrent() || activeRead.current === key) return;
        activeRead.current = key;
        try {
            await Promise.all(results.filter(result => !result.isFetching && (!errorsOnly || result.isError))
                .map(result => result.refetch()));
        } finally {
            if (activeRead.current === key) activeRead.current = undefined;
        }
    };
    return {
        data: enabled ? results.flatMap((result, index) => result.data?.Items?.length ? [{
            title: searchResultTitle(types[index]),
            items: result.data.Items,
            cardOptions: getCardOptionsFromType(types[index])
        }] : []) : [],
        isPending: enabled && results.some(result => result.isPending || result.isFetching),
        isError: enabled && results.some(result => result.isError),
        retry: () => refetch(true),
        refresh: () => refetch(false)
    };
};
