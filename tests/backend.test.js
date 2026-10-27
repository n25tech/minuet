import test from 'node:test';
import assert from 'node:assert';
import { fetchTodoListForUser, saveTodoListForUser } from '../functions/api/_db_d1/todolist.js';
import { createSession, getUserIdFromSession } from '../functions/api/_sessions_kv/sessions.js';

// Simple mock D1 database implementation for tests
class MockD1Database {
    constructor() {
        this.tables = {
            users: new Map(),
            todo_state: new Map(),
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
        if (this.query.includes('INSERT INTO todo_state')) {
            const userId = this.bindParams[0];
            const list = this.bindParams[1];
            const version = this.bindParams[2] || 0;
            
            const existing = this.db.tables.todo_state.get(userId);
            if (version === 0 || existing) {
                const newVersion = existing ? existing.version + 1 : 1;
                this.db.tables.todo_state.set(userId, { user_id: userId, list, version: newVersion });
                return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
        }
        return { meta: { changes: 1 } };
    }

    async all() {
        if (this.query.includes('FROM todo_state')) {
            const userId = this.bindParams[0];
            const state = this.db.tables.todo_state.get(userId);
            return { results: state ? [state] : [] };
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
