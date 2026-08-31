import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    bindFamilyBrowseVisibility, cancelFamilyBrowse, captureFamilyBrowseFocus, captureFamilyBrowseSession,
    clearFamilyBrowseError, isFamilyBrowseVisible, restoreFamilyBrowseFocus, resumeFamilyBrowse,
    runFamilyBrowse, showFamilyBrowseError, updateFamilyBrowseHtml
} from './browseRecovery';

const session = vi.hoisted(() => ({
    user: 'dylan', token: 'test-session',
    client: undefined as { getCurrentUserId: () => string; accessToken: () => string } | undefined
}));
vi.mock('lib/jellyfin-apiclient', () => ({ ServerConnections: { currentApiClient: () => session.client } }));

const denied = () => Object.assign(new Error('Unavailable'), { status: 403 });
const cards = (suffix = '') => '<div data-id="a"><a href="#a" data-action="link">A' + suffix
    + '</a></div><div data-id="b"><a href="#b" data-action="link">B' + suffix + '</a><button data-action="menu">Menu</button></div>';
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve };
}

describe('browse reads and retained DOM', () => {
    let container: HTMLDivElement;
    const cleanups: Array<() => void> = [];
    beforeEach(() => {
        vi.useFakeTimers();
        session.user = 'dylan';
        session.token = 'test-session';
        session.client = { getCurrentUserId: () => session.user, accessToken: () => session.token };
        document.body.innerHTML = '<button id="toolbar">Profile</button><div id="browse"></div>';
        container = document.querySelector<HTMLDivElement>('#browse')!;
        updateFamilyBrowseHtml(container, cards());
    });
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
        cancelFamilyBrowse(container);
        document.body.innerHTML = '';
        vi.useRealTimers();
    });

    it('retains cards and their focus after terminal failure, distinct from empty success', async () => {
        const link = container.querySelector<HTMLAnchorElement>('[href="#b"]')!;
        link.focus();
        const render = vi.fn();
        await runFamilyBrowse(container, () => Promise.reject(denied()), render);
        expect(render).not.toHaveBeenCalled();
        expect(container.querySelector('[href="#b"]')).toBe(link);
        expect(document.activeElement).toBe(link);
        expect(document.querySelector('.familyBrowseRecovery button')?.textContent).toContain('Retry');
        await runFamilyBrowse(container, () => Promise.resolve(''), html => {
            updateFamilyBrowseHtml(container, html);
        });
        expect(container.childNodes.length).toBe(0);
        expect(document.querySelector('.familyBrowseRecovery')).toBeNull();
    });

    it('does only one automatic transient retry', async () => {
        const read = vi.fn().mockRejectedValue(new TypeError('offline'));
        const pending = runFamilyBrowse(container, read, vi.fn(), { retryDelay: 20 });
        await vi.advanceTimersByTimeAsync(100);
        await pending;
        expect(read).toHaveBeenCalledTimes(2);
        expect(document.querySelector('.familyBrowseRecovery')).not.toBeNull();
    });

    it('bounds hanging reads, ignores late timeout responses and does not loop', async () => {
        const first = deferred<string>();
        const second = deferred<string>();
        const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const render = vi.fn();
        const pending = runFamilyBrowse(container, read, render, { timeout: 25, retryDelay: 5 });
        await vi.advanceTimersByTimeAsync(100);
        await pending;
        first.resolve('old');
        second.resolve('old');
        await vi.advanceTimersByTimeAsync(0);
        expect(read).toHaveBeenCalledTimes(2);
        expect(render).not.toHaveBeenCalled();
    });

    it('does not show Retry or retry after cancellation', async () => {
        const read = vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
        await runFamilyBrowse(container, read, vi.fn());
        expect(read).toHaveBeenCalledTimes(1);
        expect(document.querySelector('.familyBrowseRecovery')).toBeNull();
    });

    it('retries the frozen failed request and keeps the Retry button focused while pending', async () => {
        const query = { parent: 'library', startIndex: 100, sort: ['Name'], filter: 'Unplayed' };
        const frozen = JSON.parse(JSON.stringify(query));
        const response = deferred<string>();
        const fetch = vi.fn().mockRejectedValueOnce(denied()).mockReturnValueOnce(response.promise);
        const read = (): Promise<string> => fetch(frozen);
        await runFamilyBrowse(container, read, html => {
            updateFamilyBrowseHtml(container, html);
        });
        const button = document.querySelector<HTMLButtonElement>('.familyBrowseRecovery button')!;
        button.focus();
        query.startIndex = 200;
        query.sort.push('Year');
        button.click();
        button.click();
        await vi.advanceTimersByTimeAsync(0);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(fetch.mock.calls[1][0]).toEqual({ parent: 'library', startIndex: 100, sort: ['Name'], filter: 'Unplayed' });
        expect(document.activeElement).toBe(button);
        expect(button.disabled).toBe(false);
        response.resolve(cards(' ready'));
        await vi.advanceTimersByTimeAsync(0);
        expect(document.activeElement?.tagName).toBe('A');
        expect(document.activeElement?.getAttribute('href')).toBe('#a');
    });

    it('a superseded Retry notice cannot cancel or replay over a newer read', async () => {
        const oldRead = vi.fn().mockRejectedValue(denied());
        await runFamilyBrowse(container, oldRead, vi.fn());
        const oldButton = document.querySelector<HTMLButtonElement>('.familyBrowseRecovery button')!;
        const response = deferred<string>();
        const currentRender = vi.fn();
        const current = runFamilyBrowse(container, () => response.promise, currentRender);
        oldButton.click();
        response.resolve('current');
        await current;
        expect(oldRead).toHaveBeenCalledTimes(1);
        expect(currentRender).toHaveBeenCalledWith('current', expect.any(Object));
    });

    it.each(['profile', 'token', 'server'] as const)('rejects a failed Retry after %s changes', async kind => {
        const read = vi.fn().mockRejectedValue(denied());
        await runFamilyBrowse(container, read, vi.fn());
        const button = document.querySelector<HTMLButtonElement>('.familyBrowseRecovery button')!;
        if (kind === 'profile') session.user = 'amanda';
        else if (kind === 'token') session.token = 'new-session';
        else session.client = { getCurrentUserId: () => 'dylan', accessToken: () => 'test-session' };
        button.click();
        await vi.advanceTimersByTimeAsync(0);
        expect(read).toHaveBeenCalledTimes(1);
    });

    it('checks the profile again before the delayed automatic retry starts', async () => {
        const read = vi.fn().mockRejectedValue(new TypeError('offline'));
        const pending = runFamilyBrowse(container, read, vi.fn(), { retryDelay: 20 });
        await vi.advanceTimersByTimeAsync(0);
        session.user = 'amanda';
        await vi.advanceTimersByTimeAsync(100);
        await pending;
        expect(read).toHaveBeenCalledTimes(1);
        expect(document.querySelector('.familyBrowseRecovery')).toBeNull();
    });

    it('rejects a stale late response and removes another profile’s retained cards on a fresh read', async () => {
        const result = deferred<string>();
        const oldRender = vi.fn();
        const old = runFamilyBrowse(container, () => result.promise, oldRender);
        await vi.advanceTimersByTimeAsync(0);
        session.user = 'amanda';
        const next = deferred<string>();
        const pending = runFamilyBrowse(container, () => next.promise, vi.fn());
        expect(container.childNodes.length).toBe(0);
        result.resolve('private old result');
        next.resolve('current result');
        await Promise.all([old, pending]);
        expect(oldRender).not.toHaveBeenCalled();
    });

    it('settles a cancelled read only once and never clears a newer read’s busy state', async () => {
        const old = deferred<string>();
        const oldSettled = vi.fn();
        const nextSettled = vi.fn();
        const first = runFamilyBrowse(container, () => old.promise, vi.fn(), { settled: oldSettled });
        await vi.advanceTimersByTimeAsync(0);
        const next = deferred<string>();
        const second = runFamilyBrowse(container, () => next.promise, vi.fn(), { settled: nextSettled });
        expect(oldSettled).toHaveBeenCalledTimes(1);
        old.resolve('old');
        await first;
        expect(nextSettled).not.toHaveBeenCalled();
        next.resolve('new');
        await second;
        expect(nextSettled).toHaveBeenCalledTimes(1);
    });

    it('does not repeat a successful server read if rendering itself throws', async () => {
        const read = vi.fn().mockResolvedValue('ok');
        await runFamilyBrowse(container, read, () => {
            throw new Error('render failed');
        });
        expect(read).toHaveBeenCalledTimes(1);
    });

    it('preserves node identity on unchanged HTML and rebuilds after an external clear', () => {
        const before = container.firstChild;
        expect(updateFamilyBrowseHtml(container, cards())).toBe(false);
        expect(container.firstChild).toBe(before);
        container.innerHTML = '';
        expect(updateFamilyBrowseHtml(container, cards())).toBe(true);
        expect(container.querySelector('[href="#b"]')).not.toBeNull();
    });

    it('uses focus at commit time and restores the inner link or selected card action', async () => {
        const response = deferred<string>();
        container.querySelector<HTMLAnchorElement>('[href="#a"]')!.focus();
        const pending = runFamilyBrowse(container, () => response.promise, html => {
            updateFamilyBrowseHtml(container, html);
        });
        container.querySelector<HTMLButtonElement>('[data-action="menu"]')!.focus();
        response.resolve(cards(' updated'));
        await pending;
        expect(document.activeElement?.getAttribute('data-action')).toBe('menu');
        expect(document.activeElement?.closest('[data-id]')?.getAttribute('data-id')).toBe('b');
    });

    it('never steals toolbar focus when a row updates or an error notice clears', () => {
        const toolbar = document.querySelector<HTMLButtonElement>('#toolbar')!;
        showFamilyBrowseError(container, vi.fn());
        toolbar.focus();
        updateFamilyBrowseHtml(container, cards(' changed'));
        clearFamilyBrowseError(container);
        expect(document.activeElement).toBe(toolbar);
    });

    it('does not restore an old focus snapshot after the user has focused something else', () => {
        container.querySelector<HTMLAnchorElement>('[href="#b"]')!.focus();
        const focus = captureFamilyBrowseFocus(container);
        container.innerHTML = cards(' updated');
        const toolbar = document.querySelector<HTMLButtonElement>('#toolbar')!;
        toolbar.focus();
        restoreFamilyBrowseFocus(container, focus);
        expect(document.activeElement).toBe(toolbar);
    });

    it('cancels hidden legacy page reads and resumes once on return without dropping cards', async () => {
        const page = document.createElement('div');
        page.className = 'page';
        container.before(page);
        page.append(container);
        const response = deferred<string>();
        const read = vi.fn().mockReturnValueOnce(response.promise).mockResolvedValue('new');
        const render = vi.fn();
        const resume = vi.fn(() => {
            void runFamilyBrowse(container, read, render);
        });
        cleanups.push(bindFamilyBrowseVisibility(container, resume));
        const initial = runFamilyBrowse(container, read, render);
        await vi.advanceTimersByTimeAsync(0);
        page.dispatchEvent(new Event('viewbeforehide'));
        response.resolve('old');
        await initial;
        expect(render).not.toHaveBeenCalled();
        expect(container.querySelector('[href="#b"]')).not.toBeNull();
        page.dispatchEvent(new Event('viewshow'));
        await vi.advanceTimersByTimeAsync(0);
        expect(resume).toHaveBeenCalledTimes(1);
        expect(render).toHaveBeenCalledWith('new', expect.any(Object));
    });

    it('rejects inactive tabs but permits an initially hidden row within the active tab', () => {
        const tab = document.createElement('div');
        tab.className = 'pageTabContent';
        container.before(tab);
        tab.append(container);
        expect(isFamilyBrowseVisible(container)).toBe(false);
        tab.classList.add('is-active');
        container.classList.add('hide');
        expect(isFamilyBrowseVisible(container)).toBe(true);
    });

    it('allows an explicit component resume before the legacy viewshow listener runs', async () => {
        const page = document.createElement('div');
        page.className = 'page';
        container.before(page);
        page.append(container);
        cleanups.push(bindFamilyBrowseVisibility(container, vi.fn()));
        page.dispatchEvent(new Event('viewbeforehide'));
        resumeFamilyBrowse(container);
        const read = vi.fn().mockResolvedValue('current');
        await runFamilyBrowse(container, read, vi.fn());
        expect(read).toHaveBeenCalledTimes(1);
    });

    it('captures a session without exposing credentials and rejects sign-out', () => {
        const current = captureFamilyBrowseSession();
        expect(current()).toBe(true);
        session.client = undefined;
        expect(current()).toBe(false);
    });
});
