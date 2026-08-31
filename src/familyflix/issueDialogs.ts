/* eslint-disable @stylistic/max-statements-per-line, array-callback-return, no-nested-ternary, sonarjs/no-nested-conditional, sonarjs/no-nested-functions -- Modal state is deliberately scoped to each focus-safe dialog. */
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';
import type { ApiClient } from 'jellyfin-apiclient';
import { appHost } from 'components/apphost';
import { captureFamilySession, familyOperationId, FamilyRequestError, type FamilySession } from './familySession';
import { familyButton, familyDialog, familyParagraph } from './familyDialogs';
import { ISSUE_LABELS, type IssueCase, type IssueCategory, type IssueStatus } from './issuePolicy';
import {
    acknowledgeIssueInbox, createIssueReport, issueCapabilities, loadAdminIssueCases, sendIssueReport, updateIssueStatus,
    type ReportDraft, type StatusOperation
} from './issues';

function reportTime(milliseconds: number): string {
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString();
}

export function openReportProblem(item: BaseItemDto, client: ApiClient, origin?: HTMLElement, context: Partial<ReportDraft> = {}): () => void {
    const session = captureFamilySession(client);
    if (!session || !['Movie', 'Episode'].includes(item.Type || '')) return () => undefined;
    const panel = familyDialog('Report a problem', session, origin);
    panel.content.append(familyParagraph(item.Name || 'This title', 'familyProblemTitle'));
    panel.content.append(familyParagraph('Reports help an administrator investigate; they do not verify that the file is defective. Only an administrator can see your name, note and device context.'));
    const categoryLabel = document.createElement('label');
    categoryLabel.textContent = 'Problem category';
    const category = document.createElement('select');
    category.className = 'emby-select';
    Object.entries(ISSUE_LABELS).forEach(([value, label]) => category.add(new Option(label, value)));
    categoryLabel.append(category);
    const noteLabel = document.createElement('label');
    noteLabel.textContent = 'Optional note (up to 1,000 characters)';
    const note = document.createElement('textarea');
    note.className = 'emby-textarea';
    note.maxLength = 1000;
    note.rows = 4;
    noteLabel.append(note);
    panel.content.append(categoryLabel, noteLabel);
    let ready = false;
    let busy = false;
    let sent = false;
    let draft: ReportDraft | undefined;
    const send = familyButton('Send report', () => { void submit(); }, 'familyReportSend');
    send.setAttribute('aria-disabled', 'true');
    const cancel = familyButton('Cancel', panel.close);
    panel.actions.append(send, cancel);
    panel.status.textContent = 'Checking whether reporting is available…';
    async function submit() {
        if (!ready || busy || sent || !panel.current()) return;
        busy = true;
        send.setAttribute('aria-disabled', 'true');
        // The draft and operation id are immutable after an uncertain submission.
        draft ||= createIssueReport(item, category.value as IssueCategory, note.value, {
            ...context, deviceName: appHost.deviceName(), appVersion: appHost.appVersion()
        });
        category.disabled = true;
        note.readOnly = true;
        panel.status.textContent = 'Sending report…';
        const result = await sendIssueReport(draft, session!);
        if (!panel.current()) return;
        busy = false;
        if (result.status === 'sent') {
            sent = true;
            panel.status.textContent = 'Sent. An administrator can now review this report.';
            send.textContent = 'Sent';
            cancel.textContent = 'Close';
        } else {
            ready = result.retryable;
            panel.status.textContent = result.retryable ?
                'Not confirmed sent. Keep this form open and retry; the same report will not be duplicated.' :
                'Not sent. Reporting is unavailable for this signed-in session. Sign in again before retrying.';
            send.textContent = 'Retry sending';
            send.setAttribute('aria-disabled', String(!ready));
        }
    }
    panel.open();
    void issueCapabilities(session).then(capability => {
        if (!panel.current()) return;
        ready = !!capability;
        send.setAttribute('aria-disabled', String(!ready));
        panel.status.textContent = ready ? 'Nothing is sent until you choose Send report.' : 'Reporting is unavailable. No report has been sent.';
    });
    return panel.close;
}
function openIssueCase(initial: IssueCase, session: FamilySession, origin: HTMLElement, changed: () => void): () => void {
    const panel = familyDialog('Problem details', session, origin);
    let item = initial;
    let busy = false;
    let operation: StatusOperation | undefined;
    const close = familyButton('Close', panel.close);
    const retry = familyButton('Retry status change', () => { if (operation) void perform(operation); });
    retry.hidden = true;
    const statusButtons = (['investigating', 'resolved', 'dismissed'] as IssueStatus[]).map(status => familyButton(
        status === 'investigating' ? 'Mark investigating' : status === 'resolved' ? 'Resolve' : 'Dismiss',
        () => {
            if (busy || operation || !panel.current()) return;
            operation = { operationId: familyOperationId(), expectedRevision: item.revision, status };
            void perform(operation);
        }
    ));
    panel.actions.append(...statusButtons, retry, close);
    function paint() {
        panel.content.replaceChildren();
        panel.content.append(familyParagraph(item.title, 'familyProblemTitle'));
        if (item.seriesName) panel.content.append(familyParagraph(`${item.seriesName} · Season ${item.seasonNumber ?? '?'} · Episode ${item.episodeNumber ?? '?'}`));
        panel.content.append(familyParagraph(`${ISSUE_LABELS[item.category]} · ${item.status} · ${item.reportCount} report(s)`));
        panel.content.append(familyParagraph(`First reported ${reportTime(item.createdAtEpochMillis)} · Updated ${reportTime(item.updatedAtEpochMillis)}`));
        const pathLabel = document.createElement('label');
        pathLabel.textContent = 'File path (administrator only)';
        const path = document.createElement('textarea');
        path.readOnly = true;
        path.rows = 2;
        path.value = item.filePath || 'Path unavailable; the item may have moved or been removed.';
        pathLabel.append(path);
        panel.content.append(pathLabel);
        if (item.filePath) {
            panel.content.append(familyButton('Copy file path', () => {
                if (!panel.current()) return;
                if (navigator.clipboard?.writeText) {
                    void navigator.clipboard.writeText(item.filePath!).then(() => {
                        if (panel.current()) panel.status.textContent = 'File path copied.';
                    }, () => {
                        if (panel.current()) { path.focus(); path.select(); panel.status.textContent = 'Copy is unavailable here. The exact path is selected for manual copying.'; }
                    });
                } else { path.focus(); path.select(); panel.status.textContent = 'The exact path is selected for manual copying.'; }
            }));
        }
        if (item.mediaSourceId) panel.content.append(familyParagraph('Media source: ' + item.mediaSourceId));
        item.reports.forEach(report => {
            const entry = document.createElement('section');
            entry.className = 'familyReportContext';
            entry.append(familyParagraph(`${report.userName} · ${reportTime(report.createdAtEpochMillis)}`));
            if (report.note) entry.append(familyParagraph(report.note));
            if (report.positionTicks != null) entry.append(familyParagraph(`Reported position: ${(report.positionTicks / 10_000_000).toFixed(1)} seconds`));
            if (report.deviceName || report.appVersion) entry.append(familyParagraph(`Device: ${report.deviceName || 'Unknown'} · App: ${report.appVersion || 'Unknown'}`));
            panel.content.append(entry);
        });
    }
    async function perform(pending: StatusOperation) {
        if (busy || !panel.current()) return;
        busy = true;
        [...statusButtons, retry].forEach(button => button.setAttribute('aria-disabled', 'true'));
        panel.status.textContent = 'Updating report status…';
        try {
            const result = await updateIssueStatus(session, item.caseId, pending);
            if (!panel.current()) return;
            item = result.item;
            operation = undefined;
            retry.hidden = true;
            paint();
            panel.status.textContent = result.status === 'conflict' ?
                'Another administrator changed this case. Its current status is shown; review it before choosing again.' :
                'Status updated. Public warnings refresh automatically; no media or watched state was changed.';
            changed();
        } catch (error) {
            if (!panel.current()) return;
            if (error instanceof FamilyRequestError && [401, 403].includes(error.status)) {
                panel.close();
                return;
            }
            retry.hidden = false;
            panel.status.textContent = 'Status change not confirmed. Retry uses the same operation; no report is deleted.';
        } finally {
            busy = false;
            statusButtons.forEach(button => button.setAttribute('aria-disabled', String(!!operation)));
            retry.setAttribute('aria-disabled', 'false');
        }
    }
    paint();
    panel.open();
    return panel.close;
}

export function openProblemsInbox(client: ApiClient, origin?: HTMLElement): () => void {
    const session = captureFamilySession(client);
    if (!session) return () => undefined;
    let closeCase: (() => void) | undefined;
    const panel = familyDialog('Problems inbox', session, origin, () => closeCase?.());
    const filterLabel = document.createElement('label');
    filterLabel.textContent = 'Cases to show';
    const filter = document.createElement('select');
    filter.add(new Option('Open reports', 'active'));
    filter.add(new Option('All reports, including resolved and dismissed', 'all'));
    filterLabel.append(filter);
    const list = document.createElement('div');
    list.className = 'familyProblemsList';
    panel.content.append(filterLabel, list);
    let offset = 0;
    let total = 0;
    let generation = 0;
    let busy = false;
    const previous = familyButton('Previous page', () => { if (offset && !busy) { offset = Math.max(0, offset - 100); void refresh(true); } });
    const next = familyButton('Next page', () => { if (offset + 100 < total && !busy) { offset += 100; void refresh(true); } });
    const reload = familyButton('Refresh inbox', () => { if (!busy) void refresh(true); });
    panel.actions.append(previous, next, reload, familyButton('Close', panel.close));
    filter.addEventListener('change', () => { offset = 0; void refresh(true); });
    async function refresh(acknowledge: boolean) {
        const request = ++generation;
        busy = true;
        panel.status.textContent = 'Loading the administrator inbox…';
        try {
            // Administrative content appears only after the authenticated capability response.
            if (!(await issueCapabilities(session!, true))?.isAdmin) throw new FamilyRequestError('Administrator access unavailable', 403);
            const result = await loadAdminIssueCases(session!, filter.value as 'active' | 'all', offset);
            if (!panel.current() || request !== generation) return;
            total = result.total;
            const focused = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ?
                document.activeElement.dataset.caseId : undefined;
            const fragment = document.createDocumentFragment();
            result.items.forEach(item => {
                const button = familyButton(`${item.title} · ${ISSUE_LABELS[item.category]} · ${item.status} · ${item.reportCount} report(s)`, () => {
                    closeCase?.();
                    closeCase = openIssueCase(item, session!, button, () => { void refresh(false); });
                });
                button.dataset.caseId = item.caseId;
                fragment.append(button);
            });
            if (!result.items.length) fragment.append(familyParagraph('No reports in this view.'));
            list.replaceChildren(fragment);
            if (focused && document.activeElement === document.body) {
                Array.from(list.querySelectorAll<HTMLButtonElement>('button')).find(button => button.dataset.caseId === focused)?.focus();
            }
            previous.setAttribute('aria-disabled', String(offset === 0));
            next.setAttribute('aria-disabled', String(offset + 100 >= total));
            panel.status.textContent = `${total} case(s). Reports are unverified until investigated. Historical reports do not imply an item is still playable.`;
            // A badge poll never acknowledges. Only a loaded, foreground inbox the
            // user opened/refreshed can acknowledge the revision actually rendered.
            if (acknowledge) {
                requestAnimationFrame(() => {
                    if (panel.current() && request === generation && panel.dialog.isConnected && !document.hidden) {
                        void acknowledgeIssueInbox(session!, result.revision).catch(() => {
                            if (panel.current()) panel.status.textContent += ' New-report acknowledgement is unavailable; the unread count may remain.';
                        });
                    }
                });
            }
        } catch (error) {
            if (!panel.current() || request !== generation) return;
            if (error instanceof FamilyRequestError && [401, 403].includes(error.status)) list.replaceChildren();
            panel.status.textContent = 'Problems inbox unavailable. Administrator access or the server connection could not be confirmed.';
        } finally { if (request === generation) busy = false; }
    }
    panel.open();
    void refresh(true);
    return panel.close;
}
/* eslint-enable @stylistic/max-statements-per-line, array-callback-return, no-nested-ternary, sonarjs/no-nested-conditional, sonarjs/no-nested-functions */
