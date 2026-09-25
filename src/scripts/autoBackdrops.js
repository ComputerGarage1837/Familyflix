import { clearBackdrop, setBackdrop, setBackdropImages, setBackdrops } from '../components/backdrop/backdrop';
import * as userSettings from './settings/userSettings';
import libraryMenu from './libraryMenu';
import { pageClassOn } from '../utils/dashboard';
import { queryClient } from 'utils/query/queryClient';
import { getBrandingOptionsQuery } from 'apps/dashboard/features/branding/api/useBrandingOptions';
import { SPLASHSCREEN_URL } from 'constants/branding';
import { ServerConnections } from 'lib/jellyfin-apiclient';

const cache = {};

function enabled() {
    const shared = document.documentElement.dataset.familyBackdrops;
    return shared == null ? userSettings.enableBackdrops() : shared === 'true';
}

function getBackdropItemIds(apiClient, userId, types, parentId) {
    const key = `backdrops2_${userId + (types || '') + (parentId || '')}`;
    let data = cache[key];

    if (data) {
        console.debug(`Found backdrop id list in cache. Key: ${key}`);
        data = JSON.parse(data);
        return Promise.resolve(data);
    }

    const options = {
        SortBy: 'IsFavoriteOrLiked,Random',
        Limit: 20,
        Recursive: true,
        IncludeItemTypes: types,
        ImageTypes: 'Backdrop',
        ParentId: parentId,
        EnableTotalRecordCount: false,
        MaxOfficialRating: ''
    };
    return apiClient.getItems(apiClient.getCurrentUserId(), options).then(function (result) {
        const images = result.Items.map(function (i) {
            return {
                Id: i.Id,
                tag: i.BackdropImageTags[0],
                ServerId: i.ServerId
            };
        });
        cache[key] = JSON.stringify(images);
        return images;
    });
}

function showBackdrop(type, parentId, focusRequest) {
    const apiClient = ServerConnections.currentApiClient();

    if (apiClient) {
        getBackdropItemIds(apiClient, apiClient.getCurrentUserId(), type, parentId).then(function (images) {
            if (focusRequest != null && focusRequest !== homeFocusRequest) return;
            if (images.length) {
                setBackdrops(images.map(function (i) {
                    i.BackdropImageTags = [i.tag];
                    return i;
                }), undefined, true);
            } else {
                clearBackdrop();
            }
        });
    }
}

async function showSplashScreen() {
    const api = ServerConnections.getCurrentApi();
    const brandingOptions = await queryClient.fetchQuery(getBrandingOptionsQuery(api));
    if (brandingOptions.SplashscreenEnabled) {
        setBackdropImages([
            api.getUri(SPLASHSCREEN_URL, { t: Date.now() })
        ]);
    } else {
        clearBackdrop();
    }
}

pageClassOn('pageshow', 'page', function () {
    const page = this;

    if (!page.classList.contains('selfBackdropPage')) {
        if (page.classList.contains('backdropPage')) {
            const type = page.getAttribute('data-backdroptype');
            if (type === 'splashscreen') {
                showSplashScreen();
            } else if (page.classList.contains('homePage') || enabled()) {
                const parentId = page.classList.contains('globalBackdropPage') ? '' : libraryMenu.getTopParentId();
                showBackdrop(type, parentId, page.classList.contains('homePage') ? homeFocusRequest : undefined);
            } else {
                page.classList.remove('backdropPage');
                clearBackdrop();
            }
        } else {
            clearBackdrop();
        }
    }
});

let homeFocusRequest = 0;
const focusedItems = new Map();
document.addEventListener('focusin', event => {
    if (!/^#\/home(?:\?|$)/.test(window.location.hash)) return;
    const card = event.target.closest?.('.homePage .card[data-id]');
    const request = ++homeFocusRequest;
    if (!card) {
        showBackdrop('movie,series', undefined, request);
        return;
    }

    const itemId = card.dataset.id;
    const apiClient = ServerConnections.currentApiClient();
    if (!apiClient || !itemId) return;
    const itemPromise = focusedItems.get(itemId)
        || apiClient.getItem(apiClient.getCurrentUserId(), itemId);
    focusedItems.set(itemId, itemPromise);
    Promise.resolve(itemPromise).then(item => {
        if (request !== homeFocusRequest || !/^#\/home(?:\?|$)/.test(window.location.hash)) return;
        if (item.BackdropImageTags?.length || item.ParentBackdropImageTags?.length) {
            setBackdrop(item);
        } else if (item.ImageTags?.Thumb) {
            setBackdrop(apiClient.getScaledImageUrl(item.Id, {
                type: 'Thumb', tag: item.ImageTags.Thumb, maxWidth: 1920
            }));
        } else if (item.ParentThumbItemId && item.ParentThumbImageTag) {
            setBackdrop(apiClient.getScaledImageUrl(item.ParentThumbItemId, {
                type: 'Thumb', tag: item.ParentThumbImageTag, maxWidth: 1920
            }));
        } else {
            showBackdrop('movie,series', undefined, request);
        }
    }).catch(() => {
        focusedItems.delete(itemId);
    });
});

