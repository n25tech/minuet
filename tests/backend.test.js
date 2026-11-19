import test from 'node:test';
import assert from 'node:assert';
import { fetchTodoListForUser, saveTodoListForUser } from '../functions/api/_db_d1/todolist.js';
import { fetchNotesForUser, saveNotesForUser } from '../functions/api/_db_d1/notes.js';
import { createSession, getUserIdFromSession, renewSession } from '../functions/api/_lib/sessions.js';
import * as todolistApi from '../functions/api/storage/todolist.js';
import * as notesApi from '../functions/api/storage/notes.js';
import * as notebookApi from '../functions/api/storage/notebook.js';
import * as calendarApi from '../functions/api/storage/calendar.js';
import * as sessionApi from '../functions/api/auth/session.js';
import { onRequest as middleware } from '../functions/api/_middleware.js';
import * as callbackApi from '../functions/api/auth/callback.js';

import { SqliteD1Database, MockKVNamespace } from './helpers/d1.js';

test('TodoList backend storage and retrieval', async () => {
    const db = new SqliteD1Database();
    const userId = 'user-123';
    db.addUser(userId);
    
    // Initial fetch should be empty
    const initial = await fetchTodoListForUser(db, userId);
    assert.deepStrictEqual(initial.list, []);

    // Save todo list
    const newList = [{ id: '1', text: 'Test Task', complete: false }];
    const saved = await saveTodoListForUser(db, userId, newList, 0);
    assert.strictEqual(saved, true);

    // Fetch back
    const fetched = await fetchTodoListForUser(db, userId);
    assert.deepStrictEqual(fetched.list, newList);
});

const cookieRequest = cookie => new Request('http://localhost/api/storage/todolist', { headers: cookie ? { Cookie: cookie } : {} });
const DAY = 24 * 60 * 60 * 1000;

test('Session creation and retrieval', async () => {
    const env = { db: new SqliteD1Database(), sessions: new MockKVNamespace() };
    env.db.addUser('user-abc');
    const { sessionId, ttl } = await createSession({ env }, 'user-abc');
    assert.ok(sessionId);
    assert.strictEqual(ttl, 14 * 24 * 60 * 60);
    const userId = await getUserIdFromSession({ env, request: cookieRequest(`minuet_session=${sessionId}`) });
    assert.strictEqual(userId, 'user-abc');
    // Only a hash of the cookie value is stored.
    const ids = env.db.sqlite.prepare('SELECT id FROM sessions').all().map(row => row.id);
    assert.strictEqual(ids.length, 1);
    assert.notStrictEqual(ids[0], sessionId);
});

test('A session lasts 14 days from its last use, and each page load extends it', async () => {
    const env = { db: new SqliteD1Database() };
    env.db.addUser('u');
    const start = 1_000 * DAY;
    const { sessionId } = await createSession({ env }, 'u', start);
    const request = cookieRequest(`minuet_session=${sessionId}`);

    // Used every 10 days for two months: never signed out.
    let now = start;
    for (let i = 0; i < 6; i++) {
        now += 10 * DAY;
        const { userId, cookie } = await renewSession({ env, request }, now);
        assert.strictEqual(userId, 'u');
        assert.match(cookie, new RegExp(`Max-Age=${14 * 24 * 60 * 60}`));
    }
    // Then left alone for 15 days: signed out, and the row is gone.
    now += 15 * DAY;
    assert.strictEqual(await getUserIdFromSession({ env, request }, now), null);
    assert.deepStrictEqual((await renewSession({ env, request }, now)).userId, null);
    assert.strictEqual(env.db.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
});

test('Plain API requests check the session without extending it', async () => {
    const env = { db: new SqliteD1Database() };
    env.db.addUser('u');
    const { sessionId } = await createSession({ env }, 'u', 0);
    const request = cookieRequest(`minuet_session=${sessionId}`);
    assert.strictEqual(await getUserIdFromSession({ env, request }, 13 * DAY), 'u');
    assert.strictEqual(await getUserIdFromSession({ env, request }, 14 * DAY + 1), null);
});

test('A session made before the move to D1 keeps working and is moved out of KV', async () => {
    const env = { db: new SqliteD1Database(), sessions: new MockKVNamespace() };
    env.db.addUser('u');
    await env.sessions.put('old-session', JSON.stringify({ userId: 'u' }));
    const request = cookieRequest('minuet_session=old-session');
    const { userId, cookie } = await renewSession({ env, request });
    assert.strictEqual(userId, 'u');
    assert.match(cookie, /^minuet_session=old-session;/);
    assert.strictEqual(await env.sessions.get('old-session'), null);
    assert.strictEqual(await getUserIdFromSession({ env, request }), 'u');
});

test('Signing out ends the session', async () => {
    const env = { db: new SqliteD1Database(), sessions: new MockKVNamespace() };
    env.db.addUser('u');
    const { sessionId } = await createSession({ env }, 'u');
    const request = cookieRequest(`minuet_session=${sessionId}`);
    const res = await sessionApi.onRequestDelete({ env, request });
    assert.match(res.headers.get('Set-Cookie'), /Max-Age=0/);
    assert.strictEqual(await getUserIdFromSession({ env, request }), null);
});

test('TodoList save is rejected when based on a stale version', async () => {
    const db = new SqliteD1Database();
    db.addUser('u');
    assert.strictEqual(await saveTodoListForUser(db, 'u', [{ id: 'a' }], 0), true);
    assert.strictEqual(await saveTodoListForUser(db, 'u', [{ id: 'b' }], 1), true);
    // A second device still on version 1 must not overwrite version 2.
    assert.strictEqual(await saveTodoListForUser(db, 'u', [{ id: 'c' }], 1), false);
    assert.deepStrictEqual((await fetchTodoListForUser(db, 'u')).list, [{ id: 'b' }]);
});

test('Notes storage and versioning', async () => {
    const db = new SqliteD1Database();
    db.addUser('u');
    assert.deepStrictEqual(await fetchNotesForUser(db, 'u'), { content: '', version: 0 });
    assert.strictEqual(await saveNotesForUser(db, 'u', 'hello', 0), true);
    assert.strictEqual(await saveNotesForUser(db, 'u', 'stale', 0), false);
    assert.deepStrictEqual(await fetchNotesForUser(db, 'u'), { content: 'hello', version: 1 });
});

async function makeEnv(userId) {
    const env = { db: new SqliteD1Database(), sessions: new MockKVNamespace() };
    if (!userId) return { env, cookie: '' };
    env.db.addUser(userId, 'me@example.com', 'Me');
    const { sessionId } = await createSession({ env }, userId);
    return { env, cookie: `minuet_session=${sessionId}` };
}

function ctx(env, cookie, method = 'GET', body) {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    return { env, request: new Request('http://localhost/api', { method, headers, body: body && JSON.stringify(body) }) };
}

test('Storage endpoints require a session', async () => {
    const { env } = await makeEnv(null);
    for (const api of [todolistApi, notesApi, notebookApi, calendarApi]) {
        assert.strictEqual((await api.onRequestGet(ctx(env))).status, 401);
        assert.strictEqual((await api.onRequestPost(ctx(env, '', 'POST', { list: [], content: '', notes: [], events: [] }))).status, 401);
    }
});

test('Two devices sync notes through the API, conflicts return 409 with server state', async () => {
    const { env, cookie } = await makeEnv('user-1');
    // Device A saves.
    let res = await notesApi.onRequestPost(ctx(env, cookie, 'POST', { content: 'from A', version: 0 }));
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { version: 1 });
    // Device B (separate session for the same user) sees it.
    const { sessionId } = await createSession({ env }, 'user-1');
    const cookieB = `minuet_session=${sessionId}`;
    res = await notesApi.onRequestGet(ctx(env, cookieB));
    assert.deepStrictEqual(await res.json(), { content: 'from A', version: 1 });
    // Device A, unaware, saves on top of version 1 after B already saved version 2.
    await notesApi.onRequestPost(ctx(env, cookieB, 'POST', { content: 'from B', version: 1 }));
    res = await notesApi.onRequestPost(ctx(env, cookie, 'POST', { content: 'A again', version: 1 }));
    assert.strictEqual(res.status, 409);
    assert.deepStrictEqual(await res.json(), { content: 'from B', version: 2 });
});

test('Todo endpoint rejects a non-array list', async () => {
    const { env, cookie } = await makeEnv('user-1');
    const res = await todolistApi.onRequestPost(ctx(env, cookie, 'POST', { list: 'nope', version: 0 }));
    assert.strictEqual(res.status, 400);
});

test('Session endpoint returns the signed-in email', async () => {
    const { env, cookie } = await makeEnv('user-1');
    const res = await sessionApi.onRequestGet(ctx(env, cookie));
    assert.deepStrictEqual(await res.json(), { userId: 'user-1', name: 'Me', email: 'me@example.com' });
    const anon = await sessionApi.onRequestGet(ctx(env, ''));
    assert.deepStrictEqual(await anon.json(), { userId: null });
});

test('Storage POST rejects non-JSON bodies (cross-site form CSRF)', async () => {
    const { env, cookie } = await makeEnv('user-1');
    // What <form enctype="text/plain"> can produce: a JSON-looking body without a preflight.
    const request = new Request('http://localhost/api/storage/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', Cookie: cookie },
        body: '{"content":"pwned","version":0,"x":"="}',
    });
    const res = await notesApi.onRequestPost({ env, request });
    assert.strictEqual(res.status, 415);
    assert.deepStrictEqual(await (await notesApi.onRequestGet(ctx(env, cookie))).json(), { content: '', version: 0 });
});

test('Storage POST rejects oversized documents', async () => {
    const { env, cookie } = await makeEnv('user-1');
    const res = await notesApi.onRequestPost(ctx(env, cookie, 'POST', { content: 'x'.repeat(300 * 1024), version: 0 }));
    assert.strictEqual(res.status, 413);
});

function runMiddleware(method, origin, url = 'https://minuet.n25tech.com/api/storage/notes') {
    const headers = origin ? { Origin: origin } : {};
    let reached = false;
    const next = async () => { reached = true; return new Response('ok'); };
    return middleware[0]({ request: new Request(url, { method, headers }), next }).then(res => ({ res, reached }));
}

test('Middleware blocks state-changing requests from foreign origins', async () => {
    for (const method of ['POST', 'DELETE']) {
        const { res, reached } = await runMiddleware(method, 'https://evil.example');
        assert.strictEqual(res.status, 403);
        assert.strictEqual(reached, false);
    }
    const nullOrigin = await runMiddleware('POST', 'null');
    assert.strictEqual(nullOrigin.res.status, 403);
});

test('Middleware allows trusted, same-origin, origin-less and safe requests', async () => {
    assert.strictEqual((await runMiddleware('POST', 'https://minuet.n25tech.com')).reached, true);
    // Local development: the app on localhost talking to the API on localhost
    assert.strictEqual((await runMiddleware('POST', 'http://localhost:3000', 'http://localhost:8788/api/storage/notes')).reached, true);
    // e.g. a Pages preview deployment talking to itself
    assert.strictEqual((await runMiddleware('POST', 'https://abc.minuet.pages.dev', 'https://abc.minuet.pages.dev/api/auth/callback')).reached, true);
    assert.strictEqual((await runMiddleware('POST', null)).reached, true);
    assert.strictEqual((await runMiddleware('GET', 'https://evil.example')).reached, true);
});

test('Production does not trust localhost origins (any local dev server could otherwise use the session)', async () => {
    const write = await runMiddleware('POST', 'http://localhost:3000');
    assert.strictEqual(write.res.status, 403);
    assert.strictEqual(write.reached, false);
    // Reads aren't blocked server-side, but the browser must not be allowed to expose the response.
    const read = await runMiddleware('GET', 'http://localhost:3000');
    assert.notStrictEqual(read.res.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3000');
    const own = await runMiddleware('GET', 'https://minuet.n25tech.com');
    assert.strictEqual(own.res.headers.get('Access-Control-Allow-Origin'), 'https://minuet.n25tech.com');
});

// --- Google sign-in callback ---------------------------------------------------------------

const CLIENT_ID = 'test-client.apps.googleusercontent.com';

// Stub Google's tokeninfo endpoint: the "token" string is a JSON blob of the claims to return.
async function signIn(env, claims) {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        assert.ok(String(url).startsWith('https://oauth2.googleapis.com/tokeninfo?id_token='));
        const token = decodeURIComponent(String(url).split('id_token=')[1]);
        return Response.json({ aud: CLIENT_ID, email_verified: 'true', ...JSON.parse(token) });
    };
    try {
        const body = new URLSearchParams({ credential: JSON.stringify(claims) });
        const request = new Request('https://minuet.n25tech.com/api/auth/callback', { method: 'POST', body });
        const res = await callbackApi.onRequestPost({ env: { ...env, GOOGLE_CLIENT_ID: CLIENT_ID }, request });
        return { res, data: res.ok ? await res.json() : await res.text() };
    } finally {
        globalThis.fetch = realFetch;
    }
}

function usersRows(env) {
    return env.db.sqlite.prepare('SELECT user_id, google_sub, email, name FROM users ORDER BY created_at, user_id').all().map(r => ({ ...r }));
}

test('Sign-in sets a SameSite=Lax session cookie', async () => {
    const { env } = await makeEnv(null);
    const { res } = await signIn(env, { sub: 'g-1', email: 'a@example.com', name: 'A' });
    assert.strictEqual(res.status, 201);
    const cookie = res.headers.get('Set-Cookie');
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
});

test('Accounts are matched by Google sub: an email change keeps the same account', async () => {
    const { env } = await makeEnv(null);
    const first = await signIn(env, { sub: 'g-1', email: 'old@example.com', name: 'A' });
    const second = await signIn(env, { sub: 'g-1', email: 'new@example.com', name: 'A' });
    assert.strictEqual(second.res.status, 200);
    assert.strictEqual(second.data.userId, first.data.userId);
    assert.deepStrictEqual(usersRows(env).map(r => r.email), ['new@example.com']);
});

test('A different Google account with a reassigned email cannot take over the old account', async () => {
    const { env } = await makeEnv(null);
    const owner = await signIn(env, { sub: 'g-owner', email: 'shared@example.com', name: 'Owner' });
    const intruder = await signIn(env, { sub: 'g-new', email: 'shared@example.com', name: 'New' });
    assert.strictEqual(intruder.res.status, 409);
    assert.strictEqual(intruder.res.headers.get('Set-Cookie'), null);
    const rows = usersRows(env);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].user_id, owner.data.userId);
    assert.strictEqual(rows[0].google_sub, 'g-owner');
});

test('Sign-in rejects tokens for another app or with an unverified email', async () => {
    const { env } = await makeEnv(null);
    assert.strictEqual((await signIn(env, { sub: 'g-1', email: 'a@example.com', aud: 'other-app' })).res.status, 401);
    assert.strictEqual((await signIn(env, { sub: 'g-1', email: 'a@example.com', email_verified: 'false' })).res.status, 401);
    assert.deepStrictEqual(usersRows(env), []);
});

test('Todo list loads empty for a user with no saved state', async () => {
    const { env, cookie } = await makeEnv('user-1');
    const res = await todolistApi.onRequestGet(ctx(env, cookie));
    assert.deepStrictEqual(await res.json(), { list: [], version: 0 });
});

test('Notebook and calendar lists are stored per user, versioned, and conflict with 409', async () => {
    const { env, cookie } = await makeEnv('user-1');
    env.db.addUser('user-2');
    const { sessionId } = await createSession({ env }, 'user-2');
    const otherCookie = `minuet_session=${sessionId}`;
    for (const [api, field] of [[notebookApi, 'notes'], [calendarApi, 'events']]) {
        assert.deepStrictEqual(await (await api.onRequestGet(ctx(env, cookie))).json(), { [field]: [], version: 0 });
        const items = [{ id: 'a', title: 'First', updatedAt: 1 }];
        let res = await api.onRequestPost(ctx(env, cookie, 'POST', { [field]: items, version: 0 }));
        assert.deepStrictEqual(await res.json(), { version: 1 });
        assert.deepStrictEqual(await (await api.onRequestGet(ctx(env, cookie))).json(), { [field]: items, version: 1 });
        // A save based on a stale version is refused and answered with the server's state.
        res = await api.onRequestPost(ctx(env, cookie, 'POST', { [field]: [], version: 0 }));
        assert.strictEqual(res.status, 409);
        assert.deepStrictEqual(await res.json(), { [field]: items, version: 1 });
        // Another user sees none of it.
        assert.deepStrictEqual(await (await api.onRequestGet(ctx(env, otherCookie))).json(), { [field]: [], version: 0 });
    }
});

test('Notebook and calendar reject lists whose items have no string id', async () => {
    const { env, cookie } = await makeEnv('user-1');
    for (const [api, field] of [[notebookApi, 'notes'], [calendarApi, 'events']]) {
        for (const bad of ['nope', [null], ['text'], [{ title: 'no id' }], [{ id: 7 }]]) {
            const res = await api.onRequestPost(ctx(env, cookie, 'POST', { [field]: bad, version: 0 }));
            assert.strictEqual(res.status, 400);
        }
    }
});

test('Notebook accepts documents larger than the default limit, up to its own', async () => {
    const { env, cookie } = await makeEnv('user-1');
    const big = [{ id: 'a', text: 'x'.repeat(300 * 1024) }];
    assert.strictEqual((await notebookApi.onRequestPost(ctx(env, cookie, 'POST', { notes: big, version: 0 }))).status, 200);
    assert.strictEqual((await calendarApi.onRequestPost(ctx(env, cookie, 'POST', { events: big, version: 0 }))).status, 413);
    const huge = [{ id: 'a', text: 'x'.repeat(1100 * 1024) }];
    assert.strictEqual((await notebookApi.onRequestPost(ctx(env, cookie, 'POST', { notes: huge, version: 1 }))).status, 413);
});
