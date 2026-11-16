import { SCOPES, listTokens, createToken, revokeToken, sessionUser } from './_lib/tokens.js';

// Managing access tokens: only for the signed-in user in the app (session cookie), never with a token.
const signedOut = () => Response.json({ error: 'Not signed in' }, { status: 401 });
const EXPIRY_DAYS = [30, 90, 365, 0];   // 0 = never

export async function onRequestGet(context) {
    const userId = await sessionUser(context);
    if (!userId) return signedOut();
    return Response.json({ tokens: await listTokens(context.env.db, userId) });
}

export async function onRequestPost(context) {
    const userId = await sessionUser(context);
    if (!userId) return signedOut();
    // Requiring JSON forces a CORS preflight, so plain cross-site form posts can't create tokens.
    if (!(context.request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) {
        return Response.json({ error: 'Content-Type must be application/json' }, { status: 415 });
    }
    let body = null;
    try { body = await context.request.json(); } catch { /* handled below */ }
    const name = body && typeof body.name === 'string' ? body.name.trim() : '';
    const scopes = body && Array.isArray(body.scopes) ? SCOPES.filter(scope => body.scopes.includes(scope)) : [];
    const expiresInDays = body ? Number(body.expiresInDays) : NaN;
    if (!name || name.length > 60) return Response.json({ error: 'Give the token a name of up to 60 characters.' }, { status: 400 });
    if (!scopes.includes('read') || scopes.length !== body.scopes.length) return Response.json({ error: 'Invalid access level.' }, { status: 400 });
    // Each level includes the ones below it.
    if (scopes.includes('manage') && !scopes.includes('suggest')) return Response.json({ error: 'Invalid access level.' }, { status: 400 });
    if (!EXPIRY_DAYS.includes(expiresInDays)) return Response.json({ error: 'Invalid expiry.' }, { status: 400 });
    try {
        return Response.json(await createToken(context.env.db, userId, { name, scopes, expiresInDays }));
    } catch (error) {
        if (error instanceof RangeError) return Response.json({ error: error.message }, { status: 400 });
        throw error;
    }
}

export async function onRequestDelete(context) {
    const userId = await sessionUser(context);
    if (!userId) return signedOut();
    const id = new URL(context.request.url).searchParams.get('id');
    if (!id || !(await revokeToken(context.env.db, userId, id))) return Response.json({ error: 'No such token' }, { status: 404 });
    return Response.json({ revoked: id });
}
