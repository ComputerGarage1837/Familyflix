/* eslint-disable @stylistic/max-statements-per-line, sonarjs/no-nested-conditional -- Compact lifecycle callbacks mirror the host Home controller API. */
import type { ApiClient } from 'jellyfin-apiclient';
import { playbackManager } from 'components/playback/playbackmanager';
import { captureFamilySession } from './familySession';
import { familyButton, familyParagraph } from './familyDialogs';
import { openProblemsInbox } from './issueDialogs';
import { issueCapabilities, loadAdminIssueSummary } from './issues';
import './familyTools.scss';

export function bindFamilyHomeTools(view: HTMLElement, client: ApiClient) {
    const old = view.querySelector('.familyHomeTools');
    old?.remove();
    const session = captureFamilySession(client);
    const tools = document.createElement('div');
    tools.className = 'familyHomeTools padded-left padded-right';
    const banner = familyParagraph('', 'familyNewProblems');
    banner.hidden = true;
    const button = familyButton('Problems', () => { closeInbox?.(); closeInbox = openProblemsInbox(client, button); });
    button.hidden = true;
    tools.append(banner, button);
    view.querySelector('.sections')?.before(tools);
    let active = true;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closeInbox: (() => void) | undefined;
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
        pause: () => { active = false; clearTimeout(timer); closeInbox?.(); closeInbox = undefined; },
        destroy: () => { disposed = true; active = false; clearTimeout(timer); closeInbox?.(); tools.remove(); }
    };
}
/* eslint-enable @stylistic/max-statements-per-line, sonarjs/no-nested-conditional */
