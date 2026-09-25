// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { loadWatchlistClient, openWatchlist } from './watchlistClient';

describe('packaged Watchlist client', () => {
    it('loads the server plugin assets and opens the shared Watchlist', async () => {
        const apiClient = { getUrl: path => `https://family.test/${path}` };
        const loading = loadWatchlistClient(apiClient);
        const script = document.querySelector('script[data-family-watchlist-asset="js"]');
        const stylesheet = document.querySelector('link[data-family-watchlist-asset="css"]');
        expect(script?.src).toBe('https://family.test/FamilyFlix/Watchlists/Web/client.js');
        expect(stylesheet?.href).toBe('https://family.test/FamilyFlix/Watchlists/Web/client.css');

        const openOverlay = vi.fn();
        window['familyFlixWatchlist/instance'] = { openOverlay };
        script.onload();
        expect(await loading).toBe(true);

        const source = document.createElement('button');
        await openWatchlist(source, apiClient);
        expect(openOverlay).toHaveBeenCalledWith(source);
    });
});
