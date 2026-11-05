const SESSION_COOKIE = "minuet_session";

// SameSite=Lax: the app and API share an origin, so the cookie never needs to be sent on
// cross-site requests; this keeps other sites from making requests with the user's session.
export function sessionCookie(sessionId, maxAge) {
    return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function getSessionId(request) {
    const cookieHeader = request.headers.get("Cookie");
    if (!cookieHeader) return null;
    const matches = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]*)`));
    return matches ? decodeURIComponent(matches[1]) : null;
}

export async function createSession(context, userId) {
    const ttl = 604800; // 7 days in seconds; KV expires the entry
    const sessionId = crypto.randomUUID();
    await context.env.sessions.put(sessionId, JSON.stringify({ userId }), { expirationTtl: ttl });
    return { sessionId, ttl };
}

export async function getUserIdFromSession(context) {
    const sessionId = getSessionId(context.request);
    if (!sessionId) return null;
    const sessionData = await context.env.sessions.get(sessionId);
    if (!sessionData) return null;
    return JSON.parse(sessionData).userId;
}
