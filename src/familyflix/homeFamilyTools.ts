/* eslint-disable @stylistic/max-statements-per-line, sonarjs/no-nested-conditional -- Compact lifecycle callbacks mirror the host Home controller API. */
import type { ApiClient } from 'jellyfin-apiclient';
import { playbackManager } from 'components/playback/playbackmanager';
import { captureFamilySession } from './familySession';
import { familyButton, familyParagraph } from './familyDialogs';
import { openFamilyNight } from './familyNightDialog';
import { openCoWatchDialog } from './coWatchDialog';
import { readCoWatchState } from './coWatchProfiles';
import { openProblemsInbox } from './issueDialogs';
import { issueCapabilities, loadAdminIssueSummary } from './issues';
import './familyTools.scss';

export function bindFamilyHomeTools(view: HTMLElement, client: ApiClient) {
    const old = view.querySelector('.familyHomeTools');
    old?.remove();
    const session = captureFamilySession(client);
    const tools = document.createElement('div');
    tools.className = 'familyHomeTools padded-left padded-right';
    const familyNight = familyButton('Family Night', () => {
        closeFamilyNight?.();
        closeFamilyNight = openFamilyNight(client, familyNight);
    });
    const watchTogether = familyButton('Watching Together', () => {
        closeCoWatch?.();
        closeCoWatch = openCoWatchDialog(client, watchTogether);
    });
    const updateWatchTogetherLabel = () => {
        if (!session?.current()) return;
        const state = readCoWatchState(session);
        const names = state.profiles.filter(profile => state.activeIds.some(value =>
            value.toLowerCase().replace(/-/g, '') === profile.userId.toLowerCase().replace(/-/g, '')))
            .map(profile => profile.name);
        watchTogether.textContent = names.length ? `Watching Together · ${names.join(' / ')}` : 'Watching Together';
    };
    updateWatchTogetherLabel();
    const banner = familyParagraph('', 'familyNewProblems');
    banner.hidden = true;
    const button = familyButton('Problems', () => { closeInbox?.(); closeInbox = openProblemsInbox(client, button); });
    button.hidden = true;
    tools.append(familyNight, watchTogether, banner, button);
    view.querySelector('.sections')?.before(tools);
    const refreshCoWatch = () => {
        if (!session?.current()) return;
        updateWatchTogetherLabel();
        const containers = view.querySelectorAll<HTMLElement & { resume?: (options: { refresh: boolean }) => Promise<unknown> }>('.familyCoWatchFeed');
        containers.forEach(container => { container.resume?.({ refresh: true })?.catch(() => undefined); });
    };
    window.addEventListener('familyflix-cowatch-changed', refreshCoWatch);
    let active = true;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closeInbox: (() => void) | undefined;
    let closeFamilyNight: (() => void) | undefined;
    let closeCoWatch: (() => void) | undefined;
    async function poll() {
        if (!active || disposed || !session?.current() || document.hidden || playbackManager.isPlaying()) return schedule();
        try {
            const capabilities = await issueCapabilities(session);
            if (!active || disposed || !session.current()) return;
            button.hidden = !capabilities?.isAdmin;
            if (capabilities?.isAdmin) {
                const summary = await loadAdminIssueSummary(session);
                if (!active || disposed || !session.current()) return;
                button.textContent = `Problems (${summary.openCount})`;
                banner.hidden = summary.newCount === 0;
                banner.textContent = summary.newCount ? `${summary.newCount} new problem report${summary.newCount === 1 ? '' : 's'} awaiting review.` : '';
            } else { banner.hidden = true; }
        } catch {
            if (!disposed) { button.hidden = true; banner.hidden = true; }
        } finally { schedule(); }
    }
    function schedule() {
        clearTimeout(timer);
        if (!disposed && active) timer = setTimeout(() => { void poll(); }, 30_000);
    }
    void poll();
    return {
        resume: () => { active = true; void poll(); },
        pause: () => { active = false; clearTimeout(timer); closeInbox?.(); closeInbox = undefined; closeFamilyNight?.(); closeFamilyNight = undefined; closeCoWatch?.(); closeCoWatch = undefined; },
        destroy: () => { disposed = true; active = false; clearTimeout(timer); window.removeEventListener('familyflix-cowatch-changed', refreshCoWatch); closeInbox?.(); closeFamilyNight?.(); closeCoWatch?.(); tools.remove(); }
    };
}
/* eslint-enable @stylistic/max-statements-per-line, sonarjs/no-nested-conditional */
