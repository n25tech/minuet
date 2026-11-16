-- Personal access tokens for programs acting on the user's behalf (the MCP server).
-- Only a SHA-256 hash of the token is stored; scopes is a comma-separated list of read, suggest, manage.
CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id),
    name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, scopes TEXT NOT NULL,
    created_at INTEGER NOT NULL, expires_at INTEGER, last_used_at INTEGER, revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);

-- What was changed through a token, with each item's state before and after so it can be undone.
-- changes is a JSON list of { kind: "note" | "event", id, before, after } (null = didn't exist).
CREATE TABLE IF NOT EXISTS history (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id),
    at INTEGER NOT NULL, actor TEXT NOT NULL, summary TEXT NOT NULL,
    changes TEXT NOT NULL, undone_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_history_user_at ON history(user_id, at);

CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(user_id),
    timezone TEXT
);
