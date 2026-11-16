import { getUserIdFromSession } from './_sessions_kv/sessions.js';
import { getSettings, saveTimezone, isTimeZone } from './_lib/settings.js';

export async function onRequestGet(context) {
    const userId = await getUserIdFromSession(context);
    if (!userId) return Response.json({ error: 'Not signed in' }, { status: 401 });
    return Response.json(await getSettings(context.env.db, userId));
}

export async function onRequestPost(context) {
    const userId = await getUserIdFromSession(context);
    if (!userId) return Response.json({ error: 'Not signed in' }, { status: 401 });
    if (!(context.request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) {
        return Response.json({ error: 'Content-Type must be application/json' }, { status: 415 });
    }
    let body = null;
    try { body = await context.request.json(); } catch { /* handled below */ }
    if (!body || !isTimeZone(body.timezone)) return Response.json({ error: 'Unknown time zone' }, { status: 400 });
    await saveTimezone(context.env.db, userId, body.timezone);
    return Response.json({ timezone: body.timezone });
}
