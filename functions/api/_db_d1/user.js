

export async function getUserIdByEmail(db, email) {
    const { results } = await db.prepare(
        "SELECT * FROM users WHERE email = ?"
    ).bind(email).run();
    return results[0].user_id ?? null;
}

export async function createUser(db, { email, name, googleUserId }) {
    const user_id = crypto.randomUUID(); // Generate a unique user ID
    const result = await db.prepare(
        "INSERT INTO users (user_id, email, name, google_user_id) VALUES (?, ?, ?, ?) RETURNING id"
    ).bind(email, name, googleUserId).run();
    return result.results[0].user_id;
}
