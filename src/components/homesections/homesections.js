import layoutManager from 'components/layoutManager';
import { getUserViewsQuery } from 'hooks/useUserViews';
import globalize from 'lib/globalize';
import { DEFAULT_SECTIONS, HomeSectionType } from 'types/homeSectionType';
import Dashboard from 'utils/dashboard';
import { toApi } from 'utils/jellyfin-apiclient/compat';
import { queryClient } from 'utils/query/queryClient';
import { isFamilyHomeSection } from 'familyflix/videoPolicy';
import { captureFamilyBrowseFocus, restoreFamilyBrowseFocus } from 'familyflix/browseRecovery';

import { loadLibraryButtons } from './sections/libraryButtons';
import { loadLibraryTiles } from './sections/libraryTiles';
import { loadNextUp } from './sections/nextUp';
import { loadRecentlyAdded } from './sections/recentlyAdded';
import { loadResume } from './sections/resume';

import 'elements/emby-button/paper-icon-button-light';
import 'elements/emby-itemscontainer/emby-itemscontainer';
import 'elements/emby-scroller/emby-scroller';
import 'elements/emby-button/emby-button';

import './homesections.scss';

export function getDefaultSection(index) {
    if (index < 0 || index > DEFAULT_SECTIONS.length) return '';
    return DEFAULT_SECTIONS[index];
}

function getAllSectionsToShow(userSettings, sectionCount) {
    const sections = [];
    for (let i = 0, length = sectionCount; i < length; i++) {
        let section = userSettings.get('homesection' + i) || getDefaultSection(i);
        if (section === 'folders') {
            section = getDefaultSection(0);
        }

        if (isFamilyHomeSection(section)) sections.push(section);
    }

    // Ensure libraries are visible in TV layout
    if (
        layoutManager.tv
            && !sections.includes(HomeSectionType.SmallLibraryTiles)
            && !sections.includes(HomeSectionType.LibraryButtons)
    ) {
        return [
            HomeSectionType.SmallLibraryTiles,
            ...sections
        ];
    }

    return sections;
}

export function loadSections(elem, apiClient, user, userSettings, prepared = {}) {
    const userId = user.Id || apiClient.getCurrentUserId();
    const isCurrent = prepared.isCurrent || (() => elem.isConnected);
    const views = prepared.userViews ? Promise.resolve(prepared.userViews) : queryClient
        .fetchQuery(getUserViewsQuery(toApi(apiClient), userId)).then(result => result.Items || []);
    return views
        .then(function (userViews) {
            if (!isCurrent()) throw new DOMException('Home changed', 'AbortError');
            const previousFocus = captureFamilyBrowseFocus(elem);
            // Do not destroy cached cards until the bootstrap read has successfully returned.
            destroySections(elem);
            let html = '';

            if (userViews.length) {
                const userSectionCount = 10;
                // TV layout can have an extra section to ensure libraries are visible
                const totalSectionCount = layoutManager.tv ? userSectionCount + 1 : userSectionCount;
                for (let i = 0; i < totalSectionCount; i++) {
                    html += '<div class="verticalSection section' + i + '"></div>';
                }

                elem.innerHTML = html;
                elem.classList.add('homeSectionsContainer');
                prepared.onCommitted?.();

                const promises = [];
                const sections = getAllSectionsToShow(userSettings, userSectionCount);
                for (let i = 0; i < sections.length; i++) {
                    promises.push(loadSection(elem, apiClient, user, userSettings, userViews, sections, i));
                }

                return Promise.all(promises)
                // Timeout for polyfilled CustomElements (webOS 1.2)
                    .then(() => new Promise((resolve) => setTimeout(resolve, 0)))
                    .then(() => {
                        if (!isCurrent()) throw new DOMException('Home changed', 'AbortError');
                        return resume(elem, {
                            refresh: true
                        });
                    }).then(() => {
                        if (isCurrent()) restoreFamilyBrowseFocus(elem, previousFocus);
                    });
            } else {
                let noLibDescription;
                if (user.Policy?.IsAdministrator) {
                    noLibDescription = globalize.translate('NoCreatedLibraries', '<br><a id="button-createLibrary" class="button-link">', '</a>');
                } else {
                    noLibDescription = globalize.translate('AskAdminToCreateLibrary');
                }

                html += '<div class="centerMessage padded-left padded-right">';
                html += '<h2>' + globalize.translate('MessageNothingHere') + '</h2>';
                html += '<p>' + noLibDescription + '</p>';
                html += '</div>';
                elem.innerHTML = html;
                prepared.onCommitted?.();

                const createNowLink = elem.querySelector('#button-createLibrary');
                if (createNowLink) {
                    createNowLink.addEventListener('click', function () {
                        Dashboard.navigate('dashboard/libraries');
                    });
                }
            }
        });
}

export function destroySections(elem) {
    const elems = elem.querySelectorAll('.itemsContainer');
    for (const e of elems) {
        e.fetchData = null;
        e.parentContainer = null;
        e.getItemsHtml = null;
    }

    elem.innerHTML = '';
}

export function pause(elem) {
    const elems = elem.querySelectorAll('.itemsContainer');
    for (const e of elems) {
        e.pause();
    }
}

export function resume(elem, options) {
    const elems = elem.querySelectorAll('.itemsContainer');
    const promises = [];

    Array.prototype.forEach.call(elems, section => {
        if (section.resume) {
            promises.push(section.resume(options));
        }
    });

    return Promise.all(promises);
}

function loadSection(page, apiClient, user, userSettings, userViews, allSections, index) {
    const section = allSections[index];
    const elem = page.querySelector('.section' + index);
    const options = { enableOverflow: enableScrollX() };

    switch (section) {
        case HomeSectionType.LatestMedia:
            loadRecentlyAdded(elem, apiClient, user, userViews, options);
            break;
        case HomeSectionType.LibraryButtons:
            loadLibraryButtons(elem, userViews);
            break;
        case HomeSectionType.NextUp:
            loadNextUp(elem, apiClient, userSettings, options);
            break;
        case HomeSectionType.Resume:
            return loadResume(elem, apiClient, 'HeaderContinueWatching', 'Video', userSettings, options);
        case HomeSectionType.ResumeBook:
            return loadResume(elem, apiClient, 'HeaderContinueReading', 'Book', userSettings, options);
        case HomeSectionType.SmallLibraryTiles:
            loadLibraryTiles(elem, userViews, options);
            break;
        default:
            elem.innerHTML = '';
    }

    return Promise.resolve();
}

function enableScrollX() {
    return true;
}

export default {
    getDefaultSection,
    loadSections,
    destroySections,
    pause,
    resume
};

