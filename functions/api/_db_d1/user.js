

export async function getUserIdByEmail(db, email) {
    const { results } = await db.prepare(
        "SELECT * FROM users WHERE email = ?"
    ).bind(email).all();
    console.log(`getUserIdByEmail results: ${JSON.stringify(results)}`);
    if (results.length === 0) {
        console.log(`No user found with email: ${email}`);
        return null;
    }
    return results[0].user_id;
}

export async function createUser(db, { email, name, googleUserId }) {
    const user_id = crypto.randomUUID(); // Generate a unique user ID
    const timestamp = Math.floor(Date.now() / 1000); // Current timestamp in seconds
    try {
        const result = await db.prepare(
            "INSERT INTO users (user_id, email, name, google_sub, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING user_id"
        ).bind(user_id, email, name, googleUserId, timestamp, timestamp).run();
        return result.results[0].user_id;
    } catch (error) {
        console.error(`Error creating user: ${error}`);
        return null;
    }
}
