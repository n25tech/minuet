import { getUserIdFromSession } from '../_sessions_kv/sessions.js';

// Upper bound on a stored document (notes text or serialised todo list).
export const MAX_BODY_BYTES = 256 * 1024;

// Shared GET/POST handlers for per-user versioned documents.
// POST returns 200 {…, version} on success or 409 with the current server state on a version conflict.
export function syncHandlers({ fetch, save, field, isValid }) {
  async function onRequestGet(context) {
    const userId = await getUserIdFromSession(context);
    if (!userId) return Response.json({ error: 'Not signed in' }, { status: 401 });
    return Response.json(await fetch(context.env.db, userId));
  }

  async function onRequestPost(context) {
    const userId = await getUserIdFromSession(context);
    if (!userId) return Response.json({ error: 'Not signed in' }, { status: 401 });
    // Requiring JSON forces a CORS preflight, so plain cross-site form posts can't write here.
    const contentType = context.request.headers.get('Content-Type') || '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      return Response.json({ error: 'Content-Type must be application/json' }, { status: 415 });
    }
    const text = await context.request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
      return Response.json({ error: 'Payload too large' }, { status: 413 });
    }
    let body = null;
    try { body = JSON.parse(text); } catch { /* handled below */ }
    if (!body || !isValid(body[field])) {
      return Response.json({ error: `Invalid ${field}` }, { status: 400 });
    }
    const version = Number(body.version) || 0;
    const db = context.env.db;
    if (await save(db, userId, body[field], version)) {
      return Response.json({ version: version + 1 });
    }
    return Response.json(await fetch(db, userId), { status: 409 });
  }

  return { onRequestGet, onRequestPost };
}
