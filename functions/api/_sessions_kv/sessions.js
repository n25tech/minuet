
export async function createSession(context, userId) {
    const ttl = 604800; // 7 days in seconds
    const sessionId = crypto.randomUUID(); // Generate a unique session ID
    const sessionData = {
        userId: userId,
        expires: Date.now() + (ttl * 1000) // Session expires in 7 days
    };

    // Store the session data in KV
    await context.env.sessions.put(sessionId, JSON.stringify(sessionData), { expirationTtl: ttl });

    return { sessionId, ttl };
}