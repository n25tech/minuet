export async function fetchTodoListForUser(db, userId) {
    const state = await db.prepare('SELECT list, version FROM todo_state WHERE user_id = ?').bind(userId).first();
    if (state) return { list: JSON.parse(state.list), version: state.version };
    // Preserve rows from the original schema on the first load.
    const { results } = await db.prepare('SELECT * FROM todolist WHERE user_id = ? AND deleted = 0 ORDER BY sort_order, id').bind(userId).all();
    return { list: results.map(item => ({ id: String(item.id), text: item.text, complete: !!item.complete })), version: 0 };
}
export async function saveTodoListForUser(db, userId, list, version) {
    // A version check prevents another device/tab's newer tasks being overwritten.
    const result = await db.prepare(`INSERT INTO todo_state (user_id, list, version)
        SELECT ?, ?, 1 WHERE ? = 0 OR EXISTS (SELECT 1 FROM todo_state WHERE user_id = ?)
        ON CONFLICT(user_id) DO UPDATE SET list = excluded.list, version = todo_state.version + 1
        WHERE todo_state.version = ?`).bind(userId, JSON.stringify(list), version, userId, version).run();
    return result.meta.changes === 1;
}
