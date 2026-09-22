import type { ApiClient } from 'jellyfin-apiclient';
import type { UserDto } from '@jellyfin/sdk/lib/generated-client';
/* eslint-disable sonarjs/no-hardcoded-passwords -- These are password input controls; no credential value is embedded. */
import { familyButton, familyDialog, familyParagraph } from './familyDialogs';
import { captureFamilySession, type FamilySession } from './familySession';
import { addCoWatchProfile, disableCoWatch, readCoWatchState, writeCoWatchState,
    type CoWatchState } from './coWatchProfiles';
import './coWatch.scss';

const id = (value?: string | null) => (value || '').toLowerCase().replace(/-/g, '');

/** Only the server's public sign-in users may appear in this dialog. */
export function openCoWatchDialog(client: ApiClient, origin?: HTMLElement): () => void {
    const captured = captureFamilySession(client);
    if (!captured) return () => undefined;
    const session: FamilySession = captured;
    const ui = familyDialog('Watching Together', session, origin);
    ui.dialog.classList.add('familyCoWatchDialog');
    const heading = familyParagraph('Choose the visible profiles sharing this screen. Each person signs in once on this Windows device.');
    const participants = document.createElement('div');
    participants.className = 'familyCoWatchProfiles';
    const homeLabel = document.createElement('label');
    homeLabel.textContent = 'Whose Continue Watching and Deck?';
    const home = document.createElement('select');
    home.className = 'emby-select';
    homeLabel.append(home);
    const presetRow = document.createElement('div');
    presetRow.className = 'familyCoWatchPresets';
    const presetName = document.createElement('input');
    presetName.className = 'emby-input';
    presetName.maxLength = 40;
    presetName.placeholder = 'Preset name';
    presetName.setAttribute('aria-label', 'Preset name');
    const savePreset = familyButton('Save preset', () => {
        const name = presetName.value.trim();
        if (!name || !ui.current()) return;
        const state = readCoWatchState(session);
        state.presets = [...state.presets.filter(preset => preset.name.toLowerCase() !== name.toLowerCase()), {
            name, participantIds: [...state.activeIds], homeUserId: state.homeUserId || session.userId
        }];
        writeCoWatchState(session, state);
        renderPresets(state);
        ui.status.textContent = `Saved ${name} on this device.`;
    });
    const presetButtons = document.createElement('div');
    presetButtons.className = 'familyCoWatchPresetButtons';
    presetRow.append(presetName, savePreset, presetButtons);
    ui.content.append(heading, participants, homeLabel, presetRow);
    const stop = familyButton('Stop Watching Together', () => {
        disableCoWatch(session);
        render();
        ui.status.textContent = 'Watching Together is off. This profile is now watching alone.';
    });
    ui.actions.append(stop, familyButton('Close', ui.close));

    let visible: UserDto[] = [];
    let primaryName = 'My profile';
    function selected(state: CoWatchState, userId: string) {
        return state.activeIds.some(value => id(value) === id(userId));
    }
    function renderHome(state: CoWatchState) {
        const before = state.homeUserId || session.userId;
        home.replaceChildren(new Option(primaryName, session.userId));
        state.profiles.filter(profile => selected(state, profile.userId))
            .forEach(profile => { home.add(new Option(profile.name, profile.userId)); });
        home.value = [...home.options].some(option => id(option.value) === id(before)) ? before : session.userId;
    }
    function renderPresets(state: CoWatchState) {
        presetButtons.replaceChildren();
        state.presets.forEach(preset => {
            const button = familyButton(preset.name, () => {
                if (!ui.current()) return;
                const latest = readCoWatchState(session);
                const allowed = new Set(latest.profiles.map(profile => id(profile.userId)));
                latest.activeIds = preset.participantIds.filter(value => allowed.has(id(value)));
                latest.homeUserId = preset.homeUserId;
                writeCoWatchState(session, latest);
                render();
                ui.status.textContent = `Watching Together preset ${preset.name} is active.`;
            });
            presetButtons.append(button);
        });
    }
    function render() {
        if (!ui.current()) return;
        const state = readCoWatchState(session);
        participants.replaceChildren();
        visible.filter(user => user.Id && id(user.Id) !== id(session.userId)).forEach(user => {
            const userId = user.Id!;
            const profile = state.profiles.find(saved => id(saved.userId) === id(userId));
            const row = document.createElement('div');
            row.className = 'familyCoWatchProfile';
            const name = document.createElement('strong');
            name.textContent = user.Name || 'Family member';
            row.append(name);
            if (profile) {
                const label = document.createElement('label');
                const check = document.createElement('input');
                check.type = 'checkbox';
                check.checked = selected(state, userId);
                check.addEventListener('change', () => {
                    const latest = readCoWatchState(session);
                    latest.activeIds = latest.activeIds.filter(value => id(value) !== id(userId));
                    if (check.checked) latest.activeIds.push(userId);
                    if (!check.checked && id(latest.homeUserId) === id(userId)) latest.homeUserId = session.userId;
                    writeCoWatchState(session, latest);
                    renderHome(latest);
                    updateStatus(latest);
                });
                label.append(check, document.createTextNode(' Watch with ' + profile.name));
                row.append(label);
            }
            const password = document.createElement('input');
            password.type = 'password';
            password.className = 'emby-input';
            password.placeholder = profile ? 'Password to refresh sign-in (if any)' : 'Password (if any)';
            password.autocomplete = 'current-password';
            password.setAttribute('aria-label', `Password for ${user.Name || 'family member'}`);
            const add = familyButton(profile ? 'Refresh sign-in' : 'Sign in for Watching Together', async () => {
                if (!ui.current()) return;
                add.disabled = true;
                try {
                    await addCoWatchProfile(session, client, user, password.value);
                    password.value = '';
                    if (ui.current()) {
                        render();
                        ui.status.textContent = `${user.Name} is ready to watch together.`;
                    }
                } catch (error) {
                    if (ui.current()) ui.status.textContent = error instanceof Error ? error.message : 'Sign in failed.';
                } finally { add.disabled = false; }
            });
            row.append(password, add);
            participants.append(row);
        });
        renderHome(state);
        renderPresets(state);
        updateStatus(state);
    }
    function updateStatus(state: CoWatchState) {
        const names = state.profiles.filter(profile => selected(state, profile.userId)).map(profile => profile.name);
        heading.textContent = names.length ? `${primaryName} / ${names.join(' / ')} · Watching Together` :
            'Watching Together is off. Choose a family member below.';
        stop.disabled = names.length === 0;
    }
    home.addEventListener('change', () => {
        const state = readCoWatchState(session);
        state.homeUserId = home.value;
        writeCoWatchState(session, state);
    });

    ui.open();
    ui.status.textContent = 'Loading visible profiles…';
    void Promise.all([client.getPublicUsers(), client.getCurrentUser()]).then(([users, primary]) => {
        if (!ui.current()) return;
        visible = users.filter(user => !!user.Id && !!user.Name);
        primaryName = primary?.Name || primaryName;
        const allowed = new Set(visible.map(user => id(user.Id)));
        const state = readCoWatchState(session);
        const oldCount = state.profiles.length + state.activeIds.length;
        state.profiles = state.profiles.filter(profile => allowed.has(id(profile.userId)));
        state.activeIds = state.activeIds.filter(value => allowed.has(id(value)));
        if (oldCount !== state.profiles.length + state.activeIds.length) writeCoWatchState(session, state);
        render();
        ui.status.textContent = '';
    }).catch(() => {
        if (ui.current()) ui.status.textContent = 'Visible profiles could not be loaded. Try again later.';
    });
    return ui.close;
}
/* eslint-enable sonarjs/no-hardcoded-passwords */
