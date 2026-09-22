import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';
import type { ApiClient } from 'jellyfin-apiclient';
import { appRouter } from 'components/router/appRouter';
import { playbackManager } from 'components/playback/playbackmanager';
import { getItemBackdropImageUrl } from 'utils/jellyfin-apiclient/backdropImage';
import { captureFamilySession, familyRequest, type FamilySession } from './familySession';
import { familyButton, familyDialog, familyParagraph } from './familyDialogs';
import { objectValue } from './issuePolicy';
import { activeCoWatchParticipants } from './coWatchProfiles';
import { toFamilyNightCandidate, mergeFamilyNightCandidates, pickFamilyNight,
    type FamilyNightCandidate, type FamilyNightFilter } from './familyNightPolicy';
import './familyNight.scss';

type WatchlistEntry = { itemId?: string; ItemId?: string };
const normalizeId = (value: string) => value.toLowerCase().replace(/-/g, '');

function watchlistIds(raw: unknown): string[] {
    const document = objectValue(raw);
    const entries = document.entries || document.Entries;
    if (!Array.isArray(entries)) throw new Error('The Watchlist response is incomplete.');
    return entries.map((entry: WatchlistEntry) => entry.itemId || entry.ItemId || '')
        .filter(id => /^[0-9a-f-]{32,36}$/i.test(id));
}

async function householdProfiles(session: FamilySession): Promise<[string, string[]][]> {
    const profiles = activeCoWatchParticipants(session);
    return Promise.all(profiles.map(async profile => {
        // eslint-disable-next-line compat/compat -- The legacy entrypoint supplies an AbortController polyfill.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        try {
            const response = await fetch(session.client.getUrl('FamilyFlix/Watchlists/personal'), {
                signal: controller.signal, headers: { 'X-Emby-Token': profile.token }
            });
            if (!response.ok || !session.current()) return [profile.name, []] as [string, string[]];
            return [profile.name, watchlistIds(await response.json())] as [string, string[]];
        } catch {
            return [profile.name, []] as [string, string[]];
        } finally { clearTimeout(timer); }
    }));
}

/** Match the TV picker while retaining Jellyfin's established dialog, focus and Back handling. */
export function openFamilyNight(client: ApiClient, origin?: HTMLElement): () => void {
    const captured = captureFamilySession(client);
    if (!captured) return () => undefined;
    const session: FamilySession = captured;
    const ui = familyDialog('Family Night', session, origin);
    ui.dialog.classList.add('familyNightDialog');
    const intro = familyParagraph('Pick something from your Watchlist or the shared Family List.');
    const filters = document.createElement('div');
    filters.className = 'familyNightFilters';
    const hero = document.createElement('article');
    hero.className = 'familyNightHero';
    const title = document.createElement('h3');
    const facts = familyParagraph('');
    hero.append(title, facts);
    ui.content.append(intro, filters, hero);

    function select(label: string, choices: [string, string][]) {
        const holder = document.createElement('label');
        const caption = document.createElement('span');
        caption.textContent = label;
        const control = document.createElement('select');
        control.className = 'emby-select';
        choices.forEach(([value, text]) => {
            control.add(new Option(text, value));
        });
        holder.append(caption, control);
        filters.append(holder);
        return control;
    }
    const media = select('Movies or shows', [['all', 'Both'], ['movie', 'Movies'], ['show', 'Shows']]);
    const runtime = select('Maximum length', [['', 'Any'], ['90', '90 minutes'], ['120', '2 hours'], ['180', '3 hours']]);
    const genre = select('Genre', [['', 'Any']]);
    const age = select('Age rating', [['', 'Any'], ['7', '7 and under'], ['10', '10 and under'],
        ['13', '13 and under'], ['17', '17 and under'], ['18', '18 and under']]);

    let candidates: FamilyNightCandidate[] = [];
    let selected: FamilyNightCandidate | undefined;
    const reroll = familyButton('Another pick', () => choose(true));
    const play = familyButton('Play', () => {
        if (!selected || !ui.current()) return;
        if (selected.kind === 'show') {
            showDetails();
            return;
        }
        ui.close();
        void playbackManager.play({ items: [selected.item], autoplay: true });
    });
    const details = familyButton('Details', () => showDetails());
    const close = familyButton('Close', ui.close);
    ui.actions.append(reroll, play, details, close);

    function showDetails() {
        if (!selected || !ui.current()) return;
        const item = selected.item;
        ui.close();
        appRouter.showItem(item.Id, item.ServerId);
    }
    function currentFilter(): FamilyNightFilter {
        return {
            media: media.value as FamilyNightFilter['media'],
            maxRuntimeMinutes: runtime.value ? Number(runtime.value) : undefined,
            genre: genre.value || undefined,
            maxRequiredAge: age.value ? Number(age.value) : undefined
        };
    }
    function choose(excludeCurrent = false) {
        selected = pickFamilyNight(candidates, currentFilter(), excludeCurrent ? selected?.id : undefined);
        hero.style.backgroundImage = '';
        if (!selected) {
            title.textContent = candidates.length ? 'Nothing matches these filters' : 'Nothing in your lists yet';
            facts.textContent = candidates.length ? 'Try another genre, rating or length.' : 'Save a movie or show to a Watchlist first.';
        } else {
            title.textContent = selected.item.Name || 'Untitled';
            facts.textContent = [selected.item.OfficialRating,
                selected.runtimeMinutes && `${selected.runtimeMinutes} min`,
                selected.genres.slice(0, 3).join(' · '), selected.profiles.join(' + ')]
                .filter(Boolean).join('  •  ');
            const backdrop = getItemBackdropImageUrl(client, selected.item, { maxWidth: 1280 });
            if (backdrop) hero.style.backgroundImage = `linear-gradient(90deg, rgba(0,0,0,.9), rgba(0,0,0,.28)), url("${backdrop.replace(/"/g, '%22')}")`;
        }
        reroll.disabled = !selected;
        play.disabled = !selected;
        details.disabled = !selected;
        play.textContent = selected?.kind === 'show' ? 'Choose episode' : 'Play';
    }
    [media, runtime, genre, age].forEach(control => {
        control.addEventListener('change', () => choose(true));
    });

    async function load() {
        ui.status.textContent = 'Loading Family Night choices…';
        try {
            const snapshot = objectValue(await familyRequest(session, 'FamilyFlix/Watchlists', { timeout: 3000 }));
            if (!ui.current()) return;
            const scopes: [string, string[]][] = [
                ['Your Watchlist', watchlistIds(snapshot.personal || snapshot.Personal)],
                ['Family List', watchlistIds(snapshot.household || snapshot.Household)],
                ...await householdProfiles(session)
            ];
            const wanted = [...new Map(scopes.flatMap(([, ids]) => ids)
                .map(id => [normalizeId(id), id])).values()];
            const found = new Map<string, BaseItemDto>();
            for (let index = 0; index < wanted.length; index += 100) {
                if (!ui.current()) return;
                const result = await client.getItems(session.userId, {
                    Ids: wanted.slice(index, index + 100).join(','),
                    Fields: 'Genres,RunTimeTicks,OfficialRating,BackdropImageTags,PrimaryImageAspectRatio',
                    EnableUserData: true, Limit: 100
                });
                if (!ui.current()) return;
                (result.Items || []).forEach((item: BaseItemDto) => {
                    if (item.Id) found.set(normalizeId(item.Id), item);
                });
            }
            candidates = mergeFamilyNightCandidates(scopes.flatMap(([profile, ids]) => ids
                .map(id => found.get(normalizeId(id)))
                .map(item => item && toFamilyNightCandidate(item, profile))
                .filter((item): item is FamilyNightCandidate => !!item)));
            const genres = [...new Set(candidates.flatMap(candidate => candidate.genres))]
                .sort((left, right) => left.localeCompare(right));
            genres.forEach(value => {
                genre.add(new Option(value, value));
            });
            ui.status.textContent = `${candidates.length} possible pick${candidates.length === 1 ? '' : 's'}.`;
            choose();
        } catch {
            if (ui.current()) {
                ui.status.textContent = 'Could not load Watchlists. Please try again.';
                title.textContent = 'Family Night is unavailable';
                facts.textContent = 'Your lists were not changed.';
                reroll.disabled = true;
                play.disabled = true;
                details.disabled = true;
            }
        }
    }
    ui.open();
    void load();
    return ui.close;
}
