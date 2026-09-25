import { ServerConnections } from 'lib/jellyfin-apiclient';
import { appRouter } from 'components/router/appRouter';
import { playbackManager } from 'components/playback/playbackmanager';
import { alternateClient } from './homeFeed';
import { partyFor, visibleProfiles } from './profiles';
import { pickCandidate } from './familyNightPicker';
import { readKidsSettings } from './kidsMode';

import './familyNight.scss';

const value = (object, lower, upper) => object?.[lower] ?? object?.[upper];

async function loadOneWatchlist(apiClient) {
    const response = await fetch(apiClient.getUrl('FamilyFlix/Watchlists'), {
        headers: { 'X-Emby-Token': apiClient.accessToken() }
    });
    if (!response.ok) throw new Error(`Watchlist request failed (${response.status})`);
    const bundle = await response.json();
    const entries = value(value(bundle, 'personal', 'Personal'), 'entries', 'Entries') || [];
    const ids = entries.map(entry => value(entry, 'itemId', 'ItemId')).filter(Boolean);
    if (!ids.length) return [];
    const userId = apiClient.getCurrentUserId();
    const result = await apiClient.getItems(userId, {
        Ids: ids.join(','), Fields: 'Genres,OfficialRating,RunTimeTicks', Recursive: true
    });
    const resolved = new Map((result.Items || []).map(item => [String(item.Id).replaceAll('-', '').toLowerCase(), item]));
    const missing = entries.filter(entry => !resolved.has(String(value(entry, 'itemId', 'ItemId')).replaceAll('-', '').toLowerCase()));
    await Promise.allSettled(missing.map(async entry => {
        const title = value(entry, 'title', 'Title');
        if (!title) return;
        const type = value(entry, 'itemType', 'ItemType');
        const requestedType = type === 0 || String(type).toLowerCase() === 'movie' ? 'Movie' : 'Series';
        const candidates = await apiClient.getItems(userId, {
            SearchTerm: title, Recursive: true, IncludeItemTypes: requestedType,
            Fields: 'ProviderIds,Genres,OfficialRating,RunTimeTicks', Limit: 12
        });
        const providers = value(entry, 'providerIds', 'ProviderIds') || {};
        const matchByProvider = (candidates.Items || []).find(item => item.Type === requestedType
            && Object.entries(providers).some(([key, providerId]) => item.ProviderIds?.[key] === providerId));
        const exactTitles = (candidates.Items || []).filter(item => item.Type === requestedType
            && String(item.Name).toLowerCase() === String(title).toLowerCase());
        const match = matchByProvider || (exactTitles.length === 1 ? exactTitles[0] : null);
        if (match) resolved.set(String(match.Id).replaceAll('-', '').toLowerCase(), match);
    }));
    return [...resolved.values()].filter(item => item.Type === 'Movie' || item.Type === 'Series');
}

async function loadCandidates(apiClient) {
    const party = partyFor(apiClient);
    let others = [];
    if (party?.participantUserIds?.length) {
        const visible = await visibleProfiles(apiClient);
        const ids = new Set(visible.map(profile => String(profile.id).replaceAll('-', '').toLowerCase()));
        others = party.participantUserIds
            .filter(id => ids.has(String(id).replaceAll('-', '').toLowerCase()))
            .map(id => alternateClient(apiClient, id)).filter(Boolean);
    }
    const results = await Promise.allSettled([apiClient, ...others].map(loadOneWatchlist));
    const available = results.filter(result => result.status === 'fulfilled');
    if (!available.length) throw results[0].reason;
    return [...new Map(available.flatMap(result => result.value).map(item => [item.Id, item])).values()];
}

let overlay;

export async function openFamilyNight() {
    overlay?.remove();
    const apiClient = ServerConnections.currentApiClient();
    if (!apiClient?.accessToken()) return;
    if (readKidsSettings(apiClient).enabled) return;

    const previousFocus = document.activeElement;
    const panel = document.createElement('div');
    panel.className = 'familyNightOverlay';
    panel.innerHTML = `<section class="familyNightPanel" role="dialog" aria-modal="true" aria-label="Family Night">
        <header><h1>Family Night</h1><button type="button" class="familyNightClose" aria-label="Close">×</button></header>
        <p>Pick from your watchlist${partyFor(apiClient) ? ' and your Watching Together party' : ''}. Adjust the filters, then reroll until you find tonight's choice.</p>
        <div class="familyNightFilters">
            <label>Type <select class="familyNightMedia"><option>All</option><option>Movies</option><option>Shows</option></select></label>
            <label>Max runtime <select class="familyNightRuntime"><option value="0">Any</option><option value="60">1 hour</option><option value="90">1½ hours</option><option value="120">2 hours</option><option value="180">3 hours</option></select></label>
            <label>Genre <select class="familyNightGenre"><option value="">Any</option></select></label>
            <label>Max age <select class="familyNightAge"><option value="">Any</option><option value="0">All ages</option><option value="7">7+</option><option value="10">10+</option><option value="13">13+</option><option value="17">17+</option></select></label>
        </div>
        <div class="familyNightChoice" aria-live="polite">Loading watchlist…</div>
        <footer><button type="button" class="familyNightReroll">Pick for us</button><button type="button" class="familyNightPlay" disabled>Play</button><button type="button" class="familyNightOpen" disabled>View title</button></footer>
    </section>`;
    document.body.appendChild(panel);
    overlay = panel;
    let selected;
    let items = [];
    const close = () => {
        panel.remove();
        if (overlay === panel) overlay = null;
        previousFocus?.focus?.();
    };
    panel.querySelector('.familyNightClose').addEventListener('click', close);
    panel.addEventListener('click', event => {
        if (event.target === panel) close();
    });
    panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') close();
    });
    const filter = () => ({
        media: panel.querySelector('.familyNightMedia').value,
        runtime: Number(panel.querySelector('.familyNightRuntime').value),
        genre: panel.querySelector('.familyNightGenre').value,
        age: panel.querySelector('.familyNightAge').value === '' ? null : Number(panel.querySelector('.familyNightAge').value)
    });
    const render = () => {
        const choice = panel.querySelector('.familyNightChoice');
        choice.replaceChildren();
        if (!selected) {
            choice.textContent = 'No watchlist titles match these filters.';
            panel.querySelector('.familyNightOpen').disabled = true;
            panel.querySelector('.familyNightPlay').disabled = true;
            return;
        }
        const image = document.createElement('img');
        image.alt = '';
        image.src = apiClient.getImageUrl(selected.Id, { type: 'Backdrop', maxWidth: 900 }) || '';
        const details = document.createElement('div');
        const title = document.createElement('h2');
        title.textContent = selected.Name || 'Untitled';
        details.appendChild(title);
        const facts = document.createElement('p');
        facts.textContent = [selected.ProductionYear, selected.OfficialRating,
            selected.RunTimeTicks ? `${Math.ceil(selected.RunTimeTicks / 600000000)} min` : null].filter(Boolean).join(' · ');
        details.appendChild(facts);
        choice.append(image, details);
        panel.querySelector('.familyNightOpen').disabled = false;
        panel.querySelector('.familyNightPlay').disabled = false;
    };
    const reroll = () => {
        selected = pickCandidate(items, filter(), selected?.Id);
        render();
    };
    panel.querySelector('.familyNightReroll').addEventListener('click', reroll);
    panel.querySelectorAll('.familyNightFilters select').forEach(control => {
        control.addEventListener('change', () => {
            selected = null;
            reroll();
        });
    });
    panel.querySelector('.familyNightOpen').addEventListener('click', () => {
        if (!selected) return;
        const url = appRouter.getRouteUrl(selected, { context: 'home' });
        close();
        if (url.startsWith('#')) window.location.hash = url;
        else void appRouter.show(url);
    });
    panel.querySelector('.familyNightPlay').addEventListener('click', () => {
        if (!selected) return;
        const id = selected.Id;
        close();
        void playbackManager.play({ ids: [id], serverId: apiClient.serverId() });
    });
    panel.querySelector('.familyNightReroll').focus();
    try {
        items = await loadCandidates(apiClient);
        if (overlay !== panel) return;
        const genres = [...new Set(items.flatMap(item => item.Genres || []))].sort((a, b) => a.localeCompare(b));
        const select = panel.querySelector('.familyNightGenre');
        genres.forEach(genre => {
            select.add(new Option(genre, genre));
        });
        reroll();
    } catch (error) {
        if (overlay === panel) panel.querySelector('.familyNightChoice').textContent = `Could not load Family Night: ${error.message}`;
    }
}
