CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY, google_sub TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL, name TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS todolist (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
    text TEXT NOT NULL, sort_order INTEGER, complete INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, deleted_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_todolist_user_id ON todolist(user_id);
CREATE TABLE IF NOT EXISTS todo_state (
    user_id TEXT PRIMARY KEY REFERENCES users(user_id),
    list TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0
);
