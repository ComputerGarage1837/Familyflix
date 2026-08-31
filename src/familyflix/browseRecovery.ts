import { ServerConnections } from 'lib/jellyfin-apiclient';
import { isCancelledFamilyRead, retryFamilyRead } from './videoPolicy';

type ReadState = {
    generation: number;
    controller?: AbortController;
    notice?: HTMLElement;
    settled?: () => void;
    sessionCurrent?: () => boolean;
    paused?: boolean;
    needsResume?: boolean;
};
const states = new WeakMap<HTMLElement, ReadState>();
const htmlStates = new WeakMap<HTMLElement, { html: string; first: ChildNode | null; last: ChildNode | null; count: number }>();

function stateFor(container: HTMLElement): ReadState {
    let state = states.get(container);
    if (!state) {
        state = { generation: 0 };
        states.set(container, state);
    }
    return state;
}

/** Keep credentials out of persisted data/query keys while fencing the actual signed-in session. */
export function captureFamilyBrowseSession(): () => boolean {
    const client = ServerConnections.currentApiClient();
    const user = client?.getCurrentUserId();
    const token = client?.accessToken();
    return () => !!client && !!user && !!token && ServerConnections.currentApiClient() === client
        && client.getCurrentUserId() === user && client.accessToken() === token;
}

export function isFamilyBrowseVisible(container: HTMLElement): boolean {
    const tab = container.closest('.pageTabContent,.tabContent');
    return container.isConnected && !states.get(container)?.paused
        && !container.closest('.page.hide,.mainAnimatedPage.hide,.page[hidden]')
        && (!tab || tab.classList.contains('is-active'));
}

export function cancelFamilyBrowse(container: HTMLElement) {
    const state = states.get(container);
    if (!state) return;
    state.needsResume ||= !!state.controller || !!state.notice;
    state.generation++;
    state.controller?.abort();
    state.controller = undefined;
    const button = state.notice?.querySelector('button');
    // Do not disable/remove the focused Retry button. Its old callback must no longer run.
    button?.setAttribute('aria-disabled', 'true');
    if (button) button.onclick = null;
    const settled = state.settled;
    state.settled = undefined;
    settled?.();
}

export function resumeFamilyBrowse(container: HTMLElement) {
    stateFor(container).paused = false;
}

/** Cached legacy pages stay mounted. Pause their reads, then recover an interrupted read on return. */
export function bindFamilyBrowseVisibility(container: HTMLElement, resume: () => void): () => void {
    const state = stateFor(container);
    const page = container.closest('.page,.mainAnimatedPage');
    const tab = container.closest('.pageTabContent,.tabContent');
    let active = isFamilyBrowseVisible(container);
    const update = () => {
        const next = isFamilyBrowseVisible(container);
        if (next === active) return;
        active = next;
        if (!next) {
            cancelFamilyBrowse(container);
        } else if ((state.needsResume || (state.sessionCurrent && !state.sessionCurrent())) && !state.controller) {
            state.needsResume = false;
            resume();
        }
    };
    const pause = () => {
        state.paused = true;
        update();
    };
    const show = () => {
        state.paused = false;
        update();
    };
    page?.addEventListener('viewbeforehide', pause);
    page?.addEventListener('viewshow', show);
    const observer = new MutationObserver(update);
    if (page) observer.observe(page, { attributes: true, attributeFilter: ['class', 'hidden'] });
    if (tab && tab !== page) observer.observe(tab, { attributes: true, attributeFilter: ['class'] });
    return () => {
        observer.disconnect();
        page?.removeEventListener('viewbeforehide', pause);
        page?.removeEventListener('viewshow', show);
        cancelFamilyBrowse(container);
    };
}

function readDeadline<T>(read: () => Promise<T>, signal: AbortSignal, timeout: number): Promise<T> {
    return new Promise((resolve, reject) => {
        let finished = false;
        const finish = (error?: unknown, value?: T) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            if (error) reject(error);
            else resolve(value as T);
        };
        const abort = () => finish(new DOMException('View changed', 'AbortError'));
        const timer = setTimeout(() => finish(new TypeError('The server did not respond in time')), timeout);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) {
            abort();
            return;
        }
        Promise.resolve().then(() => {
            if (signal.aborted) throw new DOMException('View changed', 'AbortError');
            return read();
        }).then(value => finish(undefined, value), error => finish(error));
    });
}

const focusableSelector = 'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])';

function focusWithin(element?: HTMLElement | null, action?: string | null): boolean {
    if (!element) return false;
    const candidates = [element, ...Array.from(element.querySelectorAll<HTMLElement>(focusableSelector))]
        .filter(candidate => candidate.matches(focusableSelector) && candidate.getAttribute('tabindex') !== '-1'
            && !candidate.closest('.hide,[hidden],[aria-hidden="true"]'));
    const target = (action && candidates.find(candidate => candidate.getAttribute('data-action') === action)) || candidates[0];
    target?.focus({ preventScroll: true });
    return !!target && document.activeElement === target;
}

export function focusFamilyBrowseCard(container: HTMLElement, itemId?: string | null, index = 0, action?: string | null): boolean {
    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-id]'));
    const card = cards.find(candidate => candidate.dataset.id === itemId) || cards[Math.min(index, cards.length - 1)];
    return focusWithin(card, action) || focusWithin(container);
}

export function captureFamilyBrowseFocus(container: HTMLElement) {
    const element = document.activeElement as HTMLElement | null;
    if (!element || !container.contains(element)) return undefined;
    const card = element.closest<HTMLElement>('[data-id]');
    return { element, itemId: card?.dataset.id, action: element.getAttribute('data-action'),
        index: Math.max(0, Array.from(container.querySelectorAll('[data-id]')).indexOf(card!)) };
}

export function restoreFamilyBrowseFocus(container: HTMLElement, saved: ReturnType<typeof captureFamilyBrowseFocus>) {
    if (saved && !saved.element.isConnected && (!document.activeElement || document.activeElement === document.body)) {
        focusFamilyBrowseCard(container, saved.itemId, saved.index, saved.action);
    }
}

/** Retain existing nodes for identical rows; an external clear/replacement invalidates the cache. */
export function updateFamilyBrowseHtml(container: HTMLElement, html: string): boolean {
    const previous = htmlStates.get(container);
    if (previous?.html === html && previous.first === container.firstChild
        && previous.last === container.lastChild && previous.count === container.childNodes.length) return false;
    const focus = captureFamilyBrowseFocus(container);
    container.innerHTML = html;
    htmlStates.set(container, { html, first: container.firstChild, last: container.lastChild, count: container.childNodes.length });
    restoreFamilyBrowseFocus(container, focus);
    return true;
}

export function showFamilyBrowseError(container: HTMLElement, retry: () => void, isCurrent?: () => boolean) {
    const state = stateFor(container);
    const generation = state.generation;
    const sessionCurrent = captureFamilyBrowseSession();
    const current = isCurrent || (() => state.generation === generation && isFamilyBrowseVisible(container) && sessionCurrent());
    if (!current()) return;
    let notice = state.notice;
    if (!notice?.isConnected) {
        notice = document.createElement('div');
        notice.className = 'familyBrowseRecovery padded-left padded-right';
        notice.setAttribute('role', 'status');
        const text = document.createElement('p');
        text.textContent = 'This view could not be loaded. Previously loaded titles are still available.';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'emby-button button-raised';
        button.textContent = 'Retry loading titles';
        notice.append(text, button);
        container.before(notice);
        state.notice = notice;
    }
    const button = notice.querySelector('button')!;
    button.removeAttribute('aria-disabled');
    button.onclick = () => {
        if (button.getAttribute('aria-disabled') === 'true' || !current()) return;
        button.setAttribute('aria-disabled', 'true');
        retry();
    };
}

export function clearFamilyBrowseError(container: HTMLElement, restoreFocus = true) {
    const state = states.get(container);
    const ownedFocus = state?.notice?.contains(document.activeElement);
    state?.notice?.remove();
    if (state) state.notice = undefined;
    if (restoreFocus && ownedFocus && isFamilyBrowseVisible(container)) focusFamilyBrowseCard(container);
}

export type FamilyBrowseReadContext = { signal: AbortSignal; isCurrent: () => boolean };
type FamilyBrowseOptions = { settled?: () => void; errorParent?: HTMLElement; timeout?: number; retryDelay?: number; isCurrent?: () => boolean };

async function readWithRecovery<T>(read: (context: FamilyBrowseReadContext) => Promise<T>, context: FamilyBrowseReadContext, options: FamilyBrowseOptions): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        if (!context.isCurrent()) throw new DOMException('View changed', 'AbortError');
        try {
            return await readDeadline(() => {
                if (!context.isCurrent()) throw new DOMException('View changed', 'AbortError');
                return read(context);
            }, context.signal, options.timeout ?? 12000);
        } catch (error) {
            if (!context.isCurrent() || isCancelledFamilyRead(error)) throw new DOMException('View changed', 'AbortError');
            if (!retryFamilyRead(attempt, error)) throw error;
            await readDeadline(() => new Promise<void>(resolve => setTimeout(resolve, options.retryDelay ?? 750)), context.signal,
                (options.retryDelay ?? 750) + 1000);
        }
    }
}

/** One bounded transient retry. A manual Retry is bound to the failed read, generation and session. */
export async function runFamilyBrowse<T>(
    container: HTMLElement,
    read: (context: FamilyBrowseReadContext) => Promise<T>,
    render: (value: T, context: FamilyBrowseReadContext) => void | Promise<void>,
    options: FamilyBrowseOptions = {}
): Promise<void> {
    cancelFamilyBrowse(container);
    const state = stateFor(container);
    // Retaining cards is safe only within the same signed-in session.
    if (state.sessionCurrent && !state.sessionCurrent()) {
        clearFamilyBrowseError(container, false);
        container.replaceChildren();
    }
    const sessionCurrent = captureFamilyBrowseSession();
    state.sessionCurrent = sessionCurrent;
    const generation = ++state.generation;
    state.needsResume = false;
    // eslint-disable-next-line compat/compat -- Legacy targets load abortcontroller-polyfill in src/lib/legacy/index.ts.
    const controller = new AbortController();
    state.controller = controller;
    state.settled = options.settled;
    const current = () => !controller.signal.aborted && state.generation === generation
        && isFamilyBrowseVisible(container) && sessionCurrent() && (options.isCurrent?.() ?? true);
    const context = { signal: controller.signal, isCurrent: current };
    const showError = () => {
        if (!current()) return;
        options.errorParent?.classList.remove('hide');
        showFamilyBrowseError(container, () => {
            if (current()) void runFamilyBrowse(container, read, render, options);
        }, current);
    };
    try {
        const result = await readWithRecovery(read, context, options);
        if (!current()) return;
        await render(result, context);
        if (current()) clearFamilyBrowseError(container);
    } catch (error) {
        // A renderer failure is not a reason to repeat the network query automatically.
        if (!isCancelledFamilyRead(error)) showError();
    } finally {
        if (state.generation === generation) {
            state.needsResume ||= !current();
            state.controller = undefined;
            const settled = state.settled;
            state.settled = undefined;
            settled?.();
        }
    }
}
