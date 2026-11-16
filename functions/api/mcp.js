import { authenticateToken } from './_lib/tokens.js';
import { getSettings, localNow } from './_lib/settings.js';
import { ToolError } from './_lib/workspace.js';
import { TOOLS, describeOutcome } from './_lib/tools.js';

/*
 * Model Context Protocol server (Streamable HTTP transport, stateless: every POST is answered
 * with plain JSON, there are no sessions or server-sent streams). It lets an AI assistant read
 * and change the user's notes, to-dos and calendar through the tools in _lib/tools.js.
 *
 * Authentication is a personal access token created in the app (Settings), sent as
 * "Authorization: Bearer mnt_..." or, for clients that only take a URL, as "?token=mnt_...".
 * The token's scopes decide which tools are offered and allowed.
 */
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'minuet', title: 'Minuet', version: '1.0.0' };
const INSTRUCTIONS = 'Minuet is the user\'s notes, to-do list and calendar. Call get_context first: it gives the current local time, '
    + 'the time zone, what this token may do and the scheduling rules. All times are the user\'s local wall-clock time '
    + '(YYYY-MM-DD or YYYY-MM-DDTHH:MM), never UTC. Propose tasks as "suggested" unless the user asks for a fixed commitment.';

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });

const unauthorized = () => Response.json(rpcError(null, -32001, 'A valid Minuet access token is required. Create one in Minuet under Settings.'), {
    status: 401,
    headers: { 'WWW-Authenticate': 'Bearer realm="minuet"' },
});

async function callTool(ctx, params) {
    const tool = TOOLS.find(candidate => candidate.name === (params && params.name));
    const reply = (value, isError = false) => ({
        content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
        isError,
    });
    if (!tool) return reply(`There is no tool called “${params && params.name}”.`, true);
    if (!ctx.auth.scopes.includes(tool.scope)) {
        return reply(`This token doesn't have the “${tool.scope}” access level that ${tool.name} needs. The user can create another token in Minuet under Settings.`, true);
    }
    const args = params.arguments ?? {};
    if (typeof args !== 'object' || Array.isArray(args)) return reply('Tool arguments must be an object.', true);
    try {
        return reply(describeOutcome(await tool.run(ctx, args)));
    } catch (error) {
        if (error instanceof ToolError) return reply(error.message, true);
        console.error(error);
        return reply('Something went wrong inside Minuet while running this tool.', true);
    }
}

/* Answer one JSON-RPC message; returns null for notifications, which get no reply. */
async function handle(ctx, message) {
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
        return rpcError(message && message.id, -32600, 'Invalid request');
    }
    const { id, method, params } = message;
    if (id === undefined || id === null) return null;
    switch (method) {
        case 'initialize': {
            const requested = params && params.protocolVersion;
            return rpcResult(id, {
                protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
                capabilities: { tools: {} },
                serverInfo: SERVER_INFO,
                instructions: INSTRUCTIONS,
            });
        }
        case 'ping':
            return rpcResult(id, {});
        case 'tools/list':
            // Only what this token can use: a read-only token never sees the write tools.
            return rpcResult(id, {
                tools: TOOLS.filter(tool => ctx.auth.scopes.includes(tool.scope)).map(tool => ({
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                    annotations: { readOnlyHint: tool.scope === 'read', destructiveHint: tool.scope === 'manage' },
                })),
            });
        case 'tools/call':
            return rpcResult(id, await callTool(ctx, params));
        default:
            return rpcError(id, -32601, `Method not found: ${method}`);
    }
}

export async function onRequestPost(context) {
    const auth = await authenticateToken(context);
    if (!auth) return unauthorized();
    let body;
    try {
        body = JSON.parse(await context.request.text());
    } catch {
        return Response.json(rpcError(null, -32700, 'Parse error'), { status: 400 });
    }
    const db = context.env.db;
    const { timezone } = await getSettings(db, auth.userId);
    const ctx = { db, userId: auth.userId, auth, actor: auth.name, timezone, now: localNow(timezone) };

    if (Array.isArray(body)) {
        const replies = [];
        for (const message of body) {   // in order: later calls may depend on earlier ones
            const reply = await handle(ctx, message);
            if (reply) replies.push(reply);
        }
        return replies.length ? Response.json(replies) : new Response(null, { status: 202 });
    }
    const reply = await handle(ctx, body);
    return reply ? Response.json(reply) : new Response(null, { status: 202 });
}

// No server-initiated stream and no sessions to end.
const notAllowed = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });
export const onRequestGet = notAllowed;
export const onRequestDelete = notAllowed;
