// The server plugin owns the Watchlist UI and conflict-safe writes. Load the
// same client here because a packaged file:// desktop page does not receive
// the script injection used by Jellyfin's server-hosted browser page.
let pending;

export function loadWatchlistClient(apiClient) {
    if (!apiClient?.getUrl || typeof document === 'undefined') return Promise.resolve(false);
    if (window['familyFlixWatchlist/instance']) return Promise.resolve(true);
    if (pending) return pending;

    const base = apiClient.getUrl('FamilyFlix/Watchlists/Web');
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${base}/client.css`;
    css.dataset.familyWatchlistAsset = 'css';
    document.head.appendChild(css);

    pending = new Promise(resolve => {
        const script = document.createElement('script');
        script.src = `${base}/client.js`;
        script.dataset.familyWatchlistAsset = 'js';
        script.onload = () => resolve(Boolean(window['familyFlixWatchlist/instance']));
        script.onerror = () => {
            css.remove();
            script.remove();
            pending = null;
            resolve(false);
        };
        document.head.appendChild(script);
    });
    return pending;
}

export async function openWatchlist(source, apiClient) {
    if (!await loadWatchlistClient(apiClient)) {
        throw new Error('The Family Flix Watchlist service is unavailable.');
    }
    await window['familyFlixWatchlist/instance'].openOverlay(source);
}
