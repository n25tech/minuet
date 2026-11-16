// A per-user JSON list stored as one versioned row: `table` has (user_id, <column>, version).
// `table` and `column` are constants chosen in code, never request input.
// Writes only apply when the caller saw the latest version, so devices can't silently clobber each other.
export function jsonListStore(table, column) {
    return {
        async fetch(db, userId) {
            const state = await db.prepare(`SELECT ${column} AS doc, version FROM ${table} WHERE user_id = ?`).bind(userId).first();
            return state ? { [column]: JSON.parse(state.doc), version: state.version } : { [column]: [], version: 0 };
        },
        async save(db, userId, list, version = 0) {
            const result = await db.prepare(`INSERT INTO ${table} (user_id, ${column}, version)
                SELECT ?, ?, 1 WHERE ? = 0 OR EXISTS (SELECT 1 FROM ${table} WHERE user_id = ?)
                ON CONFLICT(user_id) DO UPDATE SET ${column} = excluded.${column}, version = ${table}.version + 1
                WHERE ${table}.version = ?`).bind(userId, JSON.stringify(list), version, userId, version).run();
            return result.meta.changes === 1;
        },
    };
}

// Every stored item is an object with a string id (the client merges lists by id).
export const isItemList = list => Array.isArray(list)
    && list.every(item => item && typeof item === 'object' && typeof item.id === 'string' && item.id.length <= 64);
