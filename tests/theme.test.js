import test from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Runs the real js/theme.js with a fake localStorage, documentElement and OS dark-mode query.
function loadTheme({ saved = null, systemDark = false, storageThrows = false } = {}) {
    const store = new Map(saved ? [['theme', saved]] : []);
    const listeners = [];
    const media = {
        matches: systemDark,
        addEventListener(type, fn) { listeners.push(fn); },
    };
    const documentElement = { dataset: {} };
    const events = [];
    const failing = () => { throw new Error('blocked'); };
    const sandbox = {
        localStorage: storageThrows
            ? { getItem: failing, setItem: failing, removeItem: failing }
            : { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
        document: {
            documentElement,
            dispatchEvent: event => events.push(event.detail),
            addEventListener() {},
        },
        CustomEvent: class { constructor(type, init) { this.detail = init.detail; } },
    };
    sandbox.window = { matchMedia: () => media, addEventListener() {} };
    vm.runInNewContext(readFileSync('js/theme.js', 'utf8'), sandbox);
    const setSystemDark = dark => { media.matches = dark; listeners.forEach(fn => fn()); };
    return { theme: sandbox.window.minuetTheme, root: documentElement, store, events, setSystemDark };
}

test('defaults to following the system', () => {
    const light = loadTheme();
    assert.equal(light.theme.choice, 'system');
    assert.equal(light.root.dataset.theme, 'light');
    assert.equal(loadTheme({ systemDark: true }).root.dataset.theme, 'dark');
});

test('"system" follows the OS when it changes; a fixed choice does not', () => {
    const t = loadTheme();
    t.setSystemDark(true);
    assert.equal(t.root.dataset.theme, 'dark');
    t.theme.set('light');
    t.setSystemDark(true);
    assert.equal(t.root.dataset.theme, 'light');
});

test('a saved choice is applied and kept', () => {
    const t = loadTheme({ saved: 'dark' });
    assert.equal(t.root.dataset.theme, 'dark');
    t.theme.set('light');
    assert.equal(t.store.get('theme'), 'light');
    t.theme.set('system');
    assert.equal(t.store.has('theme'), false);
    assert.deepEqual(t.events.at(-1), { choice: 'system', theme: 'light' });
});

test('ignores unknown values, and works when storage is blocked', () => {
    assert.equal(loadTheme({ saved: 'purple' }).theme.choice, 'system');
    const t = loadTheme({ storageThrows: true });
    t.theme.set('dark');
    assert.equal(t.root.dataset.theme, 'dark');
    t.theme.set('nope');
    assert.equal(t.theme.choice, 'dark');
});
