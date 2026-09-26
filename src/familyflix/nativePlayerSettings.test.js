import { expect, it, vi } from 'vitest';
import { bindNativePlayerSettings } from './nativePlayerSettings';

it('only displays native device controls when the native bridge is present', () => {
    const group = document.createElement('fieldset');
    group.className = 'familyNativePlayerSettings hide';
    const context = document.createElement('div');
    context.append(group);
    expect(bindNativePlayerSettings(context, null)).toBe(false);
    expect(group.classList.contains('hide')).toBe(true);
});

it('updates device settings and gates audio passthrough by output type', () => {
    const group = document.createElement('fieldset');
    group.className = 'familyNativePlayerSettings hide';
    for (const [className, type] of [['familyNativeHardware', 'select'], ['familyNativeAudioOutput', 'select'],
        ['familyNativeAc3', 'input'], ['familyNativeEac3', 'input']]) {
        const control = document.createElement(type);
        control.className = className;
        if (type === 'input') control.type = 'checkbox';
        else for (const value of ['copy', 'enabled', 'basic', 'hdmi']) control.add(new Option(value, value));
        group.append(control);
    }
    const context = document.createElement('div');
    context.append(group);
    const native = { settings: { audio: { devicetype: 'basic' }, video: { hardwareDecoding: 'copy' } }, settingsUpdate: [] };
    expect(bindNativePlayerSettings(context, native)).toBe(true);
    expect(group.querySelector('.familyNativeAc3').disabled).toBe(true);
    group.querySelector('.familyNativeAudioOutput').value = 'hdmi';
    group.querySelector('.familyNativeAudioOutput').dispatchEvent(new Event('change'));
    expect(native.settings.audio.devicetype).toBe('hdmi');
    expect(group.querySelector('.familyNativeEac3').disabled).toBe(false);
    expect(group.classList.contains('hide')).toBe(false);
    vi.restoreAllMocks();
});
