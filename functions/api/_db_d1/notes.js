export async function fetchNotesForUser(db, userId) {
    const state = await db.prepare('SELECT content, version FROM notes_state WHERE user_id = ?').bind(userId).first();
    return state ? { content: state.content, version: state.version } : { content: '', version: 0 };
}

// Same optimistic-concurrency scheme as the todo list: the write only applies
// when the caller saw the latest version, so devices can't silently clobber each other.
export async function saveNotesForUser(db, userId, content, version = 0) {
    const result = await db.prepare(`INSERT INTO notes_state (user_id, content, version)
        SELECT ?, ?, 1 WHERE ? = 0 OR EXISTS (SELECT 1 FROM notes_state WHERE user_id = ?)
        ON CONFLICT(user_id) DO UPDATE SET content = excluded.content, version = notes_state.version + 1
        WHERE notes_state.version = ?`).bind(userId, content, version, userId, version).run();
    return result.meta.changes === 1;
}
