/* eslint-disable @stylistic/max-statements-per-line, no-nested-ternary, sonarjs/no-nested-conditional -- Badge rendering has three explicit availability states. */
import { captureFamilySession, onFamilySessionChange } from './familySession';
import { loadIssueSummaries, onIssueSummariesChanged } from './issues';
import { publicIssueMessage } from './issuePolicy';
import { beginFamilySpeed } from './speedReport';
import './familyTools.scss';

const selector = '.card[data-id][data-type],.listItem[data-id][data-type],.ff-watchlist-card[data-ff-key]';
let installed = false;
let observer: MutationObserver | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let force = false;
const checked = new WeakMap<Element, number>();
const measuredArtwork = new WeakSet<HTMLImageElement>();

function idFor(element: HTMLElement): string {
    return element.dataset.id || element.dataset.ffKey || '';
}

function typeFor(element: HTMLElement): string {
    return element.dataset.type || (element.querySelector('.ff-card-type')?.textContent?.trim().toLowerCase() === 'movie' ? 'Movie' : 'Series');
}

function visible(element: HTMLElement) {
    if (!element.isConnected || element.closest('.hide,[hidden],[aria-hidden="true"],.page:not(.is-active).hide')) return false;
    const box = element.getBoundingClientRect();
    return box.bottom >= 0 && box.right >= 0 && box.top <= window.innerHeight && box.left <= window.innerWidth;
}

function badgeFor(card: HTMLElement) {
    let badge = card.querySelector<HTMLElement>(':scope .familyIssueBadge');
    if (badge) return badge;
    badge = document.createElement('span');
    badge.className = 'familyIssueBadge familyIssueUnavailable';
    badge.textContent = 'Checking reported problems…';
    badge.id = `family-issue-${idFor(card)}-${Math.floor(performance.now())}`;
    const target = card.querySelector('.cardText:last-of-type,.listItemBody,.ff-card-copy') || card;
    target.append(badge);
    const described = (card.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
    described.push(badge.id);
    card.setAttribute('aria-describedby', described.join(' '));
    return badge;
}

function observeArtwork(card: HTMLElement) {
    const image = card.querySelector<HTMLImageElement>('img');
    if (!image || measuredArtwork.has(image) || typeof image.decode !== 'function') return;
    measuredArtwork.add(image);
    const decode = () => {
        const finish = beginFamilySpeed('artwork-decode');
        void image.decode().then(finish, () => undefined);
    };
    if (image.complete) decode();
    else image.addEventListener('load', decode, { once: true });
}

async function scan() {
    timer = undefined;
    const session = captureFamilySession();
    if (!session || document.hidden) return;
    const cards = Array.from(document.querySelectorAll<HTMLElement>(selector))
        .filter(card => visible(card) && ['Movie', 'Episode', 'Series', 'Season'].includes(typeFor(card)))
        .slice(0, 200);
    const due = cards.filter(card => force || Date.now() - (checked.get(card) || 0) >= 30_000);
    force = false;
    if (!due.length) return;
    cards.forEach(observeArtwork);
    due.forEach(card => { checked.set(card, Date.now()); badgeFor(card); });
    const result = await loadIssueSummaries(due.map(idFor), session, true);
    if (!session.current()) return;
    due.forEach(card => {
        if (!card.isConnected) return;
        const badge = badgeFor(card);
        const summary = result.items[idFor(card)];
        const message = publicIssueMessage(summary);
        badge.hidden = result.available && !message;
        badge.classList.toggle('familyIssueUnavailable', !result.available);
        badge.textContent = message ? result.available ? message : `${message} · Refresh unavailable` :
            result.available ? '' : 'Problem check unavailable';
    });
}

function schedule(refresh = false) {
    force ||= refresh;
    if (timer !== undefined) return;
    timer = setTimeout(() => { void scan(); }, 60);
}

/** Global card enhancer is installed lazily from an active view/container. */
export function installFamilyIssueDecorations() {
    if (installed) {
        schedule();
        return;
    }
    installed = true;
    observer = new MutationObserver(() => schedule());
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('scroll', () => schedule(), true);
    document.addEventListener('visibilitychange', () => schedule());
    onFamilySessionChange(() => {
        document.querySelectorAll<HTMLElement>('.familyIssueBadge').forEach(badge => {
            badge.hidden = false;
            badge.classList.add('familyIssueUnavailable');
            badge.textContent = 'Checking reported problems…';
        });
        schedule(true);
    });
    onIssueSummariesChanged(() => schedule(true));
    schedule();
}

export function stopFamilyIssueDecorationsForTest() {
    observer?.disconnect();
    clearTimeout(timer);
    installed = false;
    observer = undefined;
    timer = undefined;
}
/* eslint-enable @stylistic/max-statements-per-line, no-nested-ternary, sonarjs/no-nested-conditional */
