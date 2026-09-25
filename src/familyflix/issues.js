import './issues.scss';

const CATEGORIES = {
    noAudio: 'No audio',
    wrongEpisode: 'Wrong episode',
    brokenVideo: 'Broken video',
    subtitles: 'Subtitle problem',
    introTiming: 'Skip timing problem',
    other: 'Other playback problem'
};
const CARD_TYPES = new Set(['Movie', 'Episode', 'Season', 'Series']);
let decorationObserver;
let decorationTimer;
let decorationGeneration = 0;
const decorationCache = new Map();
let decorationApiClient;

function operationId() {
    const bytes = new Uint8Array(16);
    // This client is packaged with modern Qt WebEngine on Windows.
    // eslint-disable-next-line compat/compat
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, value => (`0${value.toString(16)}`).slice(-2)).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function read(value, camel, pascal) {
    return value?.[camel] ?? value?.[pascal];
}

export function stopIssueDecorations() {
    decorationGeneration++;
    decorationObserver?.disconnect();
    decorationObserver = null;
    clearTimeout(decorationTimer);
    decorationTimer = null;
    decorationCache.clear();
    decorationApiClient = null;
}

export function startIssueDecorations(apiClient) {
    stopIssueDecorations();
    const generation = decorationGeneration;
    decorationApiClient = apiClient;
    const schedule = () => {
        if (decorationTimer) return;
        decorationTimer = setTimeout(() => {
            decorationTimer = null;
            decorateCards(apiClient, generation);
        }, 180);
    };
    decorationObserver = new MutationObserver(schedule);
    decorationObserver.observe(document.body, { childList: true, subtree: true });
    schedule();
}

function refreshIssueCard(itemId) {
    decorationCache.delete(itemId);
    for (const card of document.querySelectorAll('.card[data-id]')) {
        if (card.dataset.id !== itemId) continue;
        delete card.dataset.ffIssueChecked;
        card.querySelector('.ffIssueCardBadge')?.remove();
    }
    if (decorationApiClient) decorateCards(decorationApiClient, decorationGeneration);
}

async function decorateCards(apiClient, generation) {
    if (generation !== decorationGeneration) return;
    const cards = Array.from(document.querySelectorAll('.card[data-id][data-type]'))
        .filter(card => CARD_TYPES.has(card.dataset.type) && !card.dataset.ffIssueChecked);
    if (!cards.length) return;
    const ids = [...new Set(cards.map(card => card.dataset.id).filter(Boolean))];
    for (let start = 0; start < ids.length; start += 100) {
        if (generation !== decorationGeneration) return;
        const batch = ids.slice(start, start + 100);
        const fresh = batch.filter(id => !decorationCache.has(id));
        if (fresh.length) {
            try {
                const response = await fetch(apiClient.getUrl('FamilyFlix/Issues/Summaries', { ids: fresh.join(',') }), {
                    headers: { 'X-Emby-Token': apiClient.accessToken() }
                });
                if (!response.ok) return;
                const payload = await response.json();
                if (generation !== decorationGeneration) return;
                for (const summary of read(payload, 'items', 'Items') || []) {
                    decorationCache.set(read(summary, 'itemId', 'ItemId'), summary);
                }
                for (const id of fresh) if (!decorationCache.has(id)) decorationCache.set(id, null);
            } catch (error) {
                console.warn('Family Flix problem badges could not be loaded:', error);
                return;
            }
        }
        for (const card of cards) {
            if (!batch.includes(card.dataset.id)) continue;
            card.dataset.ffIssueChecked = '1';
            const summary = decorationCache.get(card.dataset.id);
            const count = Number(read(summary, 'activeCount', 'ActiveCount') || 0);
            if (!count) continue;
            const categories = read(summary, 'categories', 'Categories') || [];
            const badge = document.createElement('span');
            badge.className = 'ffIssueCardBadge';
            badge.textContent = categories.length ? CATEGORIES[categories[0]] || 'Reported problem' : 'Reported problem';
            badge.title = categories.map(category => CATEGORIES[category] || category).join(', ');
            card.appendChild(badge);
        }
    }
}

export async function loadIssueWarning(page, item, apiClient) {
    const banner = page.querySelector('.ffIssueWarning');
    if (!banner) return;
    banner.hidden = true;
    banner.replaceChildren();
    page.dataset.ffIssueItem = item.Id || '';
    if (!['Movie', 'Episode', 'Season', 'Series'].includes(item.Type) || !item.Id) return;

    try {
        const url = apiClient.getUrl('FamilyFlix/Issues/Summaries', { ids: item.Id });
        const response = await fetch(url, { headers: { 'X-Emby-Token': apiClient.accessToken() } });
        if (!response.ok) return;
        const payload = await response.json();
        if (page.dataset.ffIssueItem !== item.Id) return;
        const summary = (read(payload, 'items', 'Items') || [])[0];
        const count = Number(read(summary, 'activeCount', 'ActiveCount') || 0);
        if (!count) return;

        const categories = read(summary, 'categories', 'Categories') || [];
        const affected = Number(read(summary, 'affectedEpisodeCount', 'AffectedEpisodeCount') || 0);
        const heading = document.createElement('strong');
        if (item.Type === 'Series' || item.Type === 'Season') {
            const noun = affected === 1 ? 'episode has' : 'episodes have';
            heading.textContent = `${affected} ${noun} reported problems`;
        } else {
            heading.textContent = 'Playback problem reported';
        }
        const description = document.createElement('span');
        description.textContent = categories.map(category => CATEGORIES[category] || 'Playback problem').join(' · ');
        banner.append(heading, description);
        banner.hidden = false;
    } catch (error) {
        console.warn('Family Flix issue status could not be loaded:', error);
    }
}

export function bindIssueReport(page, item, apiClient) {
    const button = page.querySelector('.ffIssueReportButton');
    if (!button) return;
    button.hidden = !['Movie', 'Episode'].includes(item.Type);
    button.onclick = () => openIssueReport(page, item, apiClient);
}

function openIssueReport(page, item, apiClient) {
    const existing = document.querySelector('.ffIssueReportDialog');
    if (existing) {
        existing.focus();
        return;
    }
    const dialog = document.createElement('dialog');
    dialog.className = 'ffIssueReportDialog';
    const form = document.createElement('form');
    const title = document.createElement('h2');
    title.textContent = `Report a problem with ${item.Name || 'this title'}`;
    const categoryLabel = document.createElement('label');
    categoryLabel.textContent = 'What is wrong?';
    const category = document.createElement('select');
    category.required = true;
    for (const [value, label] of Object.entries(CATEGORIES)) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        category.appendChild(option);
    }
    categoryLabel.appendChild(category);
    const noteLabel = document.createElement('label');
    noteLabel.textContent = 'More detail (optional)';
    const note = document.createElement('textarea');
    note.maxLength = 1000;
    note.rows = 3;
    noteLabel.appendChild(note);
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const actions = document.createElement('div');
    actions.className = 'ffIssueReportActions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.onclick = () => dialog.close();
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'Send report';
    actions.append(cancel, submit);
    form.append(title, categoryLabel, noteLabel, status, actions);
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        submit.disabled = true;
        status.textContent = 'Sending report…';
        try {
            const response = await fetch(apiClient.getUrl('FamilyFlix/Issues/Reports'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Emby-Token': apiClient.accessToken() },
                body: JSON.stringify({
                    operationId: operationId(),
                    itemId: item.Id,
                    category: category.value,
                    note: note.value.trim(),
                    deviceName: 'Family Flix Windows'
                })
            });
            if (!response.ok) throw new Error(`Report could not be sent (${response.status}).`);
            dialog.close();
            loadIssueWarning(page, item, apiClient);
            refreshIssueCard(item.Id);
        } catch (error) {
            status.textContent = error.message || 'Report could not be sent.';
            submit.disabled = false;
        }
    });
    dialog.showModal();
    category.focus();
}
