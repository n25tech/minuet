import test from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = file => readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');
const MARKER = '--- From another device ---';

// Runs the real browser scripts (sync.js + notes.js) in a sandbox with a fake DOM,
// localStorage and a scripted backend that follows the /api/storage/notes contract.
function loadNotes({ local, server, onPost, storage = new Map(), postStatus }) {
    const listeners = {};
    const textarea = {
        value: '',
        selectionStart: 0,
        selectionEnd: 0,
        addEventListener: (type, fn) => { listeners[type] = fn; },
        setSelectionRange() {},
    };
    if (local !== undefined) storage.set('notes', JSON.stringify(local));
    const auth = { user: { userId: 'user-1', email: 'me@example.com' }, ready: new Promise(() => {}), expired: 0 };
    auth.sessionExpired = () => { auth.expired++; auth.user = null; };
    const posts = [];
    const sandbox = {
        console, setTimeout, clearTimeout, structuredClone, Response, JSON,
        window: {
            APP_CONFIG: { BACKEND_API_URL: '' },
            minuetAuth: auth,
            addEventListener() {},
        },
        document: {
            getElementById: () => textarea,
            addEventListener() {},
            activeElement: null,
            visibilityState: 'visible',
        },
        localStorage: {
            getItem: key => storage.has(key) ? storage.get(key) : null,
            setItem: (key, value) => storage.set(key, String(value)),
            removeItem: key => storage.delete(key),
        },
        fetch: async (url, options = {}) => {
            if (options.method !== 'POST') return new Response(JSON.stringify(server));
            const body = JSON.parse(options.body);
            posts.push(body);
            onPost?.(body, posts.length);
            if (postStatus === 'network') throw new TypeError('Failed to fetch');
            if (postStatus) return new Response('{}', { status: postStatus });
            if (body.version !== server.version) return new Response(JSON.stringify(server), { status: 409 });
            server.content = body.content;
            server.version++;
            return new Response(JSON.stringify({ version: server.version }));
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(source('sync.js') + source('notes.js'), sandbox);
    const notes = vm.runInContext('notes', sandbox);
    return { notes, textarea, storage, posts, server, auth, type: text => { textarea.value = text; listeners.input(); } };
}

test('First sign-in upload that hits a conflict keeps the anonymous notes', async () => {
    const env = loadNotes({
        local: 'written while signed out',
        server: { content: '', version: 0 },
        // Another device saves between this device's GET and its upload.
        onPost: (_, n) => { if (n === 1) Object.assign(env.server, { content: 'other device', version: 1 }); },
    });
    await env.notes.doc.load();
    assert.ok(env.server.content.includes('written while signed out'), env.server.content);
    assert.ok(env.server.content.includes('other device'), env.server.content);
    assert.ok(env.server.content.includes(MARKER));
    assert.strictEqual(env.storage.has('notes'), false);
});

test('Anonymous notes stay in localStorage when the upload fails', async () => {
    const env = loadNotes({ local: 'keep me', server: { content: '', version: 0 } });
    env.server.version = Number.NaN; // every save is rejected as stale
    await env.notes.doc.load();
    assert.strictEqual(env.storage.get('notes'), JSON.stringify('keep me'));
});

test('Typing while a conflicting save is in flight is not lost', async () => {
    const env = loadNotes({
        server: { content: 'start', version: 1 },
        onPost: (_, n) => {
            if (n !== 1) return;
            env.type('A plus more typing');
            Object.assign(env.server, { content: 'other device', version: 2 });
        },
    });
    env.textarea.value = await env.notes.doc.load();
    env.type('A');
    await env.notes.flush();
    assert.ok(env.textarea.value.includes('A plus more typing'), env.textarea.value);
    assert.ok(env.textarea.value.includes('other device'), env.textarea.value);
    await env.notes.flush();
    assert.ok(env.server.content.includes('A plus more typing'), env.server.content);
    assert.ok(env.server.content.includes('other device'), env.server.content);
});

test('A signed-in edit that fails to reach the server is uploaded after a reload', async () => {
    const storage = new Map();
    const server = { content: 'start', version: 1 };
    const offline = loadNotes({ storage, server, postStatus: 'network' });
    offline.textarea.value = await offline.notes.doc.load();
    offline.type('edited offline');
    assert.strictEqual(await offline.notes.flush(), false);

    // Meanwhile another device saved, then this page is reloaded with the network back.
    Object.assign(server, { content: 'other device', version: 2 });
    const online = loadNotes({ storage, server });
    const loaded = await online.notes.doc.load();
    assert.ok(server.content.includes('edited offline'), server.content);
    assert.ok(server.content.includes('other device'), server.content);
    assert.strictEqual(loaded, server.content);
    assert.deepStrictEqual([...storage.keys()], []);
});

test('An expired session signs the user out and keeps the edit for the next sign-in', async () => {
    const storage = new Map();
    const server = { content: 'start', version: 1 };
    const expired = loadNotes({ storage, server, postStatus: 401 });
    expired.textarea.value = await expired.notes.doc.load();
    expired.type('typed after expiry');
    assert.strictEqual(await expired.notes.flush(), false);
    assert.strictEqual(expired.auth.expired, 1);
    assert.strictEqual(expired.auth.user, null);

    // Signing in as someone else on this device must not pick up the edit.
    const otherUser = loadNotes({ storage, server: { content: '', version: 0 } });
    otherUser.auth.user = { userId: 'user-2' };
    assert.strictEqual(await otherUser.notes.doc.load(), '');

    const again = loadNotes({ storage, server });
    assert.strictEqual(await again.notes.doc.load(), 'typed after expiry');
    assert.deepStrictEqual(server, { content: 'typed after expiry', version: 2 });
});
