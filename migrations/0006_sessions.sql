-- Sign-in sessions, moved here from the KV namespace: KV is eventually consistent, so a request
-- reaching another data centre shortly after sign-in could miss the new session and sign the
-- user out. Only a SHA-256 hash of the session id (the cookie value) is stored.
-- expires_at slides forward as the session is used (see functions/api/_lib/sessions.js).
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
