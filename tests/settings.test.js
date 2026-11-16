import test from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Runs the real js/settings.js in a sandbox with a minimal fake DOM and a scripted backend.
function loadSettings() {
    const elements = new Map();
    const element = () => ({
        hidden: false, value: '', textContent: '', children: [],
        replaceChildren(...children) { this.children = children; },
        addEventListener() {}, setAttribute() {}, scrollIntoView() {},
    });
    const byId = id => {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
    };
    const auth = { user: null, ready: Promise.resolve(), sessionExpired() {} };
    const sandbox = {
        console, Intl, Promise, JSON, Number, encodeURIComponent,
        window: { APP_CONFIG: { BACKEND_API_URL: '' }, minuetAuth: auth },
        location: { origin: 'https://minuet.example' },
        document: {
            getElementById: byId,
            addEventListener() {},
            querySelector: () => ({ value: 'manage' }),
        },
        currentView: () => 'settings',
        // el("tag", props, ...children) -> a plain object that keeps its text so the test can look for the token.
        el: (tag, props, ...children) => ({ tag, text: children.flat().map(child => child && (child.text ?? child)).join(' ') }),
        fetch: async (url, options = {}) => {
            const reply = body => ({ ok: true, status: 200, json: async () => body });
            if (url === '/api/tokens' && options.method === 'POST') return reply({ id: 't1', name: 'Mine', token: `mnt_secret_of_${auth.user.userId}`, scopes: ['read'], createdAt: 1 });
            if (url === '/api/tokens') return reply({ tokens: [{ id: 't1', name: `token of ${auth.user.userId}`, scopes: ['read'], createdAt: 1 }] });
            if (url === '/api/history') return reply({ changes: [{ id: 'h1', at: 1, actor: 'x', summary: `change of ${auth.user.userId}`, items: [] }] });
            return reply({ timezone: 'Asia/Kolkata' });
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(readFileSync(new URL('../js/settings.js', import.meta.url), 'utf8') + '\nglobalThis.settingsView = settingsView;', sandbox);
    const pageText = () => JSON.stringify([...elements.values()].map(e => [e.children, e.value, e.textContent]));
    return { view: sandbox.settingsView, auth, byId, pageText };
}

test('A token left on screen, and the token and history lists, are gone once the user signs out', async () => {
    const { view, auth, byId, pageText } = loadSettings();
    auth.user = { userId: 'alice' };
    await view.load();
    byId('settings-token-name').value = 'Mine';
    await view.createToken();
    assert.strictEqual(byId('settings-new-token').hidden, false);
    assert.ok(pageText().includes('mnt_secret_of_alice') && pageText().includes('token of alice') && pageText().includes('change of alice'));

    // Looking at another tab and coming back as the same user keeps the token visible.
    await view.load();
    assert.ok(pageText().includes('mnt_secret_of_alice'));

    auth.user = null;
    await view.load();
    assert.strictEqual(byId('settings-new-token').hidden, true);
    assert.ok(!pageText().includes('alice'), 'nothing of the signed-out account may stay on the page');
});

test('Signing in as someone else in the same tab never shows the previous account\'s token', async () => {
    const { view, auth, pageText } = loadSettings();
    auth.user = { userId: 'alice' };
    await view.load();
    await view.createToken();
    // Session switched without an intermediate signed-out load (e.g. expired session, then a new sign-in).
    auth.user = { userId: 'bob' };
    await view.load();
    assert.ok(!pageText().includes('alice'));
    assert.ok(pageText().includes('token of bob'));
});

test('A token that finishes creating after the account changed is not shown', async () => {
    const { view, auth, byId, pageText } = loadSettings();
    auth.user = { userId: 'alice' };
    await view.load();
    const creating = view.createToken();
    view.shownFor = 'bob';   // the page now belongs to another account
    await creating;
    assert.strictEqual(byId('settings-new-token').children.length, 0);
    assert.ok(!pageText().includes('mnt_secret_of_alice'));
});
