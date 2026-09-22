import type { ApiClient } from 'jellyfin-apiclient';
import { captureFamilySession, onFamilySessionChange } from './familySession';
import { CoWatchReporter, type CoWatchParticipant, type CoWatchReport, type CoWatchReportKind } from './coWatchReporter';
import { activeCoWatchParticipants } from './coWatchProfiles';

let reportingClient: ApiClient | undefined;

async function sendSecondary(profile: CoWatchParticipant, kind: CoWatchReportKind, report: CoWatchReport) {
    const session = captureFamilySession(reportingClient);
    if (!session || session.serverId !== profile.serverId || !session.current()) return;
    const paths: Record<CoWatchReportKind, string> = {
        start: 'Sessions/Playing',
        progress: 'Sessions/Playing/Progress',
        stop: 'Sessions/Playing/Stopped'
    };
    const path = paths[kind];
    // eslint-disable-next-line compat/compat -- The legacy entrypoint already installs an AbortController polyfill.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
        const response = await fetch(session.client.getUrl(path), {
            method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', 'X-Emby-Token': profile.token },
            body: JSON.stringify(report)
        });
        if (!response.ok) throw new Error('A secondary watch-state report was rejected.');
    } finally { clearTimeout(timer); }
}

const reporter = new CoWatchReporter(() => {
    const session = captureFamilySession(reportingClient);
    return session ? activeCoWatchParticipants(session) : [];
}, sendSecondary);

let bound = false;
function bind() {
    if (bound) return;
    bound = true;
    onFamilySessionChange(() => reporter.deactivate());
    window.addEventListener('familyflix-cowatch-changed', () => reporter.deactivate());
}

/** Call only after the primary report was constructed; no secondary can replace it. */
export function mirrorCoWatchReport(client: ApiClient, method: string, info: CoWatchReport): void {
    if (!captureFamilySession(client) || !info.ItemId) return;
    bind();
    reportingClient = client;
    if (method === 'reportPlaybackStart') void reporter.start(info);
    else if (method === 'reportPlaybackProgress') void reporter.progress(info);
    else if (method === 'reportPlaybackStopped') void reporter.stop(info);
}
