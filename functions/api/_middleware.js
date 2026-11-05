export const onRequest = [corsMiddleware];

const PRODUCTION_ORIGIN = "https://minuet.n25tech.com";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Origins allowed to make credentialed requests to this deployment: production, the
// deployment's own origin (e.g. a Pages preview), and localhost - but localhost only when
// this deployment is itself running locally, so a random dev server on a user's machine
// can never read or change their production data.
function isTrustedOrigin(origin, request) {
  if (origin === null) return false;
  const self = new URL(request.url);
  if (origin === PRODUCTION_ORIGIN || origin === self.origin) return true;
  try {
    return LOCAL_HOSTNAMES.has(self.hostname) && LOCAL_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

async function corsMiddleware(context) {
  const { request, next } = context;
  const origin = request.headers.get("Origin");
  const trusted = isTrustedOrigin(origin, request);

  const corsHeaders = {
    "Access-Control-Allow-Origin": trusted ? origin : PRODUCTION_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups"
  };

  // Handle preflight requests immediately
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // CSRF protection: refuse state-changing requests that a browser sent from an untrusted origin.
  if (!SAFE_METHODS.has(request.method) && origin !== null && !trusted) {
    return new Response("Forbidden origin", { status: 403, headers: corsHeaders });
  }

  // Execute the target function (e.g., onRequestGet)
  const response = await next();

  // Attach CORS headers to the resulting response
  const newResponse = new Response(response.body, response);
  Object.keys(corsHeaders).forEach(key => {
    newResponse.headers.set(key, corsHeaders[key]);
  });

  return newResponse;
}
