import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// D1-compatible adapter over a real in-memory SQLite database with the app's migrations applied,
// so the production SQL (including the versioned upserts) is what gets exercised.
const migrationsDir = fileURLToPath(new URL('../../migrations/', import.meta.url));

export class SqliteD1Database {
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
export class MockKVNamespace {
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
