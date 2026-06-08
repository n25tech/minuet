export async function onRequestGet(context) {
  const { searchParams } = new URL(context.request.url);
  const code = searchParams.get('code');

  if (!code) {
    return new Response('Authorization code missing', { status: 400 });
  }

  // Swap authorization code for access token safely on backend edge
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: context.env.GOOGLE_CLIENT_ID,
      client_secret: context.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: 'https://minuet.n25tech.com/api/auth/callback',
      grant_type: 'authorization_code',
    }),
  });

  const tokens = await tokenResponse.json();

  if (tokens.error) {
    return new Response(`OAuth Error: ${tokens.error_description}`, { status: 500 });
  }

  // Fetch user profile metrics using the acquired ID Token / Access Token
  const userProfileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  
  const profile = await userProfileResponse.json();

  // Establish application context (e.g., setting an encrypted session cookie)
  return new Response(JSON.stringify({ message: "Authenticated!", user: profile }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
