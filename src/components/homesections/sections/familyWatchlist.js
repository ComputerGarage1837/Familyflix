import cardBuilder from 'components/cardbuilder/cardBuilder';
import { getBackdropShape } from 'utils/card';

function read(object, camelName, pascalName) {
    return object?.[camelName] ?? object?.[pascalName];
}

export function loadFamilyWatchlist(elem, apiClient, { enableOverflow }) {
    elem.classList.add('familyFlixWatchlistSection');
    elem.innerHTML = `<div class="sectionTitleContainer sectionTitleContainer-cards padded-left">
        <button type="button" class="button-flat button-flat-mini sectionTitleTextButton familyFlixOpenWatchlist">
            <h2 class="sectionTitle sectionTitle-cards">Watchlist</h2>
            <span class="material-icons chevron_right" aria-hidden="true"></span>
        </button>
    </div>
    <div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-centerfocus="true">
        <div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x" data-monitor="videoplayback,markplayed"></div>
    </div>`;

    elem.querySelector('.familyFlixOpenWatchlist').addEventListener('click', event => {
        window['familyFlixWatchlist/instance']?.openOverlay(event.currentTarget);
    });

    const itemsContainer = elem.querySelector('.itemsContainer');
    itemsContainer.fetchData = async () => {
        const response = await fetch(apiClient.getUrl('FamilyFlix/Watchlists'), {
            headers: { 'X-Emby-Token': apiClient.accessToken() }
        });
        if (!response.ok) {
            console.warn('Family Flix Watchlist is unavailable:', response.status);
            return [];
        }

        const bundle = await response.json();
        const personal = read(bundle, 'personal', 'Personal');
        const entries = read(personal, 'entries', 'Entries') || [];
        const ids = entries.slice(0, 24).map(entry => read(entry, 'itemId', 'ItemId')).filter(Boolean);
        if (!ids.length) return [];

        const result = await apiClient.getItems(apiClient.getCurrentUserId(), {
            Ids: ids.join(','),
            Fields: 'PrimaryImageAspectRatio,Path',
            ImageTypeLimit: 1,
            EnableImageTypes: 'Primary,Backdrop,Thumb'
        });
        const positions = new Map(ids.map((id, index) => [id.replaceAll('-', '').toLowerCase(), index]));
        return (result.Items || []).sort((left, right) =>
            positions.get(left.Id?.replaceAll('-', '').toLowerCase())
            - positions.get(right.Id?.replaceAll('-', '').toLowerCase()));
    };
    itemsContainer.getItemsHtml = items => cardBuilder.getCardsHtml({
        items,
        shape: getBackdropShape(enableOverflow),
        preferBackdrop: true,
        preferThumb: true,
        showTitle: true,
        showYear: true,
        overlayPlayButton: true,
        context: 'home',
        lazy: true,
        centerText: true
    });
    itemsContainer.parentContainer = elem;
}
