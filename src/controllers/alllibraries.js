import { getUserViewsQuery } from 'hooks/useUserViews';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { toApi } from 'utils/jellyfin-apiclient/compat';
import { queryClient } from 'utils/query/queryClient';

import focusManager from '../components/focusManager';
import loading from '../components/loading/loading';
import { loadLibraryTiles } from '../components/homesections/sections/libraryTiles';

class AllLibrariesTab {
    constructor(view) {
        this.view = view;
        this.apiClient = ServerConnections.currentApiClient();
        this.sectionsContainer = view.querySelector('.sections');
    }

    onResume(options = {}) {
        if (this.rendered && !options.refresh) return Promise.resolve();

        loading.show();
        const userId = this.apiClient.getCurrentUserId();
        return queryClient.fetchQuery(getUserViewsQuery(toApi(this.apiClient), userId))
            .then(result => {
                // Menu visibility is intentionally ignored here so every
                // library the signed-in user can access remains browseable.
                loadLibraryTiles(this.sectionsContainer, result.Items || [], { enableOverflow: false });
                this.rendered = true;
                if (options.autoFocus) focusManager.autoFocus(this.view);
            })
            .catch(error => console.error(error))
            .finally(() => loading.hide());
    }

    onPause() {}

    destroy() {
        this.view = null;
        this.sectionsContainer = null;
        this.apiClient = null;
    }
}

export default AllLibrariesTab;
