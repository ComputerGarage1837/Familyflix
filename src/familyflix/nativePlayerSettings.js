const controls = [
    ['.familyNativeHardware', 'video', 'hardwareDecoding'],
    ['.familyNativeRefresh', 'video', 'refreshrate.auto_switch'],
    ['.familyNativeAudioOutput', 'audio', 'devicetype'],
    ['.familyNativeChannels', 'audio', 'channels'],
    ['.familyNativeNormalize', 'audio', 'normalize'],
    ['.familyNativeExclusive', 'audio', 'exclusive'],
    ['.familyNativeAc3', 'audio', 'passthrough.ac3'],
    ['.familyNativeEac3', 'audio', 'passthrough.eac3']
];

export function bindNativePlayerSettings(context, native = window.jmpInfo) {
    const group = context.querySelector('.familyNativePlayerSettings');
    if (!group || !native?.settings?.video || !native?.settings?.audio) return false;
    const refresh = () => {
        for (const [selector, section, key] of controls) {
            const control = group.querySelector(selector);
            if (!control) continue;
            const value = native.settings[section][key];
            if (control.type === 'checkbox') control.checked = Boolean(value);
            else control.value = value;
        }
        const output = native.settings.audio.devicetype;
        group.querySelector('.familyNativeAc3').disabled = output === 'basic';
        group.querySelector('.familyNativeEac3').disabled = output !== 'hdmi';
    };
    for (const [selector, section, key] of controls) {
        const control = group.querySelector(selector);
        if (!control) continue;
        control.addEventListener('change', () => {
            native.settings[section][key] = control.type === 'checkbox' ? control.checked : control.value;
            refresh();
        });
    }
    native.settingsUpdate?.push((section) => {
        if ((section === 'audio' || section === 'video') && group.isConnected) refresh();
    });
    group.classList.remove('hide');
    refresh();
    return true;
}
