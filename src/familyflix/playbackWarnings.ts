import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';
import type { ApiClient } from 'jellyfin-apiclient';
import toast from 'components/toast/toast';
import { familyButton, familyDialog, familyParagraph } from './familyDialogs';
import { captureFamilySession } from './familySession';
import { gapsBeforeEpisode, formatEpisodeNumbers } from './episodeGapPolicy';
import { loadEpisodeGaps } from './episodeGaps';
import { publicIssueMessage } from './issuePolicy';
import { cachedIssueSummary, loadIssueSummaries } from './issues';
import { canonicalGuid } from './seriesPreferencePolicy';

let cancelActive: (() => void) | undefined;
const notices = new Map<string, number>();

export async function confirmFamilyPlayback(item: BaseItemDto, client: ApiClient, previous?: BaseItemDto | null): Promise<boolean> {
    if (!['Movie', 'Episode'].includes(item.Type || '')) return true;
    const itemId = canonicalGuid(item.Id);
    const session = captureFamilySession(client);
    if (!itemId || !session) return true;
    const [summaryResult, gapResult] = await Promise.all([
        loadIssueSummaries([itemId], session, true),
        item.Type === 'Episode' ? loadEpisodeGaps(item, session, true) : Promise.resolve(undefined)
    ]);
    if (!session.current()) return false;
    const summary = summaryResult.items[itemId] || cachedIssueSummary(itemId, session);
    const reported = publicIssueMessage(summary);
    const missing = gapResult ? gapsBeforeEpisode(gapResult, item, previous) : [];
    if (!reported && !missing.length) {
        const unavailable: string[] = [];
        if (!summaryResult.available) unavailable.push('Problem check unavailable; continuing without a confirmed report status.');
        if (gapResult?.state === 'unavailable') unavailable.push('Episode-order check unavailable; continuing without asserting a gap.');
        const key = session.key + ':' + itemId;
        if (unavailable.length && Date.now() - (notices.get(key) || 0) > 30_000) {
            notices.set(key, Date.now());
            toast('Family Flix check unavailable. ' + unavailable.join(' '));
        }
        return true;
    }
    cancelActive?.();
    return new Promise(resolve => {
        let settled = false;
        const finish = (allowed: boolean) => {
            if (settled) return;
            settled = true;
            panel.close();
            if (cancelActive === cancel) cancelActive = undefined;
            resolve(allowed && session.current());
        };
        const panel = familyDialog('Before playing', session, undefined, () => finish(false));
        if (reported) {
            panel.content.append(familyParagraph(summaryResult.available ? reported : `${reported} · Could not refresh; showing the last known active warning.`, 'familyIssueNotice'));
            panel.content.append(familyParagraph('Reports are not verified defects. You may still choose Play anyway.'));
        }
        if (missing.length) {
            panel.content.append(familyParagraph(`Continuing jumps over missing episode${missing.length === 1 ? '' : 's'} ${formatEpisodeNumbers(missing)} in season ${gapResult!.seasonNumber}.`, 'familyGapNotice'));
        }
        const cancel = () => finish(false);
        const cancelButton = familyButton('Cancel', cancel);
        cancelButton.autofocus = true;
        panel.actions.append(cancelButton, familyButton(reported ? 'Play anyway' : 'Continue', () => finish(true)));
        cancelActive = cancel;
        panel.open();
    });
}
