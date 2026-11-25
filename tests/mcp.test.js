import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { SqliteD1Database, MockKVNamespace } from './helpers/d1.js';
import { createSession } from '../functions/api/_lib/sessions.js';
import { saveTodoListForUser } from '../functions/api/_db_d1/todolist.js';
import { saveNotesForUser } from '../functions/api/_db_d1/notes.js';
import * as mcp from '../functions/api/mcp.js';
import * as tokensApi from '../functions/api/tokens.js';
import * as settingsApi from '../functions/api/settings.js';
import * as historyApi from '../functions/api/history.js';
import * as notebookApi from '../functions/api/storage/notebook.js';
import * as calendarApi from '../functions/api/storage/calendar.js';
import { coreModuleSource, CORE_MODULE } from '../scripts/build.js';
import { localNow } from '../functions/api/_lib/settings.js';

// A signed-in user with a browser session, plus helpers to act as the app (cookie) or as an MCP client (token).
async function setup() {
    const env = { db: new SqliteD1Database(), sessions: new MockKVNamespace() };
    env.db.addUser('user-1', 'me@example.com', 'Me');
    const { sessionId } = await createSession({ env }, 'user-1');
    const cookie = `minuet_session=${sessionId}`;
    const app = (api, method = 'GET', body, query = '') => api[`onRequest${method[0]}${method.slice(1).toLowerCase()}`]({
        env,
        request: new Request(`http://localhost/api${query}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body && JSON.stringify(body) }),
    });
    const newToken = async (scopes, name = 'Claude', expiresInDays = 90) =>
        (await (await app(tokensApi, 'POST', { name, scopes, expiresInDays })).json());
    let nextId = 1;
    const rpc = (token, method, params, { query = '', header = true } = {}) => mcp.onRequestPost({
        env,
        request: new Request(`http://localhost/api/mcp${query}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(header && token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
        }),
    });
    // Call a tool; returns its parsed result, or throws its message when the tool reports an error.
    const call = async (token, name, args = {}) => {
        const { result } = await (await rpc(token, 'tools/call', { name, arguments: args })).json();
        const text = result.content[0].text;
        if (result.isError) throw new Error(text);
        return JSON.parse(text);
    };
    const stored = async api => (await app(api)).json();
    return { env, app, newToken, rpc, call, stored };
}

const ALL = ['read', 'suggest', 'manage'];
const day = '2030-03-12';   // far enough ahead that "now" never matters

test('The generated server module matches the browser sources', async () => {
    assert.strictEqual(readFileSync(new URL(`../${CORE_MODULE}`, import.meta.url), 'utf8'), await coreModuleSource(),
        'functions/api/_lib/core.js is stale: run "npm run build"');
});

test('MCP requires a valid token; revoked, expired and malformed ones are refused', async () => {
    const { env, app, newToken, rpc } = await setup();
    assert.strictEqual((await rpc(null, 'ping')).status, 401);
    assert.strictEqual((await rpc('mnt_not-a-real-token', 'ping')).status, 401);
    assert.strictEqual((await rpc('session-or-other-secret', 'ping')).status, 401);

    const created = await newToken(['read']);
    assert.match(created.token, /^mnt_[\w-]{43}$/);
    assert.strictEqual((await rpc(created.token, 'ping')).status, 200);
    // The token also works in the URL, for clients that can only be given an address.
    assert.strictEqual((await rpc(created.token, 'ping', undefined, { query: `?token=${created.token}`, header: false })).status, 200);

    // Only a hash is stored, and the list never returns the secret.
    const row = env.db.sqlite.prepare('SELECT * FROM api_tokens').get();
    assert.ok(!JSON.stringify(row).includes(created.token));
    const listed = await (await app(tokensApi)).json();
    assert.deepStrictEqual(listed.tokens.map(t => [t.name, t.scopes, 'token' in t]), [['Claude', ['read'], false]]);
    assert.ok(listed.tokens[0].lastUsedAt);

    env.db.sqlite.prepare('UPDATE api_tokens SET expires_at = 1').run();
    assert.strictEqual((await rpc(created.token, 'ping')).status, 401);
    env.db.sqlite.prepare('UPDATE api_tokens SET expires_at = NULL').run();
    assert.strictEqual((await app(tokensApi, 'DELETE', undefined, `?id=${created.id}`)).status, 200);
    assert.strictEqual((await rpc(created.token, 'ping')).status, 401);
    assert.deepStrictEqual((await (await app(tokensApi)).json()).tokens, []);
});

test('Tokens can only be managed from a signed-in session, with a valid access level', async () => {
    const { env, app, newToken } = await setup();
    const anonymous = { env, request: new Request('http://localhost/api/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }) };
    assert.strictEqual((await tokensApi.onRequestPost(anonymous)).status, 401);
    // A token can't be used to mint or list tokens.
    const { token } = await newToken(ALL);
    const withToken = { env, request: new Request('http://localhost/api/tokens', { headers: { Authorization: `Bearer ${token}` } }) };
    assert.strictEqual((await tokensApi.onRequestGet(withToken)).status, 401);
    for (const bad of [{ name: '', scopes: ['read'], expiresInDays: 90 }, { name: 'x', scopes: ['suggest'], expiresInDays: 90 },
        { name: 'x', scopes: ['read', 'manage'], expiresInDays: 90 }, { name: 'x', scopes: ['read', 'admin'], expiresInDays: 90 }, { name: 'x', scopes: ['read'], expiresInDays: 7 }]) {
        assert.strictEqual((await app(tokensApi, 'POST', bad)).status, 400, JSON.stringify(bad));
    }
});

test('MCP handshake, and tools/list only offers what the token may use', async () => {
    const { newToken, rpc } = await setup();
    const reader = (await newToken(['read'])).token;
    const init = await (await rpc(reader, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })).json();
    assert.strictEqual(init.result.protocolVersion, '2025-06-18');
    assert.strictEqual(init.result.serverInfo.name, 'minuet');
    assert.ok(init.result.capabilities.tools);
    // Notifications get no body.
    const note = await mcp.onRequestPost({ env: (await setup()).env, request: new Request('http://localhost/api/mcp', { method: 'POST', body: '{}' }) });
    assert.strictEqual(note.status, 401);
    const names = async token => (await (await rpc(token, 'tools/list')).json()).result.tools.map(tool => tool.name);
    const readTools = await names(reader);
    assert.ok(readTools.includes('list_schedule') && !readTools.includes('add_event') && !readTools.includes('delete_note'));
    const suggestTools = await names((await newToken(['read', 'suggest'], 'S')).token);
    assert.ok(suggestTools.includes('add_event') && !suggestTools.includes('delete_event'));
    assert.ok((await names((await newToken(ALL, 'M')).token)).includes('undo_change'));
    assert.strictEqual((await (await rpc(reader, 'no/such')).json()).error.code, -32601);
    assert.strictEqual((await mcp.onRequestGet()).status, 405);
});

test('A read-only token cannot call write tools even by name', async () => {
    const { newToken, call, stored } = await setup();
    const reader = (await newToken(['read'])).token;
    await assert.rejects(call(reader, 'add_event', { title: 'x', start: `${day}T09:00` }), /doesn't have the “suggest” access level/);
    assert.deepStrictEqual((await stored(calendarApi)).events, []);
});

test('Adding an event stores it for the app, versioned, and records history', async () => {
    const { newToken, call, stored, app } = await setup();
    const token = (await newToken(['read', 'suggest'], 'Planner')).token;
    const added = await call(token, 'add_event', { title: 'Focus block', start: `${day}T09:00` });
    assert.deepStrictEqual([added.event.start, added.event.end, added.event.status], [`${day}T09:00`, `${day}T10:00`, 'suggested']);
    const calendar = await stored(calendarApi);
    assert.strictEqual(calendar.version, 1);
    assert.strictEqual(calendar.events[0].title, 'Focus block');
    assert.ok(calendar.events[0].updatedAt);
    const history = (await (await app(historyApi)).json()).changes;
    assert.deepStrictEqual([history[0].actor, history[0].summary, history[0].items[0].what], ['Planner', 'Added event “Focus block”', 'added']);
    assert.strictEqual(history[0].id, added.change_id);
});

test('A server change is saved on top of the app\'s latest version, and the app then conflicts instead of overwriting it', async () => {
    const { newToken, call, stored, app } = await setup();
    const token = (await newToken(['read', 'suggest'])).token;
    // The app saves an event first (version 1).
    await app(calendarApi, 'POST', { events: [{ id: 'mine', title: 'Mine', start: `${day}T12:00`, end: `${day}T13:00` }], version: 0 });
    await call(token, 'add_event', { title: 'Theirs', start: `${day}T15:00` });
    const calendar = await stored(calendarApi);
    assert.deepStrictEqual([calendar.version, calendar.events.map(e => e.title)], [2, ['Mine', 'Theirs']]);
    // A device still on version 1 gets a 409 with the server state, which its sync then merges.
    assert.strictEqual((await app(calendarApi, 'POST', { events: [], version: 1 })).status, 409);
});

test('Scheduling rules run on the server: a committed task moves suggested ones and is refused on a committed slot', async () => {
    const { newToken, call, stored } = await setup();
    const suggest = (await newToken(['read', 'suggest'], 'S')).token;
    const manage = (await newToken(ALL, 'M')).token;
    const reading = await call(suggest, 'add_event', { title: 'Reading', start: `${day}T09:00` });
    const todo = await call(suggest, 'add_todo', { text: 'Call bank', due: `${day}T09:30` });

    // A suggest-only token can't commit.
    await assert.rejects(call(suggest, 'add_event', { title: 'Standup', start: `${day}T09:00`, status: 'committed' }), /needs a token with the “manage” access level/);
    const standup = await call(manage, 'add_event', { title: 'Standup', start: `${day}T09:00`, end: `${day}T10:00`, status: 'committed' });
    assert.deepStrictEqual(standup.adjustments.map(a => [a.title, a.from, a.to]).sort(), [
        ['Call bank', `${day}T09:30`, `${day}T10:00`],
        ['Reading', `${day}T09:00`, `${day}T10:00`],
    ]);
    const schedule = await call(suggest, 'list_schedule', { from: day, to: day });
    assert.deepStrictEqual(schedule.occurrences.map(o => [o.title, o.start, o.status, o.kind]), [
        ['Standup', `${day}T09:00`, 'committed', 'event'],
        ['Reading', `${day}T10:00`, 'suggested', 'event'],
        ['Call bank', `${day}T10:00`, 'suggested', 'todo'],
    ]);
    assert.strictEqual((await stored(notebookApi)).notes.find(n => n.id === 'pomodoro-todo').items[0].due, `${day}T10:00`);

    // Only one committed task per time: refused, nothing stored.
    await assert.rejects(call(manage, 'add_event', { title: 'Dentist', start: `${day}T09:30`, status: 'committed' }), /overlap the committed task “Standup”/);
    assert.strictEqual((await stored(calendarApi)).events.length, 2);
    // A suggested task placed on a committed one is moved, and the reply says where it ended up.
    const lunch = await call(suggest, 'add_event', { title: 'Walk', start: `${day}T09:15`, end: `${day}T09:45` });
    assert.deepStrictEqual([lunch.event.start, lunch.adjustments[0].to], [`${day}T10:00`, `${day}T10:00`]);
    // A suggest-only token can't change or move the committed one.
    await assert.rejects(call(suggest, 'update_event', { id: standup.id, title: 'x' }), /manage/);
    await assert.rejects(call(suggest, 'reschedule_task', { task_id: standup.id, start: `${day}T11:00` }), /manage/);
    await call(suggest, 'reschedule_task', { task_id: reading.id, start: `${day}T14:00` });
    assert.strictEqual((await stored(calendarApi)).events.find(e => e.id === reading.id).end, `${day}T15:00`);
    assert.ok(todo.todo.task_id.startsWith('item:pomodoro-todo:'));
});

test('find_free_time returns the gaps around timed tasks within the day\'s hours', async () => {
    const { newToken, call } = await setup();
    const token = (await newToken(ALL)).token;
    await call(token, 'add_event', { title: 'A', start: `${day}T09:00`, end: `${day}T10:30`, status: 'committed' });
    await call(token, 'add_event', { title: 'B', start: `${day}T13:00`, end: `${day}T14:00` });
    await call(token, 'add_event', { title: 'Holiday', start: day });   // all-day: never blocks
    const args = { from: day, to: day, duration_minutes: 60, earliest: '08:00', latest: '18:00' };
    assert.deepStrictEqual((await call(token, 'find_free_time', args)).free, [
        { start: `${day}T08:00`, end: `${day}T09:00` }, { start: `${day}T10:30`, end: `${day}T13:00` }, { start: `${day}T14:00`, end: `${day}T18:00` },
    ]);
    assert.deepStrictEqual((await call(token, 'find_free_time', { ...args, avoid: 'committed' })).free, [
        { start: `${day}T08:00`, end: `${day}T09:00` }, { start: `${day}T10:30`, end: `${day}T18:00` },
    ]);
    await assert.rejects(call(token, 'find_free_time', { ...args, to: '2030-02-30' }), /real date/);
});

test('To-dos and notes: the old to-do list and diary are brought over, and edits respect access levels', async () => {
    const { env, newToken, call, stored } = await setup();
    await saveTodoListForUser(env.db, 'user-1', [{ id: 'old', text: 'Old to-do', complete: true }], 0);
    await saveNotesForUser(env.db, 'user-1', 'old diary', 0);
    const suggest = (await newToken(['read', 'suggest'], 'S')).token;
    const manage = (await newToken(ALL, 'M')).token;

    // Reading shows the legacy data without storing anything yet.
    assert.deepStrictEqual((await call(suggest, 'list_todos')).todos.map(t => [t.text, t.done]), [['Old to-do', true]]);
    assert.deepStrictEqual((await stored(notebookApi)).notes, []);

    const added = await call(suggest, 'add_todo', { text: 'New one' });
    await call(suggest, 'update_todo', { id: added.id, done: true });
    const notes = (await stored(notebookApi)).notes;
    assert.deepStrictEqual(notes.find(n => n.id === 'pomodoro-todo').items.map(i => [i.text, i.done]), [['Old to-do', true], ['New one', true]]);
    assert.strictEqual(notes.find(n => n.id === 'pomodoro-diary').text, 'old diary');

    const note = await call(suggest, 'create_note', { title: 'Trip', entries: ['Passport', 'Tickets'], labels: ['travel'], due: day });
    assert.deepStrictEqual([note.note.type, note.note.entries.length, note.note.due, note.note.status], ['checklist', 2, day, 'suggested']);
    await call(suggest, 'add_todo', { note_id: note.id, text: 'Visa' });
    assert.deepStrictEqual((await call(suggest, 'list_notes', { label: 'travel' })).notes.map(n => [n.title, n.entries]), [['Trip', 3]]);
    assert.strictEqual((await call(suggest, 'get_note', { id: 'pomodoro-diary' })).text, 'old diary');
    await assert.rejects(call(suggest, 'update_note', { id: note.id, text: 'x' }), /checklist/);

    // Text notes can be made Markdown or plain; left unsaid, the app decides from the text.
    const md = await call(suggest, 'create_note', { title: 'Plan', text: '# Steps', markdown: true });
    const plain = await call(suggest, 'create_note', { title: 'Memo', text: '# not a heading', markdown: false });
    const either = await call(suggest, 'create_note', { title: 'Jot', text: 'hello' });
    assert.deepStrictEqual([md.note.type, plain.note.type, either.note.type], ['markdown', 'text', 'text']);
    const storedNotes = (await stored(notebookApi)).notes;
    assert.deepStrictEqual(['Plan', 'Memo', 'Jot'].map(title => storedNotes.find(n => n.title === title).type), ['markdown', 'plain', 'text']);
    await assert.rejects(call(suggest, 'create_note', { entries: ['a'], markdown: true }), /not checklists/);

    // Deleting needs manage, and the default notes can never be deleted.
    await assert.rejects(call(suggest, 'delete_note', { id: note.id }), /“manage” access level/);
    await assert.rejects(call(manage, 'delete_note', { id: 'pomodoro-todo' }), /can't be deleted/);
    await call(manage, 'delete_note', { id: note.id });
    assert.ok(!(await stored(notebookApi)).notes.some(n => n.id === note.id));
});

test('Any token change can be undone, from the app or with a manage token', async () => {
    const { newToken, call, stored, app } = await setup();
    const manage = (await newToken(ALL, 'M')).token;
    const suggest = (await newToken(['read', 'suggest'], 'S')).token;
    const reading = await call(manage, 'add_event', { title: 'Reading', start: `${day}T09:00` });
    // This change both adds Standup and moves Reading; undoing it must reverse both.
    const standup = await call(manage, 'add_event', { title: 'Standup', start: `${day}T09:00`, status: 'committed' });
    assert.strictEqual((await stored(calendarApi)).events.find(e => e.id === reading.id).start, `${day}T10:00`);

    await assert.rejects(call(suggest, 'undo_change', { id: standup.change_id }), /“manage” access level/);
    assert.strictEqual((await app(historyApi, 'POST', { undo: standup.change_id })).status, 200);
    let events = (await stored(calendarApi)).events;
    assert.deepStrictEqual(events.map(e => [e.title, e.start]), [['Reading', `${day}T09:00`]]);
    assert.strictEqual((await app(historyApi, 'POST', { undo: standup.change_id })).status, 409);   // already undone

    const removed = await call(manage, 'delete_event', { id: reading.id });
    assert.deepStrictEqual((await stored(calendarApi)).events, []);
    await call(manage, 'undo_change', { id: removed.change_id });
    events = (await stored(calendarApi)).events;
    assert.deepStrictEqual(events.map(e => e.title), ['Reading']);
    const history = (await call(manage, 'list_history')).changes;
    assert.deepStrictEqual(history.map(h => [h.actor, h.summary, h.undone]).slice(0, 2), [
        ['M', 'Undid: Deleted event “Reading”', false], ['M', 'Deleted event “Reading”', true],
    ]);
    assert.ok(history.some(h => h.actor === 'You' && h.summary === 'Undid: Added event “Standup”'));
});

test('Time zone setting: validated, stored, and used for "now" in get_context', async () => {
    const { newToken, call, app } = await setup();
    assert.deepStrictEqual(await (await app(settingsApi)).json(), { timezone: null });
    assert.strictEqual((await app(settingsApi, 'POST', { timezone: 'Mars/Olympus' })).status, 400);
    assert.strictEqual((await app(settingsApi, 'POST', { timezone: 'Asia/Kolkata' })).status, 200);
    const context = await call((await newToken(['read'])).token, 'get_context');
    assert.strictEqual(context.time_zone, 'Asia/Kolkata');
    assert.match(context.now, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    assert.deepStrictEqual(context.access, ['read']);
    // 18:30 UTC is midnight the next day in India (UTC+5:30).
    assert.strictEqual(localNow('Asia/Kolkata', new Date('2026-11-16T18:30:00Z')), '2026-11-17T00:00');
    assert.strictEqual(localNow('America/New_York', new Date('2026-07-01T03:15:00Z')), '2026-06-30T23:15');
});

test('Bad tool input is reported to the caller and changes nothing', async () => {
    const { newToken, call, stored } = await setup();
    const token = (await newToken(ALL)).token;
    await assert.rejects(call(token, 'add_event', { title: 'x', start: '2030-03-12 09:00' }), /YYYY-MM-DD/);
    await assert.rejects(call(token, 'add_event', { title: 'x', start: `${day}T09:00`, end: `${day}T08:00` }), /after “start”/);
    await assert.rejects(call(token, 'add_event', { title: 'x', start: `${day}T09:00`, end: day }), /both be dates/);
    await assert.rejects(call(token, 'add_event', { title: '', start: day }), /can't be empty/);
    await assert.rejects(call(token, 'update_todo', { id: 'nope' }), /no entry with id/);
    await assert.rejects(call(token, 'add_todo', { text: 'x', status: 'committed' }), /Give a “due” date/);
    await assert.rejects(call(token, 'no_such_tool'), /no tool called/);
    assert.deepStrictEqual((await stored(calendarApi)).events, []);
});
