-- Keep-style notes and calendar events, each stored as one versioned JSON document per user
-- (same optimistic-concurrency scheme as todo_state / notes_state).
CREATE TABLE IF NOT EXISTS notebook_state (
    user_id TEXT PRIMARY KEY REFERENCES users(user_id),
    notes TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS calendar_state (
    user_id TEXT PRIMARY KEY REFERENCES users(user_id),
    events TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0
);
