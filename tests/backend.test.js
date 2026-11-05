import test from 'node:test';
import assert from 'node:assert';
import { fetchTodoListForUser, saveTodoListForUser } from '../functions/api/_db_d1/todolist.js';
import { fetchNotesForUser, saveNotesForUser } from '../functions/api/_db_d1/notes.js';
import { createSession, getUserIdFromSession } from '../functions/api/_sessions_kv/sessions.js';
import * as todolistApi from '../functions/api/storage/todolist.js';
import * as notesApi from '../functions/api/storage/notes.js';
import * as sessionApi from '../functions/api/auth/session.js';
import { onRequest as middleware } from '../functions/api/_middleware.js';

// Simple mock D1 database implementation for tests
class MockD1Database {
    constructor() {
        this.tables = {
            users: new Map(),
            todo_state: new Map(),
            notes_state: new Map(),
            todolist: []
        };
    }

    prepare(query) {
        return new MockD1PreparedStatement(this, query);
    }
}

class MockD1PreparedStatement {
    constructor(db, query) {
        this.db = db;
        this.query = query;
        this.bindParams = [];
    }

    bind(...params) {
        this.bindParams = params;
        return this;
    }

    async first() {
        const results = await this.all();
        return results.results[0] || null;
    }

    async run() {
        // Mirrors the versioned upsert: insert only when version is 0 or a row exists,
        // update only when the stored version matches.
        const table = ['todo_state', 'notes_state'].find(t => this.query.includes(`INSERT INTO ${t}`));
        if (table) {
            const [userId, value, version] = this.bindParams;
            const existing = this.db.tables[table].get(userId);
            const valueKey = table === 'todo_state' ? 'list' : 'content';
            const insertAllowed = version === 0 || !!existing;
            if (!insertAllowed) return { meta: { changes: 0 } };
            if (existing && existing.version !== version) return { meta: { changes: 0 } };
            const newVersion = existing ? existing.version + 1 : 1;
            this.db.tables[table].set(userId, { user_id: userId, [valueKey]: value, version: newVersion });
            return { meta: { changes: 1 } };
        }
        return { meta: { changes: 1 } };
    }

    async all() {
        if (this.query.includes('FROM todo_state')) {
            const userId = this.bindParams[0];
            const state = this.db.tables.todo_state.get(userId);
            return { results: state ? [state] : [] };
        }
        if (this.query.includes('FROM notes_state')) {
            const state = this.db.tables.notes_state.get(this.bindParams[0]);
            return { results: state ? [state] : [] };
        }
        if (this.query.includes('FROM users')) {
            const user = this.db.tables.users.get(this.bindParams[0]);
            return { results: user ? [user] : [] };
        }
        if (this.query.includes('FROM todolist')) {
            return { results: [] };
        }
        return { results: [] };
    }
}

// Simple mock KV namespace implementation for tests
class MockKVNamespace {
    constructor() {
        this.store = new Map();
    }

    async put(key, value, options) {
        this.store.set(key, value);
    }

    async get(key) {
        return this.store.get(key) || null;
    }

    async delete(key) {
        this.store.delete(key);
    }
}

test('TodoList backend storage and retrieval', async () => {
    const db = new MockD1Database();
    const userId = 'user-123';
    
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

test('Session creation and retrieval', async () => {
    const kv = new MockKVNamespace();
    const context = {
        env: { sessions: kv }
    };
    const userId = 'user-abc';

    const { sessionId } = await createSession(context, userId);
    assert.ok(sessionId);

    const reqContext = {
        request: new Request('http://localhost/api/storage/todolist', {
            headers: {
                'Cookie': `minuet_session=${sessionId}`
            }
        }),
        env: { sessions: kv }
    };

    const retrievedUserId = await getUserIdFromSession(reqContext);
    assert.strictEqual(retrievedUserId, userId);
});

test('TodoList save is rejected when based on a stale version', async () => {
    const db = new MockD1Database();
    assert.strictEqual(await saveTodoListForUser(db, 'u', [{ id: 'a' }], 0), true);
    assert.strictEqual(await saveTodoListForUser(db, 'u', [{ id: 'b' }], 1), true);
    // A second device still on version 1 must not overwrite version 2.
    assert.strictEqual(await saveTodoListForUser(db, 'u', [{ id: 'c' }], 1), false);
    assert.deepStrictEqual((await fetchTodoListForUser(db, 'u')).list, [{ id: 'b' }]);
});

test('Notes storage and versioning', async () => {
    const db = new MockD1Database();
    assert.deepStrictEqual(await fetchNotesForUser(db, 'u'), { content: '', version: 0 });
    assert.strictEqual(await saveNotesForUser(db, 'u', 'hello', 0), true);
    assert.strictEqual(await saveNotesForUser(db, 'u', 'stale', 0), false);
    assert.deepStrictEqual(await fetchNotesForUser(db, 'u'), { content: 'hello', version: 1 });
});

async function makeEnv(userId) {
    const env = { db: new MockD1Database(), sessions: new MockKVNamespace() };
    if (!userId) return { env, cookie: '' };
    env.db.tables.users.set(userId, { user_id: userId, email: 'me@example.com', name: 'Me' });
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
    for (const api of [todolistApi, notesApi]) {
        assert.strictEqual((await api.onRequestGet(ctx(env))).status, 401);
        assert.strictEqual((await api.onRequestPost(ctx(env, '', 'POST', { list: [], content: '' }))).status, 401);
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
    assert.strictEqual((await runMiddleware('POST', 'http://localhost:3000')).reached, true);
    // e.g. a Pages preview deployment talking to itself
    assert.strictEqual((await runMiddleware('POST', 'https://abc.minuet.pages.dev', 'https://abc.minuet.pages.dev/api/auth/callback')).reached, true);
    assert.strictEqual((await runMiddleware('POST', null)).reached, true);
    assert.strictEqual((await runMiddleware('GET', 'https://evil.example')).reached, true);
});
