/* eslint-disable no-nested-ternary, sonarjs/no-nested-conditional, array-callback-return -- Detail status has explicit cached/available/message combinations. */
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';
import type { ApiClient } from 'jellyfin-apiclient';
import { familyButton, familyParagraph } from './familyDialogs';
import { captureFamilySession } from './familySession';
import { loadEpisodeGaps } from './episodeGaps';
import { formatEpisodeNumbers } from './episodeGapPolicy';
import { openReportProblem } from './issueDialogs';
import { publicIssueMessage } from './issuePolicy';
import { loadIssueSummaries } from './issues';
import { beginFamilySpeed } from './speedReport';
import { canonicalGuid } from './seriesPreferencePolicy';

export function bindFamilyItemTools(view: HTMLElement, item: BaseItemDto, client: ApiClient): () => void {
    const session = captureFamilySession(client);
    const itemId = canonicalGuid(item.Id);
    if (!session || !itemId) return () => undefined;
    let current = true;
    let closeReport: (() => void) | undefined;
    const reference = view.querySelector('.mainDetailButtons') || view.querySelector('.detailPageContent');
    const notice = familyParagraph('Checking reported problems…', 'familyIssueNotice familyIssueUnavailable');
    reference?.after(notice);
    const buttons: HTMLButtonElement[] = [];
    if (['Movie', 'Episode'].includes(item.Type || '')) {
        view.querySelectorAll<HTMLElement>('.mainDetailButtons').forEach(container => {
            const button = familyButton('Report problem', () => {
                closeReport?.();
                closeReport = openReportProblem(item, client, button);
            }, 'familyReportProblem detailButton');
            button.title = 'Report a problem with this title';
            container.append(button);
            buttons.push(button);
        });
    }
    void loadIssueSummaries([itemId], session, true).then(result => {
        if (!current || !session.current()) return;
        const message = publicIssueMessage(result.items[itemId]);
        notice.hidden = result.available && !message;
        notice.classList.toggle('familyIssueUnavailable', !result.available);
        notice.textContent = message ? result.available ? message : `${message} · Could not refresh; showing the last known active warning.` :
            result.available ? '' : 'Problem check unavailable. This title has not been confirmed issue-free.';
    });
    if (item.Type === 'Season') {
        const finish = beginFamilySpeed('season-ready', client);
        const gaps = familyParagraph('Checking episode order…', 'familyGapNotice familyIssueUnavailable');
        notice.after(gaps);
        void loadEpisodeGaps(item, session, true).then(result => {
            if (!current || !session.current()) return;
            if (result.state === 'known' && result.missing.length) {
                gaps.classList.remove('familyIssueUnavailable');
                gaps.textContent = `Missing episodes in the known aired span: ${formatEpisodeNumbers(result.missing)}. Watched episodes and combined episodes were included.`;
            } else if (result.state === 'unavailable') {
                gaps.textContent = 'Episode-order check unavailable. This season is not being labeled complete.';
            } else { gaps.hidden = true; }
            finish();
        });
    }
    return () => {
        current = false;
        closeReport?.();
        notice.nextElementSibling?.classList.contains('familyGapNotice') && notice.nextElementSibling.remove();
        notice.remove();
        buttons.forEach(button => button.remove());
    };
}
/* eslint-enable no-nested-ternary, sonarjs/no-nested-conditional, array-callback-return */
