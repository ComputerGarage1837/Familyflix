import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { ApiClient } from 'jellyfin-apiclient';

import cardBuilder from 'components/cardbuilder/cardBuilder';
import layoutManager from 'components/layoutManager';
import { appRouter } from 'components/router/appRouter';
import globalize from 'lib/globalize';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import type { UserSettings } from 'scripts/settings/userSettings';
import { getBackdropShape } from 'utils/card';
import { selectedCoWatchFeed } from 'familyflix/coWatchFeed';
import { eligibleDeckEpisodes } from 'familyflix/deckPolicy';

import type { SectionContainerElement, SectionOptions } from './section';

function getNextUpFetchFn(
    serverId: string,
    { enableOverflow }: SectionOptions
) {
    return async function () {
        const apiClient = ServerConnections.getApiClient(serverId);
        const displayLimit = enableOverflow ? 24 : 15;
        const options = {
            Limit: displayLimit * 2,
            Fields: 'PrimaryImageAspectRatio,DateCreated,Path,MediaSourceCount',
            UserId: apiClient.getCurrentUserId(),
            ImageTypeLimit: 1,
            EnableImageTypes: 'Primary,Backdrop,Banner,Thumb',
            EnableTotalRecordCount: false,
            DisableFirstEpisode: false,
            EnableResumable: false,
            EnableRewatching: true,
            EnableUserData: true
        };
        try {
            const selected = await selectedCoWatchFeed(apiClient, 'Shows/NextUp',
                options as unknown as Record<string, string>);
            if (selected) return { ...selected, Items: eligibleDeckEpisodes(selected.Items || [], displayLimit) };
        } catch { /* Keep the normal Deck usable if a secondary profile has signed out. */ }
        const result = await apiClient.getNextUpEpisodes(options);
        return { ...result, Items: eligibleDeckEpisodes(result.Items || [], displayLimit) };
    };
}

function getNextUpItemsHtmlFn(
    useEpisodeImages: boolean,
    { enableOverflow }: SectionOptions
) {
    return function (items: BaseItemDto[]) {
        const cardLayout = false;
        return cardBuilder.getCardsHtml({
            items: items,
            preferThumb: true,
            inheritThumb: !useEpisodeImages,
            shape: getBackdropShape(enableOverflow),
            overlayText: false,
            showTitle: true,
            showParentTitle: true,
            lazy: true,
            overlayPlayButton: true,
            context: 'home',
            centerText: !cardLayout,
            allowBottomPadding: !enableOverflow,
            cardLayout: cardLayout
        });
    };
}

export function loadNextUp(
    elem: HTMLElement,
    apiClient: ApiClient,
    userSettings: UserSettings,
    options: SectionOptions
) {
    let html = '';

    html += '<div class="sectionTitleContainer sectionTitleContainer-cards padded-left">';
    if (!layoutManager.tv) {
        html += '<a is="emby-linkbutton" href="' + appRouter.getRouteUrl('nextup', {
            serverId: apiClient.serverId()
        }) + '" class="button-flat button-flat-mini sectionTitleTextButton">';
        html += '<h2 class="sectionTitle sectionTitle-cards">';
        html += globalize.translate('NextUp');
        html += '</h2>';
        html += '<span class="material-icons chevron_right" aria-hidden="true"></span>';
        html += '</a>';
    } else {
        html += '<h2 class="sectionTitle sectionTitle-cards">';
        html += globalize.translate('NextUp');
        html += '</h2>';
    }
    html += '</div>';

    if (options.enableOverflow) {
        html += '<div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-centerfocus="true">';
        html += '<div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x" data-monitor="videoplayback,markplayed">';
    } else {
        html += '<div is="emby-itemscontainer" class="itemsContainer padded-left padded-right vertical-wrap focuscontainer-x" data-monitor="videoplayback,markplayed">';
    }

    if (options.enableOverflow) {
        html += '</div>';
    }
    html += '</div>';

    elem.classList.add('hide');
    elem.innerHTML = html;

    const itemsContainer: SectionContainerElement | null = elem.querySelector('.itemsContainer');
    if (!itemsContainer) return;
    itemsContainer.fetchData = getNextUpFetchFn(apiClient.serverId(), options);
    itemsContainer.getItemsHtml = getNextUpItemsHtmlFn(userSettings.useEpisodeImagesInNextUpAndResume(), options);
    itemsContainer.parentContainer = elem;
    itemsContainer.classList.add('familyCoWatchFeed');
    (itemsContainer as SectionContainerElement & { familySpeedStage?: string }).familySpeedStage = 'deck-ready';
}
