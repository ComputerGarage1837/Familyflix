import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextEpisodePrompt } from './nextEpisodePrompt';
vi.mock('../scripts/inputManager', () => ({
    on: (root, listener) => root.addEventListener('command', listener),
    off: (root, listener) => root.removeEventListener('command', listener)
}));

const item = { Id: 'episode', SeriesName: 'Example', Name: 'Next episode', ParentIndexNumber: 2, IndexNumber: 3, ImageTags: { Primary: 'image' } };
const api = { getImageUrl: () => '/episode.jpg' };
const settings = { nextUp: 'EXTENDED', nextUpSeconds: 7 };
beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
});
afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
});
describe('post-episode controls', () => {
    it('consumes native remote Back and stops the timer', async () => {
        const result = nextEpisodePrompt(api, item, settings, false, () => true);
        const command = new CustomEvent('command', { detail: { command: 'back' }, bubbles: true, cancelable: true });
        document.activeElement.dispatchEvent(command);
        expect(command.defaultPrevented).toBe(true);
        expect(await result).toBe(false);
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('counts down and releases the dialog at the configured time', async () => {
        const result = nextEpisodePrompt(api, item, settings, false, () => true);
        expect(document.querySelector('h3').textContent).toContain('S2 E3');
        expect(document.querySelector('img').hidden).toBe(false);
        await vi.advanceTimersByTimeAsync(7000);
        expect(await result).toBe(true);
        expect(document.querySelector('.familyNextOverlay')).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });
    it('zero countdown waits indefinitely and minimal mode hides artwork', async () => {
        const result = nextEpisodePrompt(api, item, { nextUp: 'MINIMAL', nextUpSeconds: 0 }, false, () => true);
        await vi.advanceTimersByTimeAsync(60000);
        expect(document.querySelector('img').hidden).toBe(true);
        document.querySelector('.familyNextPlay').click();
        expect(await result).toBe(true);
    });
    it('still-watching never automatically accepts, even with next-up disabled', async () => {
        const result = nextEpisodePrompt(api, item, { ...settings, nextUp: 'DISABLED' }, true, () => true);
        await vi.advanceTimersByTimeAsync(60000);
        expect(document.querySelector('h2').textContent).toBe('Are you still watching?');
        document.querySelector('.familyNextStop').click();
        expect(await result).toBe(false);
    });
    it('cancels stale playback and profile transitions', async () => {
        let current = true;
        const result = nextEpisodePrompt(api, item, settings, false, () => current);
        current = false;
        await vi.advanceTimersByTimeAsync(250);
        expect(await result).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('supports remote arrows and Back without leaving a hidden focus trap', async () => {
        const result = nextEpisodePrompt(api, item, settings, false, () => true);
        const root = document.querySelector('.familyNextOverlay');
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(document.activeElement.className).toBe('familyNextStop');
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(await result).toBe(false);
        expect(document.querySelector('.familyNextOverlay')).toBeNull();
    });
});
