import test from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = file => readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');
const MARKER = '--- From another device ---';

// Runs the real browser scripts (sync.js + notes.js) in a sandbox with a fake DOM,
// localStorage and a scripted backend that follows the /api/storage/notes contract.
function loadNotes({ local, server, onPost }) {
    const listeners = {};
    const textarea = {
        value: '',
        selectionStart: 0,
        selectionEnd: 0,
        addEventListener: (type, fn) => { listeners[type] = fn; },
        setSelectionRange() {},
    };
    const storage = new Map(local === undefined ? [] : [['notes', JSON.stringify(local)]]);
    const posts = [];
    const sandbox = {
        console, setTimeout, clearTimeout, structuredClone, Response, JSON,
        window: {
            APP_CONFIG: { BACKEND_API_URL: '' },
            minuetAuth: { user: { email: 'me@example.com' }, ready: new Promise(() => {}) },
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
            if (body.version !== server.version) return new Response(JSON.stringify(server), { status: 409 });
            server.content = body.content;
            server.version++;
            return new Response(JSON.stringify({ version: server.version }));
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(source('sync.js') + source('notes.js'), sandbox);
    const notes = vm.runInContext('notes', sandbox);
    return { notes, textarea, storage, posts, server, type: text => { textarea.value = text; listeners.input(); } };
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
