import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';
import SearchResults from './SearchResults';

const state = vi.hoisted(() => ({
    value: {
        data: [] as Array<{ title: string; items: BaseItemDto[]; cardOptions: object }>,
        isPending: false, isError: false, retry: vi.fn(), refresh: vi.fn()
    },
    builds: 0
}));
vi.mock('../api/useSearchItems', () => ({ useSearchItems: () => state.value }));
vi.mock('lib/globalize', () => ({ default: { translate: (value: string) => value } }));
vi.mock('lib/jellyfin-apiclient', () => ({ ServerConnections: { currentApiClient: () => undefined } }));
vi.mock('components/loading/LoadingComponent', () => ({ default: () => null }));
vi.mock('elements/emby-scroller/emby-scroller', () => ({}));
vi.mock('elements/emby-itemscontainer/emby-itemscontainer', () => ({}));
vi.mock('components/cardbuilder/cardBuilder', () => ({
    default: {
        buildCards: (items: BaseItemDto[], options: { itemsContainer: HTMLElement }) => {
            state.builds++;
            options.itemsContainer.innerHTML = '';
            for (const item of items) {
                const card = document.createElement('div');
                card.dataset.id = item.Id;
                const link = document.createElement('a');
                link.href = '#' + item.Id;
                link.textContent = item.Name || '';
                card.append(link);
                options.itemsContainer.append(card);
            }
        }
    }
}));

describe('progressive search remote focus', () => {
    let mount: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
        Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
        state.value = { data: [], isPending: false, isError: false, retry: vi.fn(), refresh: vi.fn() };
        state.builds = 0;
        mount = document.createElement('div');
        document.body.append(mount);
        root = createRoot(mount);
    });
    afterEach(async () => {
        await act(async () => {
            root.unmount();
        });
        mount.remove();
    });
    const render = async () => {
        await act(async () => {
            root.render(<SearchResults query='Family' />);
        });
    };

    it('keeps the same Retry button focused through pending and successful recovery', async () => {
        state.value.isError = true;
        await render();
        const retry = mount.querySelector<HTMLButtonElement>('[aria-label="Retry or refresh search"]')!;
        retry.focus();
        await act(async () => {
            retry.click();
        });
        expect(state.value.retry).toHaveBeenCalledTimes(1);
        state.value.isPending = true;
        state.value.isError = false;
        await render();
        expect(mount.querySelector('[aria-label="Retry or refresh search"]')).toBe(retry);
        expect(document.activeElement).toBe(retry);
        expect(retry.disabled).toBe(false);
        expect(retry.getAttribute('aria-disabled')).toBe('true');
        await act(async () => {
            retry.click();
        });
        expect(state.value.refresh).not.toHaveBeenCalled();
        state.value.isPending = false;
        await render();
        expect(document.activeElement).toBe(retry);
        expect(retry.textContent).toBe('Refresh search');
    });

    it('appends ready categories without rebuilding or moving focus from an existing result', async () => {
        const movies = { title: 'Movies', items: [{ Id: 'movie', Name: 'Movie' }], cardOptions: {} };
        state.value.data = [movies];
        state.value.isPending = true;
        await render();
        const movieLink = mount.querySelector<HTMLAnchorElement>('[href="#movie"]')!;
        movieLink.focus();
        expect(state.builds).toBe(1);
        state.value.data = [movies, { title: 'Shows', items: [{ Id: 'show', Name: 'Show' }], cardOptions: {} }];
        await render();
        expect(state.builds).toBe(2);
        expect(mount.querySelector('[href="#movie"]')).toBe(movieLink);
        expect(document.activeElement).toBe(movieLink);
    });

    it('restores the focused inner card link when its live metadata changes', async () => {
        state.value.data = [{ title: 'Movies', items: [{ Id: 'movie', Name: 'Movie' }], cardOptions: {} }];
        await render();
        const original = mount.querySelector<HTMLAnchorElement>('[href="#movie"]')!;
        original.focus();
        state.value.data = [{ title: 'Movies', items: [{ Id: 'movie', Name: 'Movie (watched)' }], cardOptions: {} }];
        await render();
        expect(original.isConnected).toBe(false);
        const updated = mount.querySelector('[href="#movie"]');
        expect(document.activeElement).toBe(updated);
        expect(updated?.textContent).toContain('watched');
    });

    it('keeps successful cards while another category is in an error state', async () => {
        state.value.data = [{ title: 'Movies', items: [{ Id: 'movie', Name: 'Movie' }], cardOptions: {} }];
        await render();
        const original = mount.querySelector('[href="#movie"]');
        state.value.isError = true;
        await render();
        expect(mount.querySelector('[href="#movie"]')).toBe(original);
        expect(mount.querySelector('.noItemsMessage')).toBeNull();
    });
});
