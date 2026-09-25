import { ServerConnections } from 'lib/jellyfin-apiclient';

import './profileChooser.scss';

const KEY = 'familyflix-desktop-kids-settings-v1';
const sessions = new Map();
const cleanId = id => String(id || '').replaceAll('-', '').toLowerCase();

function owner(apiClient) {
    return `${cleanId(apiClient.serverId())}:${cleanId(apiClient.getCurrentUserId())}`;
}

export function readKidsSettings(apiClient) {
    if (!apiClient) return { enabled: false, maxEpisodesPerSession: 0, bedtimeStartMinutes: -1, bedtimeEndMinutes: -1 };
    try {
        const all = JSON.parse(localStorage.getItem(KEY) || '{}');
        return {
            enabled: false, maxEpisodesPerSession: 0, bedtimeStartMinutes: -1, bedtimeEndMinutes: -1,
            ...(all[owner(apiClient)] || {})
        };
    } catch {
        return { enabled: false, maxEpisodesPerSession: 0, bedtimeStartMinutes: -1, bedtimeEndMinutes: -1 };
    }
}

export function saveKidsSettings(apiClient, settings) {
    let all;
    try {
        all = JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch {
        all = {};
    }
    all[owner(apiClient)] = settings;
    localStorage.setItem(KEY, JSON.stringify(all));
    document.dispatchEvent(new Event('familyflix-kids-updated'));
}

async function hashPin(pin, salt) {
    const encoder = new TextEncoder();
    let bytes = encoder.encode(`${salt}:${pin}`);
    for (let round = 0; round < 2000; round++) {
        // This client is packaged with a current Qt WebEngine.
        // eslint-disable-next-line compat/compat
        bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    }
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function withKidsPin(settings, pin) {
    if (!pin) return settings;
    if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN must contain 4–8 digits.');
    const saltBytes = new Uint8Array(16);
    // eslint-disable-next-line compat/compat
    crypto.getRandomValues(saltBytes);
    const pinSalt = [...saltBytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return { ...settings, pinSalt, pinHash: await hashPin(pin, pinSalt) };
}

export async function verifyKidsPin(settings, pin) {
    if (!settings.pinSalt || !settings.pinHash) return true;
    return (await hashPin(pin, settings.pinSalt)) === settings.pinHash;
}

export function insideBedtime(settings, now = new Date()) {
    const start = settings.bedtimeStartMinutes;
    const end = settings.bedtimeEndMinutes;
    if (start < 0 || end < 0) return false;
    const minute = now.getHours() * 60 + now.getMinutes();
    if (start === end) return true;
    return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

export function kidsPlaybackReason(apiClient, item, automatic = false, now = new Date()) {
    if (!apiClient) return null;
    const settings = readKidsSettings(apiClient);
    if (!settings.enabled) return null;
    if (insideBedtime(settings, now)) return 'Kids Mode bedtime is active.';
    const session = sessions.get(owner(apiClient));
    if (automatic && item?.Type === 'Episode' && settings.maxEpisodesPerSession > 0
        && (session?.episodesStarted || 0) >= settings.maxEpisodesPerSession) {
        return 'Kids Mode episode limit reached. Choose another title or ask a parent.';
    }
    return null;
}

export function recordKidsPlayback(apiClient, item) {
    if (!apiClient || item?.Type !== 'Episode') return;
    const key = owner(apiClient);
    const session = sessions.get(key) || { episodesStarted: 0, lastId: null };
    if (session.lastId !== item.Id) {
        session.episodesStarted++;
        session.lastId = item.Id;
        sessions.set(key, session);
    }
}

export function resetKidsPlayback(apiClient) {
    sessions.delete(owner(apiClient));
}

let panel;

export async function openKidsSettings() {
    panel?.remove();
    const apiClient = ServerConnections.currentApiClient();
    if (!apiClient?.accessToken()) return;
    const settings = readKidsSettings(apiClient);
    if (settings.pinHash) {
        const pin = window.prompt('Enter the parent PIN to change Kids Mode settings:');
        if (!pin || !await verifyKidsPin(settings, pin)) return;
    }
    const previousFocus = document.activeElement;
    const root = document.createElement('div');
    root.className = 'familyProfileOverlay';
    root.innerHTML = `<section class="familyProfilePanel" role="dialog" aria-modal="true" aria-label="Kids Mode settings">
        <header><h1>Kids Mode</h1><button type="button" class="familyKidsClose" aria-label="Close">×</button></header>
        <p>These controls apply to this profile on this Windows computer.</p>
        <form class="familyProfileExtras familyKidsForm">
            <label><input type="checkbox" name="enabled"> Enable Kids Mode</label>
            <label>Episodes before automatic next stops <input type="number" name="limit" min="0" max="30" value="0"></label>
            <label>Bedtime starts <input type="time" name="start"></label>
            <label>Bedtime ends <input type="time" name="end"></label>
            <label>Parent PIN (optional, 4–8 digits) <input type="password" name="pin" inputmode="numeric" minlength="4" maxlength="8" autocomplete="new-password"></label>
            <button type="submit">Save Kids Mode</button>
        </form><p class="familyProfileMessage" aria-live="polite"></p>
    </section>`;
    document.body.appendChild(root);
    panel = root;
    const form = root.querySelector('form');
    form.elements.enabled.checked = settings.enabled;
    form.elements.limit.value = settings.maxEpisodesPerSession;
    const toTime = minutes => minutes < 0 ? '' : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    form.elements.start.value = toTime(settings.bedtimeStartMinutes);
    form.elements.end.value = toTime(settings.bedtimeEndMinutes);
    const close = () => {
        root.remove();
        if (panel === root) panel = null;
        previousFocus?.focus?.();
    };
    root.querySelector('.familyKidsClose').addEventListener('click', close);
    root.addEventListener('keydown', event => {
        if (event.key === 'Escape') close();
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const parseTime = time => time ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) : -1;
        const start = parseTime(form.elements.start.value);
        const end = parseTime(form.elements.end.value);
        if ((start < 0) !== (end < 0)) {
            root.querySelector('.familyProfileMessage').textContent = 'Set both bedtime times or leave both blank.';
            return;
        }
        try {
            const updated = await withKidsPin({
                ...settings,
                enabled: form.elements.enabled.checked,
                maxEpisodesPerSession: Math.max(0, Math.min(30, Number(form.elements.limit.value) || 0)),
                bedtimeStartMinutes: start,
                bedtimeEndMinutes: end
            }, form.elements.pin.value);
            saveKidsSettings(apiClient, updated);
            resetKidsPlayback(apiClient);
            close();
            window.location.reload();
        } catch (error) {
            root.querySelector('.familyProfileMessage').textContent = error.message;
        }
    });
    form.elements.enabled.focus();
}
