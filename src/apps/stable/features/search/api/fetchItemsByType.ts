import { Api } from '@jellyfin/sdk/lib/api';
import { ItemsApiGetItemsRequest } from '@jellyfin/sdk/lib/generated-client/api/items-api';
import { getItemsApi } from '@jellyfin/sdk/lib/utils/api/items-api';
import { AxiosRequestConfig } from 'axios';
import { QUERY_OPTIONS } from '../constants/queryOptions';
import { friendlySearchItems } from 'familyflix/friendlySearch';

export const fetchItemsByType = async (
    api: Api,
    userId?: string,
    params?: ItemsApiGetItemsRequest,
    options?: AxiosRequestConfig
) => {
    if (userId && params?.searchTerm) return friendlySearchItems(api, userId, { ...QUERY_OPTIONS, recursive: true, ...params }, options);
    const response = await getItemsApi(api).getItems(
        {
            ...QUERY_OPTIONS,
            userId,
            recursive: true,
            ...params
        },
        options
    );
    return response.data;
};
