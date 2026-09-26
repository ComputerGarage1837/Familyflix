const storageKey = 'familyflix-windows-diagnostics-v1';
let entries = [];
try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(saved)) entries = saved.filter(value => typeof value === 'string').slice(-120).map(value => value.slice(0, 1600));
} catch { /* Storage may be unavailable or from an older version. */ }
export function redactDiagnostic(value) {
    return String(value ?? '')
        .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL removed]')
        .replace(/(?:[a-z]:\\|file:\/\/)[^\r\n"<>]*/gi, '[path removed]')
        .replace(/(?:access[_-]?token|api[_-]?key|authorization|password|token)["']?\s*[=:][^\r\n]*/gi, '[credentials removed]')
        .replace(/\b[a-f0-9]{32,}\b/gi, '[identifier removed]').slice(0, 1500);
}
export function recordDiagnostic(reason, detail) {
    entries.push(`${new Date().toISOString()} ${redactDiagnostic(reason)}: ${redactDiagnostic(detail)}`);
    if (entries.length > 120) entries.splice(0, entries.length - 120);
    try {
        localStorage.setItem(storageKey, JSON.stringify(entries));
    } catch { /* Continue without persistence if storage is full. */ }
}
export function clearDiagnostics() {
    entries.length = 0;
    try {
        localStorage.removeItem(storageKey);
    } catch { /* Storage may be unavailable. */ }
}
export function diagnosticSnapshot() {
    return entries.join('\n');
}
async function nativeCrashSummary() {
    try {
        const bridge = await Promise.race([
            window.apiPromise,
            new Promise(resolve => setTimeout(() => resolve(null), 1000))
        ]);
        if (!bridge?.system?.recentCrashSummary) return '';
        return await new Promise(resolve => {
            const timeout = setTimeout(() => resolve(''), 1000);
            bridge.system.recentCrashSummary(summary => {
                clearTimeout(timeout);
                resolve(redactDiagnostic(summary));
            });
        });
    } catch { return ''; }
}
window.addEventListener('error', event => recordDiagnostic('Client error', event.message));
window.addEventListener('unhandledrejection', event => recordDiagnostic('Unhandled request', event.reason?.message || 'Unknown failure'));
window.addEventListener('familyflix-diagnostic', event => recordDiagnostic('Native player / updater', event.detail));
for (const level of ['warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
        recordDiagnostic(level, args.slice(0, 3).map(value => typeof value === 'string' ? value : value?.message || '[details omitted]').join(' '));
        original(...args);
    };
}

export async function sendDiagnostics(api) {
    if (!api?.getCurrentUserId() || !api.accessToken()) throw new Error('Sign in before sending diagnostics.');
    // eslint-disable-next-line compat/compat -- Packaged Windows Qt WebEngine supports AbortController.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    // eslint-disable-next-line sonarjs/pseudo-random -- Report correlation only, not authentication.
    const reportId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const crash = await nativeCrashSummary();
    const report = `client: Family Flix Windows\ntype: diagnostic_report\nreport_id: ${reportId}\n`
        + `platform: ${redactDiagnostic(navigator.userAgent)}\n\nRecent client errors (retained across restarts):\n${diagnosticSnapshot() || 'No errors captured.'}\n`
        + `\nLatest native crash: ${crash || 'None recorded.'}\n`
        + '\nScope: client and native crash summary only; native minidump remains on this PC.\n';
    try {
        const response = await fetch(api.getUrl('ClientLog/Document'), {
            method: 'POST', headers: { 'X-Emby-Token': api.accessToken(), 'Content-Type': 'text/plain; charset=utf-8' },
            body: report, signal: controller.signal
        });
        if (!response.ok) throw new Error(`Diagnostics upload failed (HTTP ${response.status}).`);
        return reportId;
    } finally { clearTimeout(timeout); }
}

export function bindDiagnostics(context, api) {
    const button = context.querySelector('.familySendDiagnostics');
    const status = context.querySelector('.familyDiagnosticsStatus');
    const userId = api.getCurrentUserId();
    button.addEventListener('click', async () => {
        if (api.getCurrentUserId() !== userId) return;
        button.disabled = true;
        status.textContent = 'Sending recent client errors…';
        try {
            const id = await sendDiagnostics(api);
            if (api.getCurrentUserId() === userId) status.textContent = `Sent to the server administrator. Report: ${id}`;
        } catch (error) {
            status.textContent = error.name === 'AbortError' ? 'Upload timed out. You can try again.' : error.message;
        } finally { button.disabled = false; }
    });
}
