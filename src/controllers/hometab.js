import * as userSettings from '../scripts/settings/userSettings';
import loading from '../components/loading/loading';
import focusManager from '../components/focusManager';
import homeSections from '../components/homesections/homesections';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { cancelFamilyBrowse, captureFamilyBrowseSession, clearFamilyBrowseError, runFamilyBrowse } from 'familyflix/browseRecovery';
import { getUserViewsQuery } from 'hooks/useUserViews';
import { toApi } from 'utils/jellyfin-apiclient/compat';
import { queryClient } from 'utils/query/queryClient';

import '../elements/emby-itemscontainer/emby-itemscontainer';

class HomeTab {
    constructor(view, params) {
        this.view = view;
        this.params = params;
        this.apiClient = ServerConnections.currentApiClient();
        this.sessionCurrent = captureFamilyBrowseSession();
        this.sectionsContainer = view.querySelector('.sections');
        this.onSettingsChanged = onHomeScreenSettingsChanged.bind(this);
        this.sectionsContainer.addEventListener('settingschange', this.onSettingsChanged);
    }
    onResume(options = {}) {
        this.paused = false;
        if (!this.view || !this.sectionsContainer) return Promise.resolve();
        if (!this.sessionCurrent()) {
            cancelFamilyBrowse(this.sectionsContainer);
            clearFamilyBrowseError(this.sectionsContainer, false);
            this.destroyHomeSections();
            this.sectionsRendered = false;
            this.homeLoad = null;
            this.apiClient = ServerConnections.currentApiClient();
            this.sessionCurrent = captureFamilyBrowseSession();
        }
        if (!this.sessionCurrent()) return Promise.resolve();
        if (this.sectionsRendered) {
            const sectionsContainer = this.sectionsContainer;

            if (sectionsContainer) {
                return homeSections.resume(sectionsContainer, options);
            }

            return Promise.resolve();
        }
        if (this.homeLoad) return this.homeLoad;

        loading.show();
        const view = this.view;
        const apiClient = this.apiClient;
        const sectionsContainer = this.sectionsContainer;
        const promise = runFamilyBrowse(sectionsContainer, async context => {
            const user = await apiClient.getCurrentUser();
            if (!context.isCurrent()) throw new DOMException('Home changed', 'AbortError');
            const result = await queryClient.fetchQuery({ ...getUserViewsQuery(toApi(apiClient), user.Id), retry: false });
            return { user, userViews: result.Items || [] };
        }, async ({ user, userViews }, context) => {
            await homeSections.loadSections(sectionsContainer, apiClient, user, userSettings, {
                userViews,
                isCurrent: context.isCurrent,
                onCommitted: () => {
                    this.sectionsRendered = true;
                }
            });
            if (context.isCurrent()) {
                if (options.autoFocus && (!document.activeElement || document.activeElement === document.body)) {
                    focusManager.autoFocus(view);
                }
            }
        }, { isCurrent: () => !this.paused && this.view === view, settled: () => loading.hide() });
        this.homeLoad = promise;
        void promise.finally(() => {
            if (this.homeLoad === promise) this.homeLoad = null;
        });
        return promise;
    }
    onPause() {
        this.paused = true;
        const sectionsContainer = this.sectionsContainer;

        if (sectionsContainer) {
            cancelFamilyBrowse(sectionsContainer);
            this.homeLoad = null;
            homeSections.pause(sectionsContainer);
        }
    }
    destroy() {
        this.onPause();
        this.sectionsContainer?.removeEventListener('settingschange', this.onSettingsChanged);
        this.view = null;
        this.params = null;
        this.apiClient = null;
        this.destroyHomeSections();
        this.sectionsContainer = null;
    }
    destroyHomeSections() {
        const sectionsContainer = this.sectionsContainer;

        if (sectionsContainer) {
            homeSections.destroySections(sectionsContainer);
        }
    }
}

function onHomeScreenSettingsChanged() {
    cancelFamilyBrowse(this.sectionsContainer);
    this.homeLoad = null;
    this.sectionsRendered = false;

    if (!this.paused) {
        this.onResume({
            refresh: true
        });
    }
}

export default HomeTab;
