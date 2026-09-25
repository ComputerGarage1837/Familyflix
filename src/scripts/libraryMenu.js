import escapeHtml from 'escape-html';
import Headroom from 'headroom.js';
// NOTE: Used for jsdoc
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { ApiClient } from 'jellyfin-apiclient';

import { AppFeature } from 'constants/appFeature';
import { getUserViewsQuery } from 'hooks/useUserViews';
import globalize from 'lib/globalize';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { EventType } from 'constants/eventType';
import { toApi } from 'utils/jellyfin-apiclient/compat';
import { queryClient } from 'utils/query/queryClient';

import dom from '../utils/dom';
import layoutManager from '../components/layoutManager';
import inputManager from './inputManager';
import viewManager from '../components/viewManager/viewManager';
import { appRouter } from '../components/router/appRouter';
import { appHost } from '../components/apphost';
import { playbackManager } from '../components/playback/playbackmanager';
import { pluginManager } from '../components/pluginManager';
import groupSelectionMenu from '../plugins/syncPlay/ui/groupSelectionMenu';
import browser from './browser';
import imageHelper from '../utils/image';
import { getMenuLinks } from '../scripts/settings/webSettings';
import Dashboard, { pageClassOn } from '../utils/dashboard';
import { PluginType } from '../types/plugin.ts';
import Events from '../utils/events.ts';
import { getParameterByName } from '../utils/url.ts';
import datetime from '../scripts/datetime';
import * as userSettings from '../scripts/settings/userSettings';
import { readKidsSettings } from '../familyflix/kidsMode';
import { partyFor, savedProfile } from '../familyflix/profiles';
import { openWatchlist } from '../familyflix/watchlistClient';
import '../familyflix/familyRail.scss';

import '../elements/emby-button/paper-icon-button-light';

import 'material-design-icons-iconfont';
import '../styles/scrollstyles.scss';
import '../styles/flexstyles.scss';

function renderHeader() {
    let html = '';
    html += '<div class="flex align-items-center flex-grow headerTop">';
    html += '<div class="headerLeft">';
    html += '<button type="button" is="paper-icon-button-light" class="headerButton headerButtonLeft headerBackButton hide"><span class="material-icons ' + (browser.safari ? 'chevron_left' : 'arrow_back') + '" aria-hidden="true"></span></button>';
    html += '<button type="button" is="paper-icon-button-light" class="headerButton headerHomeButton hide barsMenuButton headerButtonLeft"><span class="material-icons home" aria-hidden="true"></span></button>';
    html += '<button type="button" is="paper-icon-button-light" class="headerButton mainDrawerButton barsMenuButton headerButtonLeft hide"><span class="material-icons menu" aria-hidden="true"></span></button>';
    html += '<h3 class="pageTitle" aria-hidden="true"></h3>';
    html += '</div>';
    html += '<div class="headerRight">';
    html += '<button is="paper-icon-button-light" class="headerSyncButton syncButton headerButton headerButtonRight hide"><span class="material-icons groups" aria-hidden="true"></span></button>';
    html += '<span class="headerSelectedPlayer"></span>';
    html += '<button is="paper-icon-button-light" class="headerAudioPlayerButton audioPlayerButton headerButton headerButtonRight hide"><span class="material-icons music_note" aria-hidden="true"></span></button>';
    html += '<button is="paper-icon-button-light" class="headerCastButton castButton headerButton headerButtonRight hide"><span class="material-icons cast" aria-hidden="true"></span></button>';
    html += '<button type="button" is="paper-icon-button-light" class="headerButton headerButtonRight headerSearchButton hide"><span class="material-icons search" aria-hidden="true"></span></button>';
    html += '<button type="button" is="paper-icon-button-light" class="headerButton headerButtonRight headerSettingsButton hide" aria-label="Settings"><span class="material-icons settings" aria-hidden="true"></span></button>';
    html += '<button is="paper-icon-button-light" class="headerButton headerButtonRight headerUserButton hide"><span class="material-icons person" aria-hidden="true"></span></button>';
    html += '<span class="familyPartyHeader hide"></span>';
    html += '<div class="currentTimeText hide"></div>';
    html += '</div>';
    html += '</div>';
    html += '<div class="headerTabs sectionTabs hide">';
    html += '</div>';

    skinHeader.classList.add('skinHeader-withBackground');
    skinHeader.classList.add('skinHeader-blurred');
    skinHeader.innerHTML = html;

    Events.trigger(document, EventType.HEADER_RENDERED);

    headerBackButton = skinHeader.querySelector('.headerBackButton');
    headerHomeButton = skinHeader.querySelector('.headerHomeButton');
    mainDrawerButton = skinHeader.querySelector('.mainDrawerButton');
    headerUserButton = skinHeader.querySelector('.headerUserButton');
    headerCastButton = skinHeader.querySelector('.headerCastButton');
    headerAudioPlayerButton = skinHeader.querySelector('.headerAudioPlayerButton');
    headerSearchButton = skinHeader.querySelector('.headerSearchButton');
    headerSettingsButton = skinHeader.querySelector('.headerSettingsButton');
    headerSyncButton = skinHeader.querySelector('.headerSyncButton');
    currentTimeText = skinHeader.querySelector('.currentTimeText');

    retranslateUi();
    lazyLoadViewMenuBarImages();
    bindMenuEvents();
    updateCastIcon();
    updateClock();
}

function getCurrentApiClient() {
    if (currentUser?.localUser) {
        return ServerConnections.getApiClient(currentUser.localUser.ServerId);
    }

    return ServerConnections.currentApiClient();
}

function lazyLoadViewMenuBarImages() {
    import('../components/images/imageLoader').then((imageLoader) => {
        imageLoader.lazyChildren(skinHeader);
    });
}

function onBackClick() {
    appRouter.back();
}

function retranslateUi() {
    if (headerBackButton) {
        headerBackButton.title = globalize.translate('ButtonBack');
    }

    if (headerHomeButton) {
        headerHomeButton.title = globalize.translate('Home');
    }

    if (mainDrawerButton) {
        mainDrawerButton.title = globalize.translate('Menu');
    }

    if (headerSyncButton) {
        headerSyncButton.title = globalize.translate('ButtonSyncPlay');
    }

    if (headerAudioPlayerButton) {
        headerAudioPlayerButton.title = globalize.translate('ButtonPlayer');
    }

    if (headerCastButton) {
        headerCastButton.title = globalize.translate('ButtonCast');
    }

    if (headerSearchButton) {
        headerSearchButton.title = globalize.translate('Search');
    }

    if (headerUserButton) {
        headerUserButton.title = globalize.translate('Settings');
    }
    if (headerSettingsButton) {
        headerSettingsButton.title = globalize.translate('Settings');
    }
}

function updateUserInHeader(user) {
    retranslateUi();

    let hasImage;

    if (user?.name) {
        if (user.imageUrl) {
            const url = user.imageUrl;
            updateHeaderUserButton(url);
            hasImage = true;
        }
        headerUserButton.title = user.name;
        headerUserButton.classList.remove('hide');
    } else {
        headerUserButton.classList.add('hide');
    }

    if (!hasImage) {
        updateHeaderUserButton(null);
    }

    const partyLabel = skinHeader.querySelector('.familyPartyHeader');
    const apiClient = getCurrentApiClient();
    const party = apiClient?.getCurrentUserId() && !readKidsSettings(apiClient).enabled ? partyFor(apiClient) : null;
    const names = party?.participantUserIds?.map(id => savedProfile(apiClient.serverId(), id)?.name).filter(Boolean) || [];
    partyLabel?.classList.toggle('hide', !names.length);
    if (partyLabel && names.length) {
        partyLabel.textContent = `${user?.name || 'Profile'} / ${names.join(' / ')} · Watching Together`;
    }

    if (user?.localUser) {
        if (headerHomeButton) {
            headerHomeButton.classList.remove('hide');
        }

        if (headerSearchButton) {
            headerSearchButton.classList.remove('hide');
        }
        headerSettingsButton.classList.toggle('hide', readKidsSettings(getCurrentApiClient()).enabled);

        if (!layoutManager.tv) {
            headerCastButton.classList.remove('hide');
        }

        const policy = user.Policy ? user.Policy : user.localUser.Policy;

        if (
        // Button is present
            headerSyncButton
                // SyncPlay plugin is loaded
                && pluginManager.ofType(PluginType.SyncPlay).length > 0
                // SyncPlay enabled for user
                && policy?.SyncPlayAccess !== 'None'
        ) {
            headerSyncButton.classList.remove('hide');
        }
    } else {
        headerHomeButton.classList.add('hide');
        headerCastButton.classList.add('hide');
        headerSyncButton.classList.add('hide');

        if (headerSearchButton) {
            headerSearchButton.classList.add('hide');
        }
        headerSettingsButton.classList.add('hide');
    }

    requiresUserRefresh = false;
}

function updateHeaderUserButton(src) {
    if (src) {
        headerUserButton.classList.add('headerUserButtonRound');
        headerUserButton.innerHTML = '<div class="headerButton headerButtonRight paper-icon-button-light headerUserButtonRound" style="background-image:url(\'' + src + "');\"></div>";
    } else {
        headerUserButton.classList.remove('headerUserButtonRound');
        headerUserButton.innerHTML = '<span class="material-icons person" aria-hidden="true"></span>';
    }
}

function updateClock() {
    const refresh = () => {
        const behavior = document.documentElement.dataset.familyClock || 'ALWAYS';
        currentTimeText.classList.toggle('hide', behavior === 'NEVER');
        const now = new Date();
        const date = new Intl.DateTimeFormat(undefined, {
            weekday: 'short', month: 'short', day: 'numeric'
        }).format(now);
        currentTimeText.innerText = `${date}  •  ${datetime.getDisplayTime(now)}`;
        currentTimeText.classList.toggle('guideClock',
            /^#\/livetv(?:\?|$)/.test(window.location.hash)
                && /[?&]tab=1(?:&|$)/.test(window.location.hash));
    };
    refresh();
    window.setInterval(refresh, 30_000);
    window.addEventListener('hashchange', refresh);
    document.addEventListener('familyflix-settings-updated', refresh);
}

function showSearch() {
    inputManager.handleCommand('search');
}

function onHeaderUserButtonClick() {
    import('../familyflix/profileChooser').then(({ openProfileChooser }) => openProfileChooser());
}

function onHeaderHomeButtonClick() {
    Dashboard.navigate('home');
}

function showAudioPlayer() {
    return appRouter.showNowPlaying();
}

function bindMenuEvents() {
    if (mainDrawerButton) {
        mainDrawerButton.addEventListener('click', toggleMainDrawer);
    }

    if (headerBackButton) {
        headerBackButton.addEventListener('click', onBackClick);
    }

    if (headerSearchButton) {
        headerSearchButton.addEventListener('click', showSearch);
    }
    headerSettingsButton.addEventListener('click', onSettingsClick);

    headerUserButton.addEventListener('click', onHeaderUserButtonClick);
    headerHomeButton.addEventListener('click', onHeaderHomeButtonClick);

    if (!layoutManager.tv) {
        headerCastButton.addEventListener('click', onCastButtonClicked);
    }

    headerAudioPlayerButton.addEventListener('click', showAudioPlayer);
    headerSyncButton.addEventListener('click', onSyncButtonClicked);

    if (layoutManager.mobile) {
        initHeadRoom(skinHeader);
    }
    Events.on(playbackManager, 'playbackstart', onPlaybackStart);
    Events.on(playbackManager, 'playbackstop', onPlaybackStop);
}

function onPlaybackStart() {
    if (playbackManager.isPlayingAudio() && layoutManager.tv) {
        headerAudioPlayerButton.classList.remove('hide');
    } else {
        headerAudioPlayerButton.classList.add('hide');
    }
}

function onPlaybackStop(e, stopInfo) {
    if (stopInfo.nextMediaType != 'Audio') {
        headerAudioPlayerButton.classList.add('hide');
    }
}

function onCastButtonClicked() {
    const btn = this;

    import('../components/playback/playerSelectionMenu').then((playerSelectionMenu) => {
        playerSelectionMenu.show(btn);
    });
}

function onSyncButtonClicked() {
    const btn = this;
    groupSelectionMenu.show(btn);
}

function getItemHref(item, context) {
    return appRouter.getRouteUrl(item, {
        context: context
    });
}

function toggleMainDrawer() {
    if (document.body.classList.contains('familyRailMode')) {
        expandFamilyRail(true);
        return;
    }
    if (navDrawerInstance.isVisible) {
        closeMainDrawer();
    } else {
        openMainDrawer();
    }
}

function openMainDrawer() {
    if (document.body.classList.contains('familyRailMode')) {
        expandFamilyRail(true);
        return;
    }
    navDrawerInstance.open();
}

function onMainDrawerOpened() {
    if (layoutManager.mobile) {
        document.body.classList.add('bodyWithPopupOpen');
    }
}

function closeMainDrawer() {
    if (document.body.classList.contains('familyRailMode')) {
        return;
    }
    navDrawerInstance.close();
}

let familyRailLastKey = null;
let familyRailReturnFocus;

function familyRailLinks() {
    return [...(navDrawerScrollContainer?.querySelectorAll('.navMenuOption') || [])]
        .filter(link => !link.classList.contains('hide') && link.getBoundingClientRect().height > 0);
}

function collapseFamilyRail() {
    document.body.classList.remove('familyRailExpanded');
}

function expandFamilyRail(focusMenu = false) {
    if (!document.body.classList.contains('familyRailMode')) return;
    if (focusMenu && !navDrawerElement?.contains(document.activeElement)) {
        familyRailReturnFocus = document.activeElement;
    }
    document.body.classList.add('familyRailExpanded');
    if (focusMenu) {
        const links = familyRailLinks();
        (links.find(link => link.dataset.itemid === familyRailLastKey)
            || links.find(link => link.classList.contains('navMenuOption-selected'))
            || links[0])?.focus();
    }
}

function focusContentFromRail() {
    if (familyRailReturnFocus?.isConnected) {
        familyRailReturnFocus.focus();
    } else {
        document.querySelector('.page:not(.hide) .card, .headerSearchButton:not(.hide)')?.focus();
    }
}

function hasFocusableItemToLeft(active) {
    const row = active.closest('.focuscontainer-x, .itemsContainer, .scrollSlider');
    if (!row) return false;
    const rect = active.getBoundingClientRect();
    return [...row.querySelectorAll('a[href], button:not(:disabled), [tabindex="0"]')]
        .some(candidate => {
            if (candidate === active) return false;
            const candidateRect = candidate.getBoundingClientRect();
            const sharesRow = candidateRect.bottom > rect.top + rect.height * 0.25
                && candidateRect.top < rect.bottom - rect.height * 0.25;
            return candidateRect.width > 0 && sharesRow && candidateRect.right <= rect.left + 4;
        });
}

function onFamilyRailKeydown(event) {
    if (!document.body.classList.contains('familyRailMode') || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (navDrawerElement?.contains(target)) {
        if (event.key === 'ArrowRight' || event.key === 'Escape') {
            event.preventDefault();
            focusContentFromRail();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            const links = familyRailLinks();
            const index = links.indexOf(target.closest('.navMenuOption'));
            const next = links[index + (event.key === 'ArrowDown' ? 1 : -1)];
            if (index >= 0 && next) {
                event.preventDefault();
                next.focus();
                next.scrollIntoView({ block: 'nearest' });
            }
        }
        return;
    }
    if (event.key !== 'ArrowLeft' || target.closest('input, textarea, select, [contenteditable], .skinHeader, [role="dialog"]')) return;
    if (!target.closest('.page') || hasFocusableItemToLeft(target)) return;
    event.preventDefault();
    event.stopPropagation();
    expandFamilyRail(true);
}

function setFamilyRailMode(page) {
    const eligible = (layoutManager.desktop || Boolean(window.NativeShell)) && window.innerWidth >= 672
        && (page.classList.contains('homePage') || page.classList.contains('libraryPage'))
        && page.id !== 'videoOsdPage'
        && !page.classList.contains('nowPlayingPage')
        && !page.classList.contains('type-interior');
    document.body.classList.toggle('familyRailMode', eligible);
    document.body.classList.toggle('familyRailHome', eligible && page.classList.contains('homePage'));
    if (eligible) expandFamilyRail();
    else collapseFamilyRail();
    mainDrawerButton?.classList.toggle('hide', eligible);
}

document.addEventListener('keydown', onFamilyRailKeydown, true);
document.addEventListener('focusin', event => {
    if (!document.body.classList.contains('familyRailMode')) return;
    if (navDrawerElement?.contains(event.target)) {
        const option = event.target.closest('.navMenuOption');
        if (option?.dataset.itemid) familyRailLastKey = option.dataset.itemid;
        option?.scrollIntoView({ block: 'nearest' });
    }
});
document.addEventListener('familyflix-kids-updated', () => {
    currentDrawerType = null;
    refreshLibraryDrawer();
    const apiClient = getCurrentApiClient();
    headerSettingsButton?.classList.toggle('hide', !apiClient?.getCurrentUserId() || readKidsSettings(apiClient).enabled);
});
window.addEventListener('resize', () => {
    const page = document.querySelector('.page:not(.hide)');
    if (page) setFamilyRailMode(page);
});

function onMainDrawerSelect() {
    if (navDrawerInstance.isVisible) {
        onMainDrawerOpened();
    } else {
        document.body.classList.remove('bodyWithPopupOpen');
    }
}

function refreshLibraryInfoInDrawer(user) {
    const kidsMode = readKidsSettings(getCurrentApiClient()).enabled;
    let html = '';
    html += '<div class="familyRailBrand"><span class="familyRailBrandMark" aria-hidden="true">F</span><span>Family Flix</span></div>';
    html += `<a is="emby-linkbutton" class="navMenuOption lnkMediaFolder" data-itemid="home" href="#/home"><span class="material-icons navMenuOptionIcon home" aria-hidden="true"></span><span class="navMenuOptionText">${globalize.translate('Home')}</span></a>`;
    html += `<a is="emby-linkbutton" class="navMenuOption lnkMediaFolder" data-itemid="search" href="#/search"><span class="material-icons navMenuOptionIcon search" aria-hidden="true"></span><span class="navMenuOptionText">${globalize.translate('Search')}</span></a>`;
    html += `<a is="emby-linkbutton" class="navMenuOption lnkMediaFolder" data-itemid="favorites" href="#/home?tab=1"><span class="material-icons navMenuOptionIcon favorite" aria-hidden="true"></span><span class="navMenuOptionText">${globalize.translate('Favorites')}</span></a>`;

    html += '<div class="libraryMenuOptions"></div>';
    html += `<a is="emby-linkbutton" class="navMenuOption lnkMediaFolder" data-itemid="alllibraries" href="#/home?tab=2"><span class="material-icons navMenuOptionIcon apps" aria-hidden="true"></span><span class="navMenuOptionText">${globalize.translate('AllLibraries')}</span></a>`;
    html += '<div class="familyRailDivider"></div>';
    html += '<div class="customMenuOptions"><button type="button" class="navMenuOption lnkMediaFolder familyWatchlistMenuButton" data-itemid="watchlist" data-familyflix-watchlist-nav="stable"><span class="material-icons navMenuOptionIcon bookmark" aria-hidden="true"></span><span class="navMenuOptionText">Watchlist</span></button></div>';
    html += '<a is="emby-linkbutton" class="navMenuOption lnkMediaFolder" data-itemid="livetv" href="#/livetv?tab=1"><span class="material-icons navMenuOptionIcon live_tv" aria-hidden="true"></span><span class="navMenuOptionText">Live TV</span></a>';
    if (!kidsMode) {
        html += '<button type="button" class="navMenuOption lnkMediaFolder familyNightMenuButton" data-itemid="familynight"><span class="material-icons navMenuOptionIcon casino" aria-hidden="true"></span><span class="navMenuOptionText">Family Night</span></button>';
    }
    const serverId = encodeURIComponent(getCurrentApiClient()?.serverId() || '');
    html += `<a is="emby-linkbutton" class="navMenuOption lnkMediaFolder" data-itemid="playlists" href="#/list?type=Playlist&serverId=${serverId}"><span class="material-icons navMenuOptionIcon queue" aria-hidden="true"></span><span class="navMenuOptionText">Playlists</span></a>`;
    if (!kidsMode) {
        html += `<a is="emby-linkbutton" class="navMenuOption lnkMediaFolder btnSettings" data-itemid="settings" href="#/mypreferencesmenu"><span class="material-icons navMenuOptionIcon settings" aria-hidden="true"></span><span class="navMenuOptionText">${globalize.translate('Settings')}</span></a>`;
    }

    if (!kidsMode && user.localUser?.Policy.IsAdministrator) {
        html += '<div class="adminMenuOptions">';
        html += '<h3 class="sidebarHeader">';
        html += globalize.translate('HeaderAdmin');
        html += '</h3>';
        html += `<a is="emby-linkbutton" class="navMenuOption lnkMediaFolder lnkManageServer" data-itemid="dashboard" href="#/dashboard"><span class="material-icons navMenuOptionIcon dashboard" aria-hidden="true"></span><span class="navMenuOptionText">${globalize.translate('TabDashboard')}</span></a>`;
        html += `<a is="emby-linkbutton" class="navMenuOption lnkMediaFolder editorViewMenu" data-itemid="editor" href="#/metadata"><span class="material-icons navMenuOptionIcon mode_edit" aria-hidden="true"></span><span class="navMenuOptionText">${globalize.translate('MetadataManager')}</span></a>`;
        html += '</div>';
    }

    if (!kidsMode && user.localUser) {
        html += '<div class="userMenuOptions">';
        html += '<h3 class="sidebarHeader">';
        html += globalize.translate('HeaderUser');
        html += '</h3>';

        if (appHost.supports(AppFeature.MultiServer)) {
            html += `<a is="emby-linkbutton" class="navMenuOption lnkMediaFolder btnSelectServer" data-itemid="selectserver" href="#"><span class="material-icons navMenuOptionIcon storage" aria-hidden="true"></span><span class="navMenuOptionText">${globalize.translate('SelectServer')}</span></a>`;
        }

        html += `<a is="emby-linkbutton" class="navMenuOption lnkMediaFolder btnLogout" data-itemid="logout" href="#"><span class="material-icons navMenuOptionIcon exit_to_app" aria-hidden="true"></span><span class="navMenuOptionText">${globalize.translate('ButtonSignOut')}</span></a>`;

        if (appHost.supports(AppFeature.ExitMenu)) {
            html += `<a is="emby-linkbutton" class="navMenuOption lnkMediaFolder exitApp" data-itemid="exitapp" href="#"><span class="material-icons navMenuOptionIcon close" aria-hidden="true"></span><span class="navMenuOptionText">${globalize.translate('ButtonExitApp')}</span></a>`;
        }

        html += '</div>';
    }

    // add buttons to navigation drawer
    navDrawerScrollContainer.innerHTML = html;
    navDrawerScrollContainer.querySelector('.familyWatchlistMenuButton')?.addEventListener('click', event => {
        closeMainDrawer();
        openWatchlist(event.currentTarget, getCurrentApiClient()).catch(error => window.alert(error.message));
    });
    navDrawerScrollContainer.querySelector('.familyNightMenuButton')?.addEventListener('click', () => {
        closeMainDrawer();
        import('../familyflix/familyNight').then(({ openFamilyNight }) => openFamilyNight());
    });

    const btnSelectServer = navDrawerScrollContainer.querySelector('.btnSelectServer');
    if (btnSelectServer) {
        btnSelectServer.addEventListener('click', onSelectServerClick);
    }

    const btnSettings = navDrawerScrollContainer.querySelector('.btnSettings');
    if (btnSettings) {
        btnSettings.addEventListener('click', onSettingsClick);
    }

    const btnExit = navDrawerScrollContainer.querySelector('.exitApp');
    if (btnExit) {
        btnExit.addEventListener('click', onExitAppClick);
    }

    const btnLogout = navDrawerScrollContainer.querySelector('.btnLogout');
    if (btnLogout) {
        btnLogout.addEventListener('click', onLogoutClick);
    }
}

function onSidebarLinkClick() {
    const section = this.getElementsByClassName('sectionName')[0];
    const text = section ? section.innerHTML : this.innerHTML;
    LibraryMenu.setTitle(text);
}

function getUserViews(apiClient, userId) {
    return queryClient
        .fetchQuery(getUserViewsQuery(toApi(apiClient), userId))
        .then(function (result) {
            return result.Items || [];
        });
}

function orderedMenuLibraries(items) {
    const normalizeId = id => String(id || '').replaceAll('-', '').toLowerCase();
    const order = String(userSettings.get('familyTvLibraryMenuOrderV1') || '')
        .split(',').map(normalizeId);
    const positions = new Map(order.map((id, index) => [id, index]));
    const hidden = new Set(String(userSettings.get('familyTvHiddenLibrariesV1') || '')
        .split(',').map(normalizeId));

    return items
        .filter(item => !hidden.has(normalizeId(item.Id))
            && !['livetv', 'music', 'musicvideos', 'playlists'].includes(item.CollectionType))
        .map((item, index) => ({ item, index }))
        .sort((left, right) => {
            const leftPosition = positions.get(normalizeId(left.item.Id));
            const rightPosition = positions.get(normalizeId(right.item.Id));
            if (leftPosition == null && rightPosition == null) return left.index - right.index;
            if (leftPosition == null) return 1;
            if (rightPosition == null) return -1;
            return leftPosition - rightPosition;
        })
        .map(({ item }) => item);
}

function showBySelector(selector, show) {
    const elem = document.querySelector(selector);

    if (elem) {
        if (show) {
            elem.classList.remove('hide');
        } else {
            elem.classList.add('hide');
        }
    }
}

function updateLibraryMenu(user) {
    if (!user) {
        showBySelector('.userMenuOptions', false);
        return;
    }

    const userId = Dashboard.getCurrentUserId();
    const apiClient = getCurrentApiClient();

    const customMenuOptions = document.querySelector('.customMenuOptions');
    if (customMenuOptions) {
        getMenuLinks().then(links => {
            links.forEach(link => {
                const option = document.createElement('a', 'emby-linkbutton');
                option.classList.add('navMenuOption', 'lnkMediaFolder');
                option.rel = 'noopener noreferrer';
                option.target = '_blank';
                option.href = link.url;

                const icon = document.createElement('span');
                icon.className = `material-icons navMenuOptionIcon ${link.icon || 'link'}`;
                icon.setAttribute('aria-hidden', 'true');
                option.appendChild(icon);

                const label = document.createElement('span');
                label.className = 'navMenuOptionText';
                label.textContent = link.name;
                option.appendChild(label);

                customMenuOptions.appendChild(option);
            });
        });
    }

    const libraryMenuOptions = document.querySelector('.libraryMenuOptions');

    if (libraryMenuOptions) {
        getUserViews(apiClient, userId).then(function (result) {
            const items = orderedMenuLibraries(result);
            let html = `<h3 class="sidebarHeader">${globalize.translate('HeaderMedia')}</h3>`;
            html += `<div class="familyLibraryGrid${items.length > 10 ? ' familyLibraryGridCompact' : ''}">`;
            html += items.map(function (i) {
                const icon = i.CollectionType === 'livetv' ? 'live_tv' : imageHelper.getLibraryIcon(i.CollectionType);
                const itemId = i.Id;
                const href = i.CollectionType === 'livetv' ? '#/livetv?tab=1' : getItemHref(i, i.CollectionType);

                return `<a is="emby-linkbutton" data-itemid="${itemId}" class="lnkMediaFolder navMenuOption" href="${href}">
                                    <span class="material-icons navMenuOptionIcon ${icon}" aria-hidden="true"></span>
                                    <span class="sectionName navMenuOptionText">${escapeHtml(i.Name)}</span>
                                  </a>`;
            }).join('');
            html += '</div>';
            libraryMenuOptions.innerHTML = html;
            document.body.style.setProperty('--family-rail-width', items.length > 10 ? '22.5rem' : '16rem');
            const rows = Math.ceil(items.length / (items.length > 10 ? 2 : 1)) + 8;
            document.body.style.setProperty('--family-rail-item-height', `clamp(2rem, calc((100vh - 12rem) / ${rows}), 2.45rem)`);
            const elem = libraryMenuOptions;
            const sidebarLinks = elem.querySelectorAll('.navMenuOption');

            for (const sidebarLink of sidebarLinks) {
                sidebarLink.removeEventListener('click', onSidebarLinkClick);
                sidebarLink.addEventListener('click', onSidebarLinkClick);
            }
        });
    }
}

function getTopParentId() {
    return getParameterByName('topParentId') || null;
}

function onMainDrawerClick(e) {
    const option = e.target.closest('.navMenuOption');
    if (option?.dataset.itemid) familyRailLastKey = option.dataset.itemid;
    if (dom.parentWithTag(e.target, 'A')) {
        setTimeout(closeMainDrawer, 30);
    }
}

function onSelectServerClick() {
    Dashboard.selectServer();
}

function onSettingsClick() {
    Dashboard.navigate('mypreferencesmenu');
}

function onExitAppClick() {
    appHost.exit();
}

function onLogoutClick() {
    Dashboard.logout();
}

function updateCastIcon() {
    const context = document;
    const info = playbackManager.getPlayerInfo();
    const icon = headerCastButton.querySelector('.material-icons');

    icon.classList.remove('cast_connected', 'cast');

    if (info && !info.isLocalPlayer) {
        icon.classList.add('cast_connected');
        headerCastButton.classList.add('castButton-active');
        context.querySelector('.headerSelectedPlayer').innerText = info.deviceName || info.name;
    } else {
        icon.classList.add('cast');
        headerCastButton.classList.remove('castButton-active');
        context.querySelector('.headerSelectedPlayer').innerHTML = '';
    }
}

function updateLibraryNavLinks(page) {
    const isLiveTvPage = page.classList.contains('liveTvPage');
    const isChannelsPage = page.classList.contains('channelsPage');
    const isEditorPage = page.classList.contains('metadataEditorPage');
    const isMySyncPage = page.classList.contains('mySyncPage');
    const id = isLiveTvPage || isChannelsPage || isEditorPage || isMySyncPage || page.classList.contains('allLibraryPage') ? '' : getTopParentId() || '';
    const elems = document.getElementsByClassName('lnkMediaFolder');
    const hash = window.location.hash;

    for (let i = 0, length = elems.length; i < length; i++) {
        const lnkMediaFolder = elems[i];
        const itemId = lnkMediaFolder.getAttribute('data-itemid');

        if (itemId === 'home' && /^#\/home(?:\?tab=0(?:&|$)|$)/.test(hash)) {
            lnkMediaFolder.classList.add('navMenuOption-selected');
        } else if (itemId === 'favorites' && /^#\/home\?tab=1(?:&|$)/.test(hash)) {
            lnkMediaFolder.classList.add('navMenuOption-selected');
        } else if (itemId === 'search' && /^#\/search(?:\?|$)/.test(hash)) {
            lnkMediaFolder.classList.add('navMenuOption-selected');
        } else if (itemId === 'playlists' && hash.startsWith('#/list?') && /[?&]type=Playlist(?:&|$)/.test(hash)) {
            lnkMediaFolder.classList.add('navMenuOption-selected');
        } else if (itemId === 'alllibraries' && /^#\/home\?tab=2(?:&|$)/.test(hash)) {
            lnkMediaFolder.classList.add('navMenuOption-selected');
        } else if (isChannelsPage && itemId === 'channels') {
            lnkMediaFolder.classList.add('navMenuOption-selected');
        } else if (isLiveTvPage && itemId === 'livetv') {
            lnkMediaFolder.classList.add('navMenuOption-selected');
        } else if (isEditorPage && itemId === 'editor') {
            lnkMediaFolder.classList.add('navMenuOption-selected');
        } else if (isMySyncPage && itemId === 'manageoffline' && window.location.href.toString().indexOf('mode=download') != -1) {
            lnkMediaFolder.classList.add('navMenuOption-selected');
        } else if (isMySyncPage && itemId === 'syncotherdevices' && window.location.href.toString().indexOf('mode=download') == -1) {
            lnkMediaFolder.classList.add('navMenuOption-selected');
        } else if (id && itemId == id) {
            lnkMediaFolder.classList.add('navMenuOption-selected');
        } else {
            lnkMediaFolder.classList.remove('navMenuOption-selected');
        }
    }
}

function updateMenuForPageType(isDashboardPage, isLibraryPage) {
    let newPageType = 3;
    if (isDashboardPage) {
        newPageType = 2;
    } else if (isLibraryPage) {
        newPageType = 1;
    }

    if (currentPageType !== newPageType) {
        currentPageType = newPageType;

        if (isDashboardPage && !layoutManager.mobile) {
            skinHeader.classList.add('headroomDisabled');
        } else {
            skinHeader.classList.remove('headroomDisabled');
        }

        const bodyClassList = document.body.classList;

        if (isLibraryPage) {
            bodyClassList.add('libraryDocument');
            bodyClassList.remove('hideMainDrawer');

            if (navDrawerInstance) {
                navDrawerInstance.setEdgeSwipeEnabled(true);
            }
        } else if (isDashboardPage) {
            bodyClassList.remove('libraryDocument');
            bodyClassList.remove('hideMainDrawer');

            if (navDrawerInstance) {
                navDrawerInstance.setEdgeSwipeEnabled(true);
            }
        } else {
            bodyClassList.remove('libraryDocument');
            bodyClassList.add('hideMainDrawer');

            if (navDrawerInstance) {
                navDrawerInstance.setEdgeSwipeEnabled(false);
            }
        }
    }

    if (requiresUserRefresh) {
        ServerConnections.user(getCurrentApiClient()).then(updateUserInHeader);
    }
}

function updateTitle(page) {
    const title = page.getAttribute('data-title');

    if (title) {
        LibraryMenu.setTitle(title);
    } else if (page.classList.contains('standalonePage')) {
        LibraryMenu.setDefaultTitle();
    }
}

function updateBackButton(page) {
    if (headerBackButton) {
        if (page.getAttribute('data-backbutton') !== 'false' && appRouter.canGoBack()) {
            headerBackButton.classList.remove('hide');
        } else {
            headerBackButton.classList.add('hide');
        }
    }
}

function initHeadRoom(elem) {
    const headroom = new Headroom(elem);
    headroom.init();
}

function refreshLibraryDrawer(user) {
    currentDrawerType = 'library';
    loadNavDrawer().then(() => {
        const userPromise = user ? Promise.resolve(user) : ServerConnections.user(getCurrentApiClient());
        return userPromise.then(function (userResult) {
            refreshLibraryInfoInDrawer(userResult);
            updateLibraryMenu(userResult.localUser);
        });
    }).catch(error => console.warn('Could not refresh Family Flix navigation', error));
}

function getNavDrawerOptions() {
    let drawerWidth = window.screen.availWidth - 50;
    drawerWidth = Math.max(drawerWidth, 240);
    drawerWidth = Math.min(drawerWidth, 320);
    return {
        target: navDrawerElement,
        onChange: onMainDrawerSelect,
        width: drawerWidth
    };
}

function loadNavDrawer() {
    if (navDrawerInstance) {
        return Promise.resolve(navDrawerInstance);
    }

    navDrawerElement = document.querySelector('.mainDrawer');
    navDrawerScrollContainer = navDrawerElement.querySelector('.scrollContainer');
    navDrawerScrollContainer.addEventListener('click', onMainDrawerClick);
    return new Promise(function (resolve) {
        import('../lib/navdrawer/navdrawer').then(({ default: NavDrawer }) => {
            navDrawerInstance = new NavDrawer(getNavDrawerOptions());

            if (!layoutManager.tv || window.NativeShell) {
                navDrawerElement.classList.remove('hide');
            }

            resolve(navDrawerInstance);
        });
    });
}

let navDrawerElement;
let navDrawerScrollContainer;
let navDrawerInstance;
let mainDrawerButton;
let headerHomeButton;
let currentDrawerType;
let documentTitle = 'Jellyfin';
let pageTitleElement;
let headerBackButton;
let headerUserButton;
let currentUser;
let headerCastButton;
let headerSearchButton;
let headerSettingsButton;
let headerAudioPlayerButton;
let headerSyncButton;
let currentTimeText;
const enableLibraryNavDrawer = layoutManager.desktop || Boolean(window.NativeShell);
const enableLibraryNavDrawerHome = !layoutManager.tv || Boolean(window.NativeShell);
const skinHeader = document.querySelector('.skinHeader');
let requiresUserRefresh = true;

function setTabs (type, selectedIndex, builder) {
    Events.trigger(document, EventType.SET_TABS, type ? [ type, selectedIndex, builder()] : []);

    import('../components/maintabsmanager').then((mainTabsManager) => {
        if (type) {
            mainTabsManager.setTabs(viewManager.currentView(), selectedIndex, builder, function () {
                return [];
            });
        } else {
            mainTabsManager.setTabs(null);
        }
    });
}

/**
 * Fetch the server name and update the document title.
 * @param {ApiClient} [_apiClient] The current api client.
 */
const fetchServerName = (_apiClient) => {
    _apiClient
        ?.getPublicSystemInfo()
        .then(({ ServerName }) => {
            documentTitle = ServerName || documentTitle;
            document.title = documentTitle;
        })
        .catch(err => {
            console.error('[LibraryMenu] failed to fetch system info', err);
        });
};

function setDefaultTitle () {
    if (!pageTitleElement) {
        pageTitleElement = document.querySelector('.pageTitle');
    }

    if (pageTitleElement) {
        pageTitleElement.classList.add('pageTitleWithLogo');
        pageTitleElement.classList.add('pageTitleWithDefaultLogo');
        pageTitleElement.style.backgroundImage = null;
        pageTitleElement.innerHTML = '';
    }

    document.title = documentTitle;
}

function setTitle (title) {
    if (title == null) {
        LibraryMenu.setDefaultTitle();
        return;
    }

    if (title === '-') {
        title = '';
    }

    const html = title;

    if (!pageTitleElement) {
        pageTitleElement = document.querySelector('.pageTitle');
    }

    if (pageTitleElement) {
        pageTitleElement.classList.remove('pageTitleWithLogo');
        pageTitleElement.classList.remove('pageTitleWithDefaultLogo');
        pageTitleElement.style.backgroundImage = null;
        pageTitleElement.innerText = html || '';
    }

    document.title = title || documentTitle;
}

function setTransparentMenu (transparent) {
    if (transparent) {
        skinHeader.classList.add('semiTransparent');
    } else {
        skinHeader.classList.remove('semiTransparent');
    }
}

let currentPageType;
pageClassOn('pagebeforeshow', 'page', function () {
    if (!this.classList.contains('withTabs')) {
        LibraryMenu.setTabs(null);
    }
});

pageClassOn('pageshow', 'page', function (e) {
    const page = this;
    const isDashboardPage = page.classList.contains('type-interior');
    const isHomePage = page.classList.contains('homePage');
    const isLibraryPage = !isDashboardPage && page.classList.contains('libraryPage');

    if (!isDashboardPage) {
        if (mainDrawerButton) {
            if (enableLibraryNavDrawer || (isHomePage && enableLibraryNavDrawerHome)) {
                mainDrawerButton.classList.remove('hide');
            } else {
                mainDrawerButton.classList.add('hide');
            }
        }

        if (currentDrawerType !== 'library') {
            refreshLibraryDrawer();
        }
    }

    updateMenuForPageType(isDashboardPage, isLibraryPage);
    setFamilyRailMode(page);

    // TODO: Seems to do nothing? Check if needed (also in other views).
    if (!e.detail.isRestored) {
        window.scrollTo(0, 0);
    }

    updateTitle(page);
    updateBackButton(page);
    updateLibraryNavLinks(page);
});

Events.on(ServerConnections, 'apiclientcreated', (e, newApiClient) => {
    fetchServerName(newApiClient);
});

Events.on(ServerConnections, 'localusersignedin', function (e, user) {
    const currentApiClient = ServerConnections.getApiClient(user.ServerId);

    currentDrawerType = null;
    currentUser = {
        localUser: user
    };

    loadNavDrawer();

    ServerConnections.user(currentApiClient).then(function (userResult) {
        currentUser = userResult;
        updateUserInHeader(userResult);
    });
});

Events.on(ServerConnections, 'localusersignedout', function () {
    currentUser = {};
    updateUserInHeader();
});

Events.on(playbackManager, 'playerchange', updateCastIcon);

fetchServerName(getCurrentApiClient());
loadNavDrawer();

const LibraryMenu = {
    getTopParentId,
    onHardwareMenuButtonClick: function () {
        toggleMainDrawer();
    },
    setTabs,
    setDefaultTitle,
    setTitle,
    setTransparentMenu
};

window.LibraryMenu = LibraryMenu;
renderHeader();

export default LibraryMenu;
