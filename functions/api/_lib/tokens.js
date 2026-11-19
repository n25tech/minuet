import { getUserIdFromSession } from './sessions.js';

/*
 * Personal access tokens. A token lets a program (an AI assistant through the MCP server) act as
 * the user within its scopes:
 *   read    - see notes, to-dos and the calendar
 *   suggest - also add and change notes, to-dos and *suggested* calendar tasks
 *   manage  - also commit tasks to fixed times, change committed tasks, delete things and undo changes
 * Tokens are shown once at creation; only their SHA-256 hash is stored.
 */
export const SCOPES = ['read', 'suggest', 'manage'];
const TOKEN_PREFIX = 'mnt_';
const MAX_TOKENS_PER_USER = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function newToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return TOKEN_PREFIX + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const publicToken = row => ({
    id: row.id,
    name: row.name,
    scopes: row.scopes.split(','),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
});

export async function listTokens(db, userId) {
    const { results } = await db.prepare(`SELECT id, name, scopes, created_at, expires_at, last_used_at FROM api_tokens
        WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`).bind(userId).all();
    return results.map(publicToken);
}

/* Returns { token, ...details }; `token` is the only time the secret is available. */
export async function createToken(db, userId, { name, scopes, expiresInDays }) {
    const existing = await db.prepare('SELECT COUNT(*) AS count FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL').bind(userId).first();
    if (existing.count >= MAX_TOKENS_PER_USER) throw new RangeError(`You can have at most ${MAX_TOKENS_PER_USER} tokens. Revoke one first.`);
    const token = newToken();
    const now = Date.now();
    const row = {
        id: crypto.randomUUID(),
        name,
        scopes: scopes.join(','),
        created_at: now,
        expires_at: expiresInDays ? now + expiresInDays * DAY_MS : null,
        last_used_at: null,
    };
    await db.prepare(`INSERT INTO api_tokens (id, user_id, name, token_hash, scopes, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(row.id, userId, row.name, await sha256Hex(token), row.scopes, row.created_at, row.expires_at).run();
    return { token, ...publicToken(row) };
}

export async function revokeToken(db, userId, id) {
    const result = await db.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
        .bind(Date.now(), id, userId).run();
    return result.meta.changes === 1;
}

/*
 * The token a request carries - "Authorization: Bearer mnt_..." or, for clients that can only be
 * given a URL, "?token=mnt_..." - as { userId, tokenId, name, scopes }, or null when it is
 * missing, unknown, revoked or expired.
 */
export async function authenticateToken(context) {
    const header = context.request.headers.get('Authorization') || '';
    const bearer = header.match(/^Bearer\s+(\S+)$/i);
    const token = bearer ? bearer[1] : new URL(context.request.url).searchParams.get('token');
    if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
    const db = context.env.db;
    const row = await db.prepare(`SELECT id, user_id, name, scopes, expires_at, last_used_at FROM api_tokens
        WHERE token_hash = ? AND revoked_at IS NULL`).bind(await sha256Hex(token)).first();
    const now = Date.now();
    if (!row || (row.expires_at && row.expires_at <= now)) return null;
    // "Last used" is for the user's benefit; once a minute is plenty.
    if (!row.last_used_at || now - row.last_used_at > 60 * 1000) {
        await db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').bind(now, row.id).run();
    }
    return { userId: row.user_id, tokenId: row.id, name: row.name, scopes: row.scopes.split(',') };
}

/* Token management is only ever done by the signed-in user in the app, never with a token. */
export async function sessionUser(context) {
    return getUserIdFromSession(context);
}
