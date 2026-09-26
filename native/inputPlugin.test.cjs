const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('native mapped keys and long Enter reach the desktop handlers once', async () => {
    let hostInput;
    let holds = 0;
    const commands = [];
    const signal = { connect() {}, disconnect() {} };
    const api = {
        system: { hello() {} },
        input: { hostInput: { connect: fn => { hostInput = fn; } }, volumeChanged: signal, rateChanged: signal, positionSeek: signal },
        player: { playbackRateChanged: signal }
    };
    const window = {
        api, apiPromise: Promise.resolve(api),
        jmpInfo: { settings: { main: { fullscreen: false } }, settingsUpdate: [] },
        Events: { on() {}, off() {}, trigger() {} },
        familyDesktopShortcut: code => code === 'F8' ? 'changeaudiotrack' : null,
        familyDesktopLongPress: () => { holds++; }
    };
    const context = { window, console, setInterval: () => 0, clearInterval() {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'inputPlugin.js'), 'utf8'), context);
    new window._inputPlugin({ inputManager: { handleCommand: command => commands.push(command) }, playbackManager: {} });
    await new Promise(resolve => setImmediate(resolve));
    hostInput(['family_key_F8', 'family_key_KeyA', 'family_long_enter', 'enter', 'cycle_subtitles']);
    assert.deepEqual(commands, ['changeaudiotrack', 'select', 'changesubtitletrack']);
    assert.equal(holds, 1);
});
