
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

export async function getUserIdFromSession(context) {
    const name = "minuet_session";
    const {request} = context;
    const cookieHeader = request.headers.get("Cookie");
    console.log(cookieHeader);
    const matches = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    const sessionId = matches ? decodeURIComponent(matches[1]) : null;   
    const sessionData = await context.env.sessions.get(sessionId);
    if (!sessionData) {
        return null;
    }
    const {userId, expires} = JSON.parse(sessionData);
    return userId;
}