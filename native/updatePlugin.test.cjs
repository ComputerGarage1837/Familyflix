const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'updatePlugin.js'), 'utf8');

async function run(releases, version = '2.0.0-family.2') {
    const opened = [];
    const prompts = [];
    let callback;
    const system = {
        updateInfoEmitted: { connect: fn => { callback = fn; } },
        checkForUpdates: () => undefined,
        openExternalUrl: url => opened.push(url)
    };
    const context = {
        window: { apiPromise: Promise.resolve({ system }) },
        navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0)' },
        jmpInfo: { version },
        fetch: async () => ({ ok: true, json: async () => releases }),
        setTimeout: callback => { callback(); return 1; }
    };
    vm.runInNewContext(source, context);
    new context.window._updatePlugin({ confirm: async prompt => { prompts.push(prompt); } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof callback, 'function');
    await callback();
    return { opened, prompts };
}

test('ignores Android and upstream releases', async () => {
    const result = await run([
        { tag_name: 'v0.19.10-family.90', html_url: 'https://example.invalid/android' },
        { tag_name: 'windows-v2.0.0-family.3', html_url: 'https://example.invalid/windows', draft: true }
    ]);
    assert.deepEqual(result.opened, []);
    assert.deepEqual(result.prompts, []);
});

test('offers a newer Family Flix Windows release only', async () => {
    const result = await run([
        { tag_name: 'windows-v2.0.0-family.1', html_url: 'https://example.invalid/old' },
        { tag_name: 'windows-v2.0.0-family.3', html_url: 'https://example.invalid/new' }
    ]);
    assert.deepEqual(result.opened, ['https://example.invalid/new']);
    assert.equal(result.prompts.length, 1);
    assert.match(result.prompts[0].text, /2\.0\.0-family\.3/);
});
