import { getUserByGoogleSub, emailBelongsToOtherAccount, createUser, updateUserProfile } from "../_db_d1/user.js";
import { createSession, sessionCookie } from "../_sessions_kv/sessions.js";

// Verify the Google ID token and return its claims, or null if it isn't valid for this app.
async function verifyGoogleToken(idToken, clientId) {
  // Google checks the signature and expiry; we check it was issued for this app.
  const verifyResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!verifyResponse.ok) return null;
  const payload = await verifyResponse.json();
  if (payload.aud !== clientId || payload.email_verified !== 'true') {
    console.error(`Token rejected: aud=${payload.aud} email_verified=${payload.email_verified}`);
    return null;
  }
  return payload;
}

export async function onRequestPost(context) {
  try {
    const db = context.env.db;
    const formData = await context.request.formData();
    const idToken = formData.get('credential');
    if (!idToken) {
      return new Response('Missing credential token', { status: 400 });
    }

    const payload = await verifyGoogleToken(idToken, context.env.GOOGLE_CLIENT_ID);
    if (!payload) {
      return new Response('Google token verification failed', { status: 401 });
    }
    if (!payload.sub || !payload.email) {
      return new Response('Missing required user information from Google token', { status: 400 });
    }
    const googleSub = payload.sub;
    const email = payload.email;
    const name = payload.name || null;

    // Accounts are keyed by Google's stable `sub`, never by email (emails can change or be reassigned).
    let status = 200;
    let userId;
    const existing = await getUserByGoogleSub(db, googleSub);
    if (existing) {
      userId = existing.user_id;
      if (existing.email !== email || existing.name !== name) {
        if (await emailBelongsToOtherAccount(db, email, googleSub)) {
          // Don't steal another account's email; keep the stored one.
          await updateUserProfile(db, userId, { email: existing.email, name });
        } else {
          await updateUserProfile(db, userId, { email, name });
        }
      }
    } else {
      if (await emailBelongsToOtherAccount(db, email, googleSub)) {
        // The email was previously used by a different Google account. Never hand that
        // account's data to whoever holds the email now.
        return new Response('This email is linked to a different Google account', { status: 409 });
      }
      userId = await createUser(db, { email, name, googleSub });
      status = 201;
    }

    const { sessionId, ttl } = await createSession(context, userId);
    return Response.json({ userId, email, name }, {
      status,
      headers: { 'Set-Cookie': sessionCookie(sessionId, ttl) }
    });
  } catch (error) {
    console.error(`Auth callback error: ${error}`);
    return new Response('Server Auth Error', { status: 500 });
  }
}
