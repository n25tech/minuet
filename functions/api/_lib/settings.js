export function isTimeZone(value) {
    if (typeof value !== 'string' || !value || value.length > 64) return false;
    try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
    } catch {
        return false;
    }
}

export async function getSettings(db, userId) {
    const row = await db.prepare('SELECT timezone FROM user_settings WHERE user_id = ?').bind(userId).first();
    return { timezone: row ? row.timezone : null };
}

export async function saveTimezone(db, userId, timezone) {
    await db.prepare(`INSERT INTO user_settings (user_id, timezone) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET timezone = excluded.timezone`).bind(userId, timezone).run();
}

/* The wall-clock time in a zone as "YYYY-MM-DDTHH:MM" - the format every date in Minuet is stored in. */
export function localNow(timezone, date = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone || 'UTC', hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
