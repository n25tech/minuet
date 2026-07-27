export const onRequest = [corsMiddleware];

const ALLOWED_ORIGINS = [
  "https://minuet.n25tech.com",
  "http://localhost:3000" // For local development
];

async function corsMiddleware(context) {
  const { request, next } = context;
  const origin = request.headers.get("Origin");
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups"
  };

  // Handle preflight requests immediately
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
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