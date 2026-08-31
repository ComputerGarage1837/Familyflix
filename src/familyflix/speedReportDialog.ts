import type { ApiClient } from 'jellyfin-apiclient';
import { appHost } from 'components/apphost';
import { captureFamilySession } from './familySession';
import { familyButton, familyDialog, familyParagraph } from './familyDialogs';
import { clearFamilySpeed, familySpeedSummary } from './speedReport';

export function openFamilySpeedReport(client: ApiClient, origin?: HTMLElement): () => void {
    const session = captureFamilySession(client);
    if (!session) return () => undefined;
    const panel = familyDialog('Speed report', session, origin);
    panel.content.append(familyParagraph(`${appHost.appName()} ${appHost.appVersion()} · ${appHost.deviceName()}`));
    panel.content.append(familyParagraph('These are rolling timings from real actions on this browser. No media probes or uploads run. Network, server cache and disk time are not guessed apart. Titles and item history are never stored.'));
    panel.content.append(familyParagraph('First video-frame timing: unavailable in the common player boundary; playback start below means the player acknowledged starting.'));
    const table = document.createElement('table');
    table.className = 'familySpeedTable';
    const caption = document.createElement('caption');
    caption.textContent = 'Recent local timings';
    const head = document.createElement('tr');
    ['Stage', 'Recent', 'Median', 'Samples'].forEach(value => {
        const cell = document.createElement('th');
        cell.scope = 'col';
        cell.textContent = value;
        head.append(cell);
    });
    table.append(caption, head);
    function render() {
        table.querySelectorAll('tr:not(:first-of-type)').forEach(row => {
            row.remove();
        });
        familySpeedSummary(client).forEach(summary => {
            const row = document.createElement('tr');
            [summary.label, summary.recentMs == null ? 'Unknown' : `${summary.recentMs} ms`,
                summary.medianMs == null ? 'Unknown' : `${Math.round(summary.medianMs)} ms`, String(summary.count)]
                .forEach(value => {
                    const cell = document.createElement('td');
                    cell.textContent = value;
                    row.append(cell);
                });
            table.append(row);
        });
    }
    render();
    panel.content.append(table);
    panel.actions.append(familyButton('Clear speed diagnostics', () => {
        const removed = clearFamilySpeed(client);
        render();
        panel.status.textContent = removed ? 'Speed diagnostics for this server and profile were cleared. No other settings or data changed.' :
            'The current in-memory report was cleared, but browser storage could not be updated.';
    }), familyButton('Close', panel.close));
    panel.open();
    return panel.close;
}
