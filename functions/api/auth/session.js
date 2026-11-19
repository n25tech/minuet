import { renewSession, deleteSession, sessionCookie } from '../_lib/sessions.js';

// Called on every page load: says who is signed in and keeps the session (and its cookie) alive.
export async function onRequestGet(context) {
    const { userId, cookie } = await renewSession(context);
    if (!userId) return Response.json({ userId: null });
    const user = await context.env.db.prepare('SELECT name, email FROM users WHERE user_id = ?').bind(userId).first();
    if (!user) return Response.json({ userId: null });
    return Response.json({ userId, name: user.name || '', email: user.email }, {
        headers: { 'Set-Cookie': cookie, 'Cache-Control': 'no-store' },
    });
}

export async function onRequestDelete(context) {
    await deleteSession(context);
    return Response.json({ userId: null }, { headers: { 'Set-Cookie': sessionCookie('', 0) } });
}
