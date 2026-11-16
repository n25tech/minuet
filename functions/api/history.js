import { getUserIdFromSession } from './_sessions_kv/sessions.js';
import { ToolError, listHistory, undo } from './_lib/workspace.js';

// The record of changes made through access tokens, for the signed-in user to review and undo in the app.
export async function onRequestGet(context) {
    const userId = await getUserIdFromSession(context);
    if (!userId) return Response.json({ error: 'Not signed in' }, { status: 401 });
    return Response.json({ changes: await listHistory(context.env.db, userId, 50) });
}

// POST { undo: "<history id>" }
export async function onRequestPost(context) {
    const userId = await getUserIdFromSession(context);
    if (!userId) return Response.json({ error: 'Not signed in' }, { status: 401 });
    if (!(context.request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) {
        return Response.json({ error: 'Content-Type must be application/json' }, { status: 415 });
    }
    let body = null;
    try { body = await context.request.json(); } catch { /* handled below */ }
    if (!body || typeof body.undo !== 'string') return Response.json({ error: 'Nothing to undo' }, { status: 400 });
    try {
        await undo(context.env.db, userId, 'You', body.undo);
        return Response.json({ undone: body.undo });
    } catch (error) {
        if (error instanceof ToolError) return Response.json({ error: error.message }, { status: 409 });
        throw error;
    }
}
