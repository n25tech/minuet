/*
 * Sign-in sessions. The cookie holds a random session id; D1 holds only its SHA-256 hash, the user
 * and when it expires. A session lasts SESSION_DAYS from its last use: each page load calls
 * GET /api/auth/session, which slides the expiry forward (at most once a day) and re-sends the cookie,
 * so someone who opens Minuet at least once every two weeks stays signed in.
 *
 * Sessions used to live in the "sessions" KV namespace. KV is eventually consistent, so a request
 * reaching another data centre soon after sign-in could miss the session and sign the user out.
 * A session still found only in KV is moved into D1 the first time it's used.
 */
const SESSION_COOKIE = "minuet_session";
const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_DAYS = 14;
const SESSION_MS = SESSION_DAYS * DAY_MS;
const RENEW_AFTER_MS = DAY_MS;   // don't rewrite the row on every request

// SameSite=Lax: the app and API share an origin, so the cookie never needs to be sent on
// cross-site requests; this keeps other sites from making requests with the user's session.
export function sessionCookie(sessionId, maxAgeSeconds) {
    return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function getSessionId(request) {
    const cookieHeader = request.headers.get("Cookie");
    if (!cookieHeader) return null;
    const matches = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]*)`));
    return matches ? decodeURIComponent(matches[1]) : null;
}

async function sha256Hex(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function createSession(context, userId, now = Date.now()) {
    const { db } = context.env;
    const sessionId = crypto.randomUUID();
    // Housekeeping: drop sessions that ran out (cheap, thanks to the expires_at index).
    await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();
    await db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
        .bind(await sha256Hex(sessionId), userId, now, now + SESSION_MS).run();
    return { sessionId, ttl: SESSION_MS / 1000 };
}

/* The session behind this request: { sessionId, id (hash), userId, expiresAt }, or null. */
async function findSession(context, now) {
    const sessionId = getSessionId(context.request);
    if (!sessionId) return null;
    const { db, sessions: kv } = context.env;
    const id = await sha256Hex(sessionId);
    const row = await db.prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?").bind(id).first();
    if (row) {
        if (row.expires_at > now) return { sessionId, id, userId: row.user_id, expiresAt: row.expires_at };
        await db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
        return null;
    }
    // A session created before the move to D1.
    const legacy = kv ? await kv.get(sessionId) : null;
    if (!legacy) return null;
    const { userId } = JSON.parse(legacy);
    const user = await db.prepare("SELECT 1 FROM users WHERE user_id = ?").bind(userId).first();
    if (!user) return null;
    const expiresAt = now + SESSION_MS;
    await db.prepare("INSERT OR IGNORE INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
        .bind(id, userId, now, expiresAt).run();
    await kv.delete(sessionId);
    return { sessionId, id, userId, expiresAt, renewed: true };
}

export async function getUserIdFromSession(context, now = Date.now()) {
    const session = await findSession(context, now);
    return session ? session.userId : null;
}

/*
 * For GET /api/auth/session: the signed-in user, plus a Set-Cookie header when the session was
 * extended. Returns { userId: null } when there's no valid session.
 */
export async function renewSession(context, now = Date.now()) {
    const session = await findSession(context, now);
    if (!session) return { userId: null };
    let { expiresAt } = session;
    if (session.renewed || SESSION_MS - (expiresAt - now) >= RENEW_AFTER_MS) {
        expiresAt = now + SESSION_MS;
        await context.env.db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(expiresAt, session.id).run();
    }
    const maxAge = Math.floor((expiresAt - now) / 1000);
    return { userId: session.userId, cookie: sessionCookie(session.sessionId, maxAge) };
}

export async function deleteSession(context) {
    const sessionId = getSessionId(context.request);
    if (!sessionId) return;
    await context.env.db.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(sessionId)).run();
    if (context.env.sessions) await context.env.sessions.delete(sessionId);
}
