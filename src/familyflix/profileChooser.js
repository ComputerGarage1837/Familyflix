import { ServerConnections } from 'lib/jellyfin-apiclient';

import { activateProfile, partyFor, readPresets, savePreset, setParty, visibleProfiles } from './profiles';
import { abandonCoWatch } from './cowatch';
import { readKidsSettings, verifyKidsPin } from './kidsMode';
import './profileChooser.scss';

let chooser;

export async function openProfileChooser() {
    chooser?.remove();
    const apiClient = ServerConnections.currentApiClient();
    if (!apiClient?.accessToken()) return;
    const previousFocus = document.activeElement;
    const root = document.createElement('div');
    root.className = 'familyProfileOverlay';
    root.innerHTML = `<section class="familyProfilePanel" role="dialog" aria-modal="true" aria-label="Choose profile">
        <header><h1>Who's watching?</h1><button type="button" class="familyProfileClose" aria-label="Close">×</button></header>
        <div class="familyProfileCards" aria-label="Profiles"></div>
        <form class="familyProfilePassword hide"><label>Password for <span class="familyProfilePasswordName"></span>
            <input type="password" autocomplete="current-password" required></label>
            <button type="submit">Sign in</button><button type="button" class="familyProfileCancel">Cancel</button></form>
        <div class="familyProfileActions">
            <button type="button" class="familyWatchTogether">Watching Together</button>
            <button type="button" class="familyStopTogether">Stop Watching Together</button>
            <button type="button" class="familyKidsMode">Kids Mode</button>
            <button type="button" class="familyProfileSettings">Settings</button>
        </div>
        <div class="familyProfileExtras"></div>
        <p class="familyProfileMessage" aria-live="polite"></p>
    </section>`;
    document.body.appendChild(root);
    chooser = root;
    let profiles = [];
    let selectedProfile;
    const message = root.querySelector('.familyProfileMessage');
    const extras = root.querySelector('.familyProfileExtras');
    const kidsActive = readKidsSettings(apiClient).enabled;
    root.querySelector('.familyWatchTogether').classList.toggle('hide', kidsActive);
    root.querySelector('.familyStopTogether').classList.toggle('hide', kidsActive);
    const close = () => {
        root.remove();
        if (chooser === root) chooser = null;
        previousFocus?.focus?.();
    };
    root.querySelector('.familyProfileClose').addEventListener('click', close);
    root.addEventListener('click', event => {
        if (event.target === root) close();
    });
    root.addEventListener('keydown', event => {
        if (event.key === 'Escape') close();
    });
    const passwordForm = root.querySelector('.familyProfilePassword');
    const allowProfileChange = async () => {
        const settings = readKidsSettings(apiClient);
        if (!settings.enabled || !settings.pinHash) return true;
        const pin = window.prompt('Enter the parent PIN to change profiles:');
        return Boolean(pin) && verifyKidsPin(settings, pin);
    };
    root.querySelector('.familyProfileCancel').addEventListener('click', () => {
        passwordForm.classList.add('hide');
        selectedProfile = null;
    });
    passwordForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (!selectedProfile) return;
        const input = passwordForm.querySelector('input');
        message.textContent = 'Signing in…';
        try {
            await apiClient.authenticateUserByName(selectedProfile.name, input.value);
            input.value = '';
            window.location.hash = '#/home';
            window.location.reload();
        } catch {
            input.value = '';
            message.textContent = 'Sign-in failed. Check the password and try again.';
        }
    });
    const renderPartyStatus = () => {
        const party = partyFor(apiClient);
        root.querySelector('.familyStopTogether').classList.toggle('hide', !party || kidsActive);
        if (!party) return;
        const names = [apiClient.getCurrentUserId(), ...party.participantUserIds]
            .map(id => profiles.find(profile => profile.id.replaceAll('-', '') === id.replaceAll('-', ''))?.name)
            .filter(Boolean);
        message.textContent = `${names.join(' / ')} · Watching Together`;
    };
    root.querySelector('.familyStopTogether').addEventListener('click', () => {
        abandonCoWatch();
        setParty(apiClient, null);
        close();
        window.location.hash = '#/home';
        window.location.reload();
    });
    root.querySelector('.familyKidsMode').addEventListener('click', () => {
        import('./kidsMode').then(({ openKidsSettings }) => {
            close();
            openKidsSettings();
        });
    });
    root.querySelector('.familyProfileSettings').addEventListener('click', () => {
        close();
        window.location.hash = '#/mypreferencesmenu';
    });
    root.querySelector('.familyWatchTogether').addEventListener('click', async () => {
        extras.replaceChildren();
        const party = partyFor(apiClient);
        const available = profiles.filter(profile => !profile.current && profile.saved);
        if (!available.length) {
            extras.textContent = 'Sign in to another visible profile on this computer before watching together.';
            return;
        }
        const title = document.createElement('h2');
        title.textContent = 'Watching Together';
        extras.appendChild(title);
        const participantList = document.createElement('div');
        participantList.className = 'familyPartyMembers';
        for (const profile of available) {
            const label = document.createElement('label');
            const check = document.createElement('input');
            check.type = 'checkbox';
            check.value = profile.id;
            check.checked = party?.participantUserIds?.some(id => id.replaceAll('-', '') === profile.id.replaceAll('-', '')) || false;
            label.append(check, document.createTextNode(profile.name));
            participantList.appendChild(label);
        }
        extras.appendChild(participantList);
        const feedLabel = document.createElement('label');
        feedLabel.textContent = 'Use Continue Watching and Deck from ';
        const feed = document.createElement('select');
        for (const profile of profiles.filter(item => item.current || item.saved)) {
            const option = new Option(profile.name, profile.id);
            feed.add(option);
        }
        feed.value = party?.homeFeedOwnerUserId || apiClient.getCurrentUserId();
        feedLabel.appendChild(feed);
        extras.appendChild(feedLabel);
        const combinedLabel = document.createElement('label');
        const combined = document.createElement('input');
        combined.type = 'checkbox';
        combined.checked = party?.combinedGroupDeckEnabled !== false;
        combinedLabel.append(combined, document.createTextNode(' Combine everyone\'s Deck'));
        extras.appendChild(combinedLabel);
        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.textContent = 'Start Watching Together';
        saveButton.addEventListener('click', () => {
            const participantUserIds = [...participantList.querySelectorAll('input:checked')].map(input => input.value);
            if (!participantUserIds.length) {
                message.textContent = 'Choose at least one other profile.';
                return;
            }
            const homeFeedOwnerUserId = participantUserIds.includes(feed.value) ? feed.value : apiClient.getCurrentUserId();
            setParty(apiClient, { participantUserIds, homeFeedOwnerUserId, combinedGroupDeckEnabled: combined.checked });
            renderPartyStatus();
            close();
            window.location.hash = '#/home';
            window.location.reload();
        });
        extras.appendChild(saveButton);
        const presetName = document.createElement('input');
        presetName.placeholder = 'Preset name';
        presetName.maxLength = 40;
        extras.appendChild(presetName);
        const presetButton = document.createElement('button');
        presetButton.type = 'button';
        presetButton.textContent = 'Save preset';
        presetButton.addEventListener('click', async () => {
            const participantUserIds = [...participantList.querySelectorAll('input:checked')].map(input => input.value);
            const name = presetName.value.trim();
            if (!name || !participantUserIds.length) return;
            try {
                await savePreset(apiClient, {
                    // The packaged Windows Qt WebEngine supports randomUUID.
                    // eslint-disable-next-line compat/compat
                    id: crypto.randomUUID(), name, participantUserIds,
                    homeFeedOwnerUserId: feed.value, combinedGroupDeckEnabled: combined.checked
                });
                message.textContent = `Saved ${name} for this profile on the server.`;
            } catch (error) {
                message.textContent = error.message;
            }
        });
        extras.appendChild(presetButton);
        try {
            const { presets } = await readPresets(apiClient);
            if (chooser !== root) return;
            for (const preset of presets) {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = preset.name;
                button.addEventListener('click', () => {
                    const visibleIds = new Set(available.map(profile => profile.id.replaceAll('-', '')));
                    const participantUserIds = preset.participantUserIds.filter(id => visibleIds.has(id.replaceAll('-', '')));
                    if (!participantUserIds.length) {
                        message.textContent = 'Sign in to this preset’s visible profiles first.';
                        return;
                    }
                    setParty(apiClient, {
                        participantUserIds,
                        homeFeedOwnerUserId: preset.homeFeedOwnerUserId,
                        combinedGroupDeckEnabled: preset.combinedGroupDeckEnabled
                    });
                    close();
                    window.location.hash = '#/home';
                    window.location.reload();
                });
                extras.appendChild(button);
            }
        } catch (error) {
            message.textContent = error.message;
        }
    });
    try {
        profiles = await visibleProfiles(apiClient);
        if (chooser !== root) return;
        const cards = root.querySelector('.familyProfileCards');
        for (const profile of profiles) {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'familyProfileCard';
            const avatar = document.createElement('img');
            avatar.alt = '';
            avatar.src = apiClient.getUserImageUrl(profile.id, { tag: profile.imageTag, type: 'Primary' });
            const name = document.createElement('span');
            name.textContent = profile.name;
            card.append(avatar, name);
            if (profile.current) card.classList.add('is-current');
            card.addEventListener('click', async () => {
                if (profile.current) return;
                if (!await allowProfileChange()) {
                    message.textContent = 'Parent PIN required to change profiles.';
                    return;
                }
                if (profile.saved) {
                    try {
                        message.textContent = `Switching to ${profile.name}…`;
                        await activateProfile(ServerConnections, profile);
                        return;
                    } catch (error) {
                        message.textContent = error.message;
                    }
                }
                selectedProfile = profile;
                root.querySelector('.familyProfilePasswordName').textContent = profile.name;
                passwordForm.classList.remove('hide');
                passwordForm.querySelector('input').focus();
            });
            cards.appendChild(card);
        }
        renderPartyStatus();
        cards.querySelector('button')?.focus();
    } catch (error) {
        message.textContent = `Could not load visible profiles: ${error.message}`;
    }
}
