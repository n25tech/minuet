CREATE TABLE IF NOT EXISTS notes_state (
    user_id TEXT PRIMARY KEY REFERENCES users(user_id),
    content TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0
);
