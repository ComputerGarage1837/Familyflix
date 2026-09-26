const KEY = 'familyflix-windows-shortcuts-v1';
const defaults = { audio: 'KeyA', subtitles: 'KeyL' };
const allowed = ['KeyA', 'KeyL', 'F6', 'F7', 'F8', 'F9', 'Disabled'];
export function readShortcuts() {
    try {
        const value = JSON.parse(localStorage.getItem(KEY) || '{}');
        return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, allowed.includes(value[key]) ? value[key] : fallback]));
    } catch { return { ...defaults }; }
}
export function shortcutCommand(code, settings) {
    if (code === 'Disabled') return null;
    if (code === settings.audio) return 'changeaudiotrack';
    if (code === settings.subtitles) return 'changesubtitletrack';
    return null;
}
export function installDesktopShortcuts(handleCommand, isPlaying, getLongPress) {
    const canInvoke = () => isPlaying() && !document.querySelector('.dialog.opened,.familyNextOverlay')
        && !document.activeElement?.closest?.('input,textarea,select,[contenteditable=true]');
    window.familyDesktopShortcut = code => canInvoke() ? shortcutCommand(code, readShortcuts()) : null;
    window.familyDesktopLongPress = async () => {
        if (!isPlaying()) return handleCommand('menu', {});
        if (!canInvoke()) return;
        const mode = getLongPress();
        if (mode === 'NONE') return;
        if (mode === 'AUDIO') return document.querySelector('#videoOsdPage .btnAudio')?.click();
        if (mode === 'SUBTITLES') return document.querySelector('#videoOsdPage .btnSubtitles')?.click();
        if (mode === 'PLAYBACK_INSPECTOR') return handleCommand('togglestats', {});
        const { default: alert } = await import('../components/alert');
        const keys = readShortcuts();
        return alert(`Arrows: navigation / seek. Enter: select. Back or Escape: return. Audio: ${keys.audio.replace('Key', '')}. Subtitles: ${keys.subtitles.replace('Key', '')}. Media keys: playback controls. Hold Enter / OK: this configured action.`, 'Remote guide');
    };
    document.addEventListener('keydown', event => {
        if (!window.NativeShell || !isPlaying() || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
        if (!canInvoke()) return;
        const command = shortcutCommand(event.code, readShortcuts());
        if (!command) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        handleCommand(command, {});
    }, true);
}
export function bindShortcutSettings(context) {
    const section = document.createElement('section');
    section.className = 'verticalSection';
    section.innerHTML = '<h2>Keyboard and remote shortcuts</h2><p>Arrows navigate; Enter selects; Back/Escape returns. These Windows keyboard/keyboard-remote bindings stay on this device; Android key codes are not overwritten.</p>';
    const current = readShortcuts();
    const controls = {};
    for (const [key, label] of [['audio', 'Cycle audio track'], ['subtitles', 'Cycle subtitles']]) {
        const wrapper = document.createElement('label');
        wrapper.className = 'selectContainer';
        wrapper.textContent = label + ' ';
        const select = document.createElement('select');
        select.className = 'emby-select';
        for (const code of allowed) select.add(new Option(code.replace('Key', ''), code));
        select.value = current[key];
        controls[key] = select;
        wrapper.appendChild(select);
        section.appendChild(wrapper);
    }
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'emby-button raised show-focus';
    save.textContent = 'Save shortcuts';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    save.addEventListener('click', () => {
        const value = { audio: controls.audio.value, subtitles: controls.subtitles.value };
        if (value.audio !== 'Disabled' && value.audio === value.subtitles) {
            status.textContent = 'Choose different keys.';
            return;
        }
        try {
            localStorage.setItem(KEY, JSON.stringify(value));
            status.textContent = 'Saved for this Windows device.';
        } catch { status.textContent = 'Unable to save device settings.'; }
    });
    section.append(save, status);
    context.querySelector('form').appendChild(section);
}
