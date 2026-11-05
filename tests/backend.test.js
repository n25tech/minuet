import test from 'node:test';
import assert from 'node:assert';
import { fetchTodoListForUser, saveTodoListForUser } from '../functions/api/_db_d1/todolist.js';
import { fetchNotesForUser, saveNotesForUser } from '../functions/api/_db_d1/notes.js';
import { createSession, getUserIdFromSession } from '../functions/api/_sessions_kv/sessions.js';
import * as todolistApi from '../functions/api/storage/todolist.js';
import * as notesApi from '../functions/api/storage/notes.js';
import * as sessionApi from '../functions/api/auth/session.js';
import { onRequest as middleware } from '../functions/api/_middleware.js';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// D1-compatible adapter over a real in-memory SQLite database with the app's migrations applied,
// so the production SQL (including the versioned upserts) is what gets exercised.
const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));

class SqliteD1Database {
    constructor() {
        this.sqlite = new DatabaseSync(':memory:');
        for (const file of readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()) {
            this.sqlite.exec(readFileSync(join(migrationsDir, file), 'utf8'));
        }
    }

    prepare(query) {
        return new SqliteD1PreparedStatement(this.sqlite.prepare(query));
    }

    addUser(userId, email = `${userId}@example.com`, name = null) {
        this.sqlite.prepare('INSERT INTO users (user_id, google_sub, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)')
            .run(userId, `sub-${userId}`, email, name);
    }
}

class SqliteD1PreparedStatement {
    constructor(statement) {
        this.statement = statement;
        this.bindParams = [];
    }

    bind(...params) {
        this.bindParams = params;
        return this;
    }

    async first() {
        return (await this.all()).results[0] ?? null;
    }

    async all() {
        return { results: this.statement.all(...this.bindParams).map(row => ({ ...row })), meta: {} };
    }

    async run() {
        const { changes } = this.statement.run(...this.bindParams);
        return { results: [], meta: { changes: Number(changes) } };
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
