/*
 * Users are identified by Google's stable subject id (`sub`), never by email:
 * an email address can change or be reassigned to a different Google account.
 */

export async function getUserByGoogleSub(db, googleSub) {
    return db.prepare("SELECT user_id, email, name FROM users WHERE google_sub = ?").bind(googleSub).first();
}

export async function emailBelongsToOtherAccount(db, email, googleSub) {
    const row = await db.prepare("SELECT 1 AS taken FROM users WHERE email = ? AND google_sub != ?").bind(email, googleSub).first();
    return !!row;
}

export async function createUser(db, { email, name, googleSub }) {
    const userId = crypto.randomUUID();
    const timestamp = Math.floor(Date.now() / 1000);
    await db.prepare(
        "INSERT INTO users (user_id, email, name, google_sub, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(userId, email, name, googleSub, timestamp, timestamp).run();
    return userId;
}

// Keep the stored email/name current when they change on the Google account.
export async function updateUserProfile(db, userId, { email, name }) {
    const timestamp = Math.floor(Date.now() / 1000);
    await db.prepare("UPDATE users SET email = ?, name = ?, updated_at = ? WHERE user_id = ?")
        .bind(email, name, timestamp, userId).run();
}
