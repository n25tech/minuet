import { getUserIdFromSession, getSessionId, sessionCookie } from '../_sessions_kv/sessions.js';
export async function onRequestGet(context) {
    const userId = await getUserIdFromSession(context);
    if (!userId) return Response.json({ userId: null });
    const user = await context.env.db.prepare('SELECT name FROM users WHERE user_id = ?').bind(userId).first();
    return Response.json({ userId: user ? userId : null, name: user?.name || '' });
}
export async function onRequestDelete(context) {
    const id = getSessionId(context.request);
    if (id) await context.env.sessions.delete(id);
    return Response.json({ userId: null }, { headers: { 'Set-Cookie': sessionCookie(context.request, '', 0) } });
}
