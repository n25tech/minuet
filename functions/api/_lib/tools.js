import {
    toYMD, toLocalISO, parseLocal, addDays, eventBounds, expandEvents,
    TODO_NOTE_ID, isDefaultNote, clearTask, setRepeat, setStatus, noteHeading, noteTasks,
} from './core.js';
import { ToolError, loadWorkspace, mutate, listHistory, undo } from './workspace.js';

/*
 * The tools the MCP server offers (see ../mcp.js). Each has the scope a token needs to use it:
 * read < suggest < manage. On top of that, a "suggest" token may only touch suggested tasks -
 * committing a task to a fixed time, changing a committed one, and deleting need "manage".
 *
 * All dates are the user's local wall-clock time: "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM".
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const isDate = value => typeof value === 'string' && DATE.test(value) && toYMD(parseLocal(value)) === value;
const isDateTime = value => typeof value === 'string' && DATETIME.test(value) && toLocalISO(parseLocal(value)) === value;

const REPEATS = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
const STATUSES = ['suggested', 'committed'];
const EVENT_COLORS = ['green', 'blue', 'red', 'orange', 'purple', 'slate'];
const NOTE_COLORS = ['default', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple'];

/* ---------- Argument checks ---------- */

function text(args, key, { max = 200, required = false } = {}) {
    const value = args[key];
    if (value === undefined || value === null) {
        if (required) throw new ToolError(`“${key}” is required.`);
        return undefined;
    }
    if (typeof value !== 'string') throw new ToolError(`“${key}” must be text.`);
    if (value.length > max) throw new ToolError(`“${key}” is too long (at most ${max} characters).`);
    if (required && !value.trim()) throw new ToolError(`“${key}” can't be empty.`);
    return value;
}

function choice(args, key, options) {
    const value = args[key];
    if (value === undefined || value === null) return undefined;
    if (!options.includes(value)) throw new ToolError(`“${key}” must be one of: ${options.join(', ')}.`);
    return value;
}

function when(args, key, { required = false, dateOnly = false } = {}) {
    const value = args[key];
    if (value === undefined || value === null || value === '') {
        if (required) throw new ToolError(`“${key}” is required.`);
        return value === '' ? '' : undefined;
    }
    if (isDate(value) || (!dateOnly && isDateTime(value))) return value;
    throw new ToolError(`“${key}” must be a real date as ${dateOnly ? 'YYYY-MM-DD' : 'YYYY-MM-DD (all day) or YYYY-MM-DDTHH:MM (local time)'}.`);
}

function labels(args) {
    if (args.labels === undefined || args.labels === null) return undefined;
    if (!Array.isArray(args.labels) || args.labels.length > 10 || args.labels.some(label => typeof label !== 'string' || !label.trim() || label.length > 40)) {
        throw new ToolError('“labels” must be a list of up to 10 short texts.');
    }
    return [...new Set(args.labels.map(label => label.trim()))];
}

function requireManage(ctx, action) {
    if (!ctx.auth.scopes.includes('manage')) {
        throw new ToolError(`This token can only work with suggested tasks. ${action} needs a token with the “manage” access level, which the user creates in Minuet under Settings.`);
    }
}

/* ---------- Shared pieces ---------- */

const repeatOf = source => (source.repeat && source.repeat.freq) || 'none';
const statusOf = source => source.status === 'committed' ? 'committed' : 'suggested';

/* Apply the calendar arguments (due, repeat, status) shared by notes and checklist entries. */
function applyTaskArgs(ctx, source, args) {
    const due = when(args, 'due');
    const repeat = choice(args, 'repeat', REPEATS);
    const status = choice(args, 'status', STATUSES);
    const wasCommitted = source.status === 'committed';
    if (due === '') {
        if (wasCommitted) requireManage(ctx, 'Taking a committed task off the calendar');
        clearTask(source);
        return;
    }
    if (due === undefined && !source.calendar) {
        if (repeat !== undefined || status !== undefined) throw new ToolError('Give a “due” date to put this on the calendar before setting “repeat” or “status”.');
        return;
    }
    if ((due !== undefined || repeat !== undefined) && wasCommitted) requireManage(ctx, 'Changing a committed task');
    if (due !== undefined) {
        if (due !== source.due) {
            delete source.exdates;
            delete source.moves;
        }
        source.due = due;
        source.calendar = true;
    }
    if (repeat !== undefined && repeat !== repeatOf(source)) setRepeat(source, repeat === 'none' ? '' : repeat);
    if (status !== undefined && status !== statusOf(source)) {
        requireManage(ctx, status === 'committed' ? 'Committing a task to a fixed time' : 'Changing a committed task');
        setStatus(source, status);
    }
}

const taskFields = source => source.calendar && source.due
    ? { due: source.due, repeat: repeatOf(source), status: statusOf(source) }
    : {};

const entryView = (note, item) => ({
    id: item.id,
    text: item.text,
    done: !!item.done,
    ...taskFields(item),
    ...(item.calendar && item.due ? { task_id: `item:${note.id}:${item.id}` } : {}),
});

const noteView = note => ({
    id: note.id,
    title: note.title || '',
    type: note.type === 'list' ? 'checklist' : 'text',
    ...(note.type === 'list' ? { entries: (note.items || []).map(item => entryView(note, item)) } : { text: note.text || '' }),
    labels: note.labels || [],
    color: note.color || 'default',
    pinned_to_home: !!note.pinned,
    ...taskFields(note),
    ...(note.calendar && note.due ? { task_id: `note:${note.id}` } : {}),
});

const eventView = event => ({
    id: event.id,
    title: event.title || '',
    start: event.start,
    end: event.end,
    all_day: !!event.allDay,
    repeat: repeatOf(event),
    ...(event.repeat && event.repeat.until ? { until: event.repeat.until } : {}),
    status: statusOf(event),
    color: event.color || EVENT_COLORS[0],
    ...(event.description ? { description: event.description } : {}),
});

function findNote(draft, id) {
    const note = draft.notes.find(candidate => candidate.id === id);
    if (!note) throw new ToolError(`There is no note with id “${id}”. Use list_notes to see the notes.`);
    return note;
}

function findChecklist(draft, noteId) {
    const note = findNote(draft, noteId || TODO_NOTE_ID);
    if (note.type !== 'list') throw new ToolError(`“${note.title || note.id}” is a text note, not a checklist.`);
    return note;
}

const replaceNote = (draft, note) => { draft.notes = draft.notes.map(existing => existing.id === note.id ? note : existing); };
const taskIdsOf = note => noteTasks([note]).map(task => task.id);

/* Start and end for an event from the arguments, keeping `previous`' length when only the start moves. */
function eventTimes(args, previous) {
    const start = when(args, 'start', { required: !previous });
    let end = when(args, 'end');
    if (start === undefined && end === undefined) return {};
    const newStart = start || previous.start;
    const allDay = isDate(newStart);
    if (end === undefined) {
        if (previous && !!previous.allDay === allDay) {
            const before = eventBounds(previous);
            const lengthMs = before.end - before.start;
            end = allDay
                ? toYMD(addDays(parseLocal(newStart), Math.round(lengthMs / 86400000) - 1))
                : toLocalISO(new Date(parseLocal(newStart).getTime() + lengthMs));
        } else {
            end = allDay ? newStart : toLocalISO(new Date(parseLocal(newStart).getTime() + 60 * 60 * 1000));
        }
    }
    if (isDate(end) !== allDay) throw new ToolError('“start” and “end” must both be dates (an all-day event) or both be date-times.');
    if (allDay ? end < newStart : end <= newStart) throw new ToolError('“end” must be after “start”.');
    return { start: newStart, end, allDay };
}

const whenSchema = description => ({ type: 'string', description });
const TASK_PROPERTIES = {
    due: whenSchema('When it is on the calendar: YYYY-MM-DD (all day) or YYYY-MM-DDTHH:MM (local time; takes 30 minutes). Pass "" to take it off the calendar.'),
    repeat: { type: 'string', enum: REPEATS },
    status: { type: 'string', enum: STATUSES, description: 'suggested (default; may overlap others and be moved) or committed (fixed; needs the manage access level).' },
};

/* ---------- Tools ---------- */

export const TOOLS = [
    {
        name: 'get_context',
        scope: 'read',
        description: 'Start here. Returns the current local date and time, the user\'s time zone, what this token may do, the scheduling rules, and the labels in use.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        async run(ctx) {
            const { notes, events } = await loadWorkspace(ctx.db, ctx.userId);
            const now = parseLocal(ctx.now);
            return {
                now: ctx.now,
                weekday: now.toLocaleDateString('en', { weekday: 'long' }),
                time_zone: ctx.timezone || 'not set (times are treated as UTC until the user sets it in Minuet under Settings)',
                access: ctx.auth.scopes,
                date_format: 'All times are local wall-clock: YYYY-MM-DD for all-day, YYYY-MM-DDTHH:MM for timed. Never send UTC or offsets.',
                rules: [
                    'Every calendar task is suggested or committed. New tasks are suggested unless asked otherwise.',
                    'Suggested tasks may overlap. Only one committed task can hold a time.',
                    'When a committed task lands on suggested ones they are moved to the next free time that day, or taken off the calendar if the day is full. Write tools report this under "adjustments".',
                    'All-day tasks never clash.',
                    'Tasks are calendar events, notes with a due date, or checklist entries (to-dos) with a due date.',
                ],
                counts: { notes: notes.length, events: events.length, open_todos: (notes.find(note => note.id === TODO_NOTE_ID).items || []).filter(item => !item.done).length },
                labels: [...new Set(notes.flatMap(note => note.labels || []))].sort(),
            };
        },
    },
    {
        name: 'list_schedule',
        scope: 'read',
        description: 'Everything on the calendar between two dates (inclusive, at most 92 days): events, notes and to-dos, with repeating tasks expanded into their occurrences.',
        inputSchema: {
            type: 'object',
            properties: { from: whenSchema('First day, YYYY-MM-DD.'), to: whenSchema('Last day, YYYY-MM-DD.') },
            required: ['from', 'to'],
            additionalProperties: false,
        },
        async run(ctx, args) {
            const from = when(args, 'from', { required: true, dateOnly: true });
            const to = when(args, 'to', { required: true, dateOnly: true });
            if (to < from) throw new ToolError('“to” must not be before “from”.');
            const end = addDays(parseLocal(to), 1);
            if ((end - parseLocal(from)) / 86400000 > 93) throw new ToolError('Ask for at most 92 days at a time.');
            const { notes, events } = await loadWorkspace(ctx.db, ctx.userId);
            return {
                occurrences: expandEvents([...events, ...noteTasks(notes)], parseLocal(from), end).map(({ event: task, start, end: finish, key }) => ({
                    task_id: task.id,
                    kind: task.item ? 'todo' : task.note ? 'note' : 'event',
                    title: task.title || '(No title)',
                    start: task.allDay ? toYMD(start) : toLocalISO(start),
                    end: task.allDay ? toYMD(addDays(finish, -1)) : toLocalISO(finish),
                    all_day: !!task.allDay,
                    status: statusOf(task),
                    ...(task.repeat ? { repeat: task.repeat.freq, occurrence: key } : {}),
                    ...(task.item ? { done: !!task.item.done, note_id: task.note.id, todo_id: task.item.id } : {}),
                    ...(task.note && !task.item ? { note_id: task.note.id } : {}),
                })),
            };
        },
    },
    {
        name: 'find_free_time',
        scope: 'read',
        description: 'Free slots of at least the given length between two dates (inclusive, at most 31 days), within the given hours of each day. Past times today are skipped.',
        inputSchema: {
            type: 'object',
            properties: {
                from: whenSchema('First day, YYYY-MM-DD.'),
                to: whenSchema('Last day, YYYY-MM-DD.'),
                duration_minutes: { type: 'integer', minimum: 5, maximum: 1440 },
                earliest: { type: 'string', description: 'Start of the usable day, HH:MM. Default 08:00.' },
                latest: { type: 'string', description: 'End of the usable day, HH:MM. Default 20:00.' },
                avoid: { type: 'string', enum: ['all', 'committed'], description: 'all (default): avoid every timed task. committed: only avoid committed tasks, i.e. where a committed task could go.' },
            },
            required: ['from', 'to', 'duration_minutes'],
            additionalProperties: false,
        },
        async run(ctx, args) {
            const from = when(args, 'from', { required: true, dateOnly: true });
            const to = when(args, 'to', { required: true, dateOnly: true });
            const minutes = args.duration_minutes;
            if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) throw new ToolError('“duration_minutes” must be a whole number from 5 to 1440.');
            const earliest = args.earliest ?? '08:00';
            const latest = args.latest ?? '20:00';
            if (!TIME.test(earliest) || !TIME.test(latest) || latest <= earliest) throw new ToolError('“earliest” and “latest” must be HH:MM, with latest after earliest.');
            const avoid = choice(args, 'avoid', ['all', 'committed']) || 'all';
            if (to < from) throw new ToolError('“to” must not be before “from”.');
            if ((parseLocal(to) - parseLocal(from)) / 86400000 > 31) throw new ToolError('Ask for at most 31 days at a time.');

            const { notes, events } = await loadWorkspace(ctx.db, ctx.userId);
            const tasks = [...events, ...noteTasks(notes)].filter(task => !task.allDay && (avoid === 'all' || task.status === 'committed'));
            const busy = expandEvents(tasks, parseLocal(from), addDays(parseLocal(to), 1));
            const now = parseLocal(ctx.now);
            const slots = [];
            for (let day = parseLocal(from); toYMD(day) <= to && slots.length < 60; day = addDays(day, 1)) {
                const windowEnd = parseLocal(`${toYMD(day)}T${latest}`);
                let cursor = parseLocal(`${toYMD(day)}T${earliest}`);
                if (now > cursor) cursor = new Date(Math.ceil(now.getTime() / 300000) * 300000);   // next 5 minutes
                const dayBusy = busy.filter(o => o.start < windowEnd && o.end > cursor).sort((a, b) => a.start - b.start);
                for (const block of [...dayBusy, { start: windowEnd, end: windowEnd }]) {
                    if (block.start - cursor >= minutes * 60000) slots.push({ start: toLocalISO(cursor), end: toLocalISO(block.start) });
                    if (block.end > cursor) cursor = block.end;
                }
            }
            return { duration_minutes: minutes, free: slots };
        },
    },
    {
        name: 'list_notes',
        scope: 'read',
        description: 'The user\'s notes, in brief. Optionally filter by words they contain or by label. Use get_note for the full text or entries.',
        inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' }, label: { type: 'string' } },
            additionalProperties: false,
        },
        async run(ctx, args) {
            const words = (text(args, 'query') || '').toLowerCase().split(/\s+/).filter(Boolean);
            const label = (text(args, 'label') || '').toLowerCase();
            const { notes } = await loadWorkspace(ctx.db, ctx.userId);
            const matches = note => {
                const haystack = [note.title, note.text, ...(note.items || []).map(item => item.text), ...(note.labels || [])].join('\n').toLowerCase();
                return words.every(word => haystack.includes(word)) && (!label || (note.labels || []).some(l => l.toLowerCase() === label));
            };
            return {
                notes: notes.filter(matches).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map(note => ({
                    id: note.id,
                    title: note.title || '',
                    type: note.type === 'list' ? 'checklist' : 'text',
                    ...(note.type === 'list'
                        ? { entries: (note.items || []).length, open_entries: (note.items || []).filter(item => !item.done).length }
                        : { preview: (note.text || '').slice(0, 200) }),
                    labels: note.labels || [],
                    pinned_to_home: !!note.pinned,
                    ...taskFields(note),
                })),
            };
        },
    },
    {
        name: 'get_note',
        scope: 'read',
        description: 'One note in full: its text, or its checklist entries with their ids.',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
        async run(ctx, args) {
            return noteView(findNote(await loadWorkspace(ctx.db, ctx.userId), text(args, 'id', { required: true })));
        },
    },
    {
        name: 'list_todos',
        scope: 'read',
        description: 'The user\'s to-do list (the checklist on the Pomodoro page), including which to-do they are working on now.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        async run(ctx) {
            const note = findNote(await loadWorkspace(ctx.db, ctx.userId), TODO_NOTE_ID);
            return { note_id: note.id, working_on: note.current || null, todos: (note.items || []).map(item => entryView(note, item)) };
        },
    },
    {
        name: 'list_history',
        scope: 'read',
        description: 'Recent changes made through access tokens (newest first), each with an id that undo_change accepts.',
        inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
        async run(ctx, args) {
            return { changes: await listHistory(ctx.db, ctx.userId, Number.isInteger(args.limit) ? Math.min(args.limit, 100) : 20) };
        },
    },
    {
        name: 'add_event',
        scope: 'suggest',
        description: 'Add a calendar event. Give start as YYYY-MM-DD for an all-day event or YYYY-MM-DDTHH:MM for a timed one (end defaults to one hour later).',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                start: whenSchema('YYYY-MM-DD or YYYY-MM-DDTHH:MM.'),
                end: whenSchema('Same form as start. For all-day events this is the last day.'),
                repeat: { type: 'string', enum: REPEATS },
                until: whenSchema('Last date a repeating event occurs, YYYY-MM-DD.'),
                status: TASK_PROPERTIES.status,
                description: { type: 'string' },
                color: { type: 'string', enum: EVENT_COLORS },
            },
            required: ['title', 'start'],
            additionalProperties: false,
        },
        run(ctx, args) {
            const repeat = choice(args, 'repeat', REPEATS) || 'none';
            const until = when(args, 'until', { dateOnly: true });
            const status = choice(args, 'status', STATUSES) || 'suggested';
            if (status === 'committed') requireManage(ctx, 'Committing a task to a fixed time');
            const event = {
                id: crypto.randomUUID(),
                title: text(args, 'title', { required: true }).trim(),
                description: (text(args, 'description', { max: 5000 }) || '').trim(),
                color: choice(args, 'color', EVENT_COLORS) || EVENT_COLORS[0],
                ...eventTimes(args, null),
                status,
                repeat: repeat === 'none' ? null : { freq: repeat, until: until || null },
                exdates: [],
            };
            return mutate(ctx.db, ctx.userId, ctx.actor, draft => {
                draft.events.push(event);
                return { summary: `Added event “${event.title}”`, taskIds: [event.id], result: { id: event.id } };
            }).then(outcome => withLatest(ctx, outcome, ws => ({ event: viewOrGone(ws.events.find(e => e.id === event.id), eventView) })));
        },
    },
    {
        name: 'update_event',
        scope: 'suggest',
        description: 'Change a calendar event (the whole series if it repeats). Only the fields you pass change; moving start alone keeps the event\'s length.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                start: whenSchema('YYYY-MM-DD or YYYY-MM-DDTHH:MM.'),
                end: whenSchema('Same form as start.'),
                repeat: { type: 'string', enum: REPEATS },
                until: whenSchema('Last date it occurs, YYYY-MM-DD; "" for no end.'),
                status: TASK_PROPERTIES.status,
                description: { type: 'string' },
                color: { type: 'string', enum: EVENT_COLORS },
            },
            required: ['id'],
            additionalProperties: false,
        },
        run(ctx, args) {
            const id = text(args, 'id', { required: true });
            const title = text(args, 'title');
            const description = text(args, 'description', { max: 5000 });
            const color = choice(args, 'color', EVENT_COLORS);
            const repeat = choice(args, 'repeat', REPEATS);
            const until = when(args, 'until', { dateOnly: true });
            const status = choice(args, 'status', STATUSES);
            return mutate(ctx.db, ctx.userId, ctx.actor, draft => {
                const event = draft.events.find(candidate => candidate.id === id);
                if (!event) throw new ToolError(`There is no event with id “${id}”. Use list_schedule to find events.`);
                if (event.status === 'committed') requireManage(ctx, 'Changing a committed task');
                if (status === 'committed' && event.status !== 'committed') requireManage(ctx, 'Committing a task to a fixed time');
                const times = eventTimes(args, event);
                const next = { ...event, ...times };
                if (title !== undefined) next.title = title.trim();
                if (description !== undefined) next.description = description.trim();
                if (color) next.color = color;
                if (status) next.status = status;
                if (repeat !== undefined) next.repeat = repeat === 'none' ? null : { freq: repeat, until: (event.repeat && event.repeat.until) || null };
                if (until !== undefined && next.repeat) next.repeat = { ...next.repeat, until: until || null };
                // Skipped and moved occurrences belonged to the old times.
                if (times.start !== undefined && times.start !== event.start || repeat !== undefined && repeat !== repeatOf(event)) {
                    next.exdates = [];
                    delete next.moves;
                }
                draft.events = draft.events.map(existing => existing.id === id ? next : existing);
                return { summary: `Changed event “${next.title}”`, taskIds: [id], result: { id } };
            }).then(outcome => withLatest(ctx, outcome, ws => ({ event: viewOrGone(ws.events.find(e => e.id === id), eventView) })));
        },
    },
    {
        name: 'add_todo',
        scope: 'suggest',
        description: 'Add a to-do to the user\'s to-do list (or an entry to another checklist note via note_id). Give “due” to also put it on the calendar.',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string' },
                note_id: { type: 'string', description: 'A checklist note to add to instead of the to-do list.' },
                ...TASK_PROPERTIES,
                due: whenSchema('Optional. YYYY-MM-DD (all day) or YYYY-MM-DDTHH:MM (local time; takes 30 minutes).'),
            },
            required: ['text'],
            additionalProperties: false,
        },
        run(ctx, args) {
            const item = { id: crypto.randomUUID(), text: text(args, 'text', { max: 500, required: true }).trim(), done: false };
            if (args.due === '') throw new ToolError('Leave “due” out to add a to-do that isn\'t on the calendar.');
            applyTaskArgs(ctx, item, args);
            const noteId = text(args, 'note_id');
            return mutate(ctx.db, ctx.userId, ctx.actor, draft => {
                const note = findChecklist(draft, noteId);
                const next = { ...note, items: [...(note.items || []), item] };
                replaceNote(draft, next);
                return { summary: `Added to-do “${item.text}”` + (note.id === TODO_NOTE_ID ? '' : ` to “${note.title || 'a checklist'}”`), taskIds: [`item:${note.id}:${item.id}`], result: { note_id: note.id, id: item.id } };
            }).then(outcome => withLatest(ctx, outcome, ws => ({ todo: viewOrGone(entryOf(ws, outcome.result.note_id, item.id), entry => entryView({ id: outcome.result.note_id }, entry)) })));
        },
    },
    {
        name: 'update_todo',
        scope: 'suggest',
        description: 'Change a to-do or checklist entry: its text, whether it is done, or its place on the calendar. Only the fields you pass change.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'The to-do\'s id (from list_todos or get_note).' },
                note_id: { type: 'string', description: 'The checklist note it is in, if not the to-do list.' },
                text: { type: 'string' },
                done: { type: 'boolean' },
                ...TASK_PROPERTIES,
            },
            required: ['id'],
            additionalProperties: false,
        },
        run(ctx, args) {
            const id = text(args, 'id', { required: true });
            const noteId = text(args, 'note_id');
            const newText = text(args, 'text', { max: 500 });
            if (args.done !== undefined && typeof args.done !== 'boolean') throw new ToolError('“done” must be true or false.');
            return mutate(ctx.db, ctx.userId, ctx.actor, draft => {
                const note = findChecklist(draft, noteId);
                const item = (note.items || []).find(candidate => candidate.id === id);
                if (!item) throw new ToolError(`“${note.title || note.id}” has no entry with id “${id}”.`);
                const next = { ...item };
                if (newText !== undefined) {
                    if (!newText.trim()) throw new ToolError('“text” can\'t be empty; use delete_todo to remove a to-do.');
                    next.text = newText.trim();
                }
                if (args.done !== undefined) next.done = args.done;
                applyTaskArgs(ctx, next, args);
                const nextNote = { ...note, items: note.items.map(existing => existing.id === id ? next : existing) };
                if (next.done && note.current === id) nextNote.current = null;
                replaceNote(draft, nextNote);
                return { summary: `Changed to-do “${next.text}”`, taskIds: next.calendar ? [`item:${note.id}:${id}`] : [], result: { note_id: note.id, id } };
            }).then(outcome => withLatest(ctx, outcome, ws => ({ todo: viewOrGone(entryOf(ws, outcome.result.note_id, id), entry => entryView({ id: outcome.result.note_id }, entry)) })));
        },
    },
    {
        name: 'create_note',
        scope: 'suggest',
        description: 'Create a note: plain text, or a checklist if you pass “entries”. Give “due” to put the whole note on the calendar.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                text: { type: 'string', description: 'The body of a text note.' },
                entries: { type: 'array', items: { type: 'string' }, description: 'Makes it a checklist with these entries.' },
                labels: { type: 'array', items: { type: 'string' } },
                color: { type: 'string', enum: NOTE_COLORS },
                pinned_to_home: { type: 'boolean', description: 'Show it on the user\'s Notes home.' },
                ...TASK_PROPERTIES,
                due: whenSchema('Optional. YYYY-MM-DD (all day) or YYYY-MM-DDTHH:MM (local time; takes 30 minutes).'),
            },
            additionalProperties: false,
        },
        run(ctx, args) {
            const entries = args.entries;
            if (entries !== undefined && (!Array.isArray(entries) || entries.length > 200 || entries.some(entry => typeof entry !== 'string' || !entry.trim() || entry.length > 500))) {
                throw new ToolError('“entries” must be a list of up to 200 non-empty texts.');
            }
            if (entries && args.text) throw new ToolError('Pass either “text” or “entries”, not both.');
            const now = Date.now();
            const note = {
                id: crypto.randomUUID(),
                type: entries ? 'list' : 'text',
                title: (text(args, 'title') || '').trim(),
                text: entries ? '' : (text(args, 'text', { max: 200000 }) || ''),
                items: (entries || []).map(entry => ({ id: crypto.randomUUID(), text: entry.trim(), done: false })),
                color: choice(args, 'color', NOTE_COLORS) || 'default',
                labels: labels(args) || [],
                pinned: args.pinned_to_home === true,
                createdAt: now,
            };
            if (!note.title && !note.text.trim() && !note.items.length) throw new ToolError('Give the note a title, some text, or entries.');
            if (args.due === '') throw new ToolError('Leave “due” out for a note that isn\'t on the calendar.');
            applyTaskArgs(ctx, note, args);
            return mutate(ctx.db, ctx.userId, ctx.actor, draft => {
                draft.notes.push(note);
                return { summary: `Created note “${noteHeading(note)}”`, taskIds: taskIdsOf(note), result: { id: note.id } };
            }).then(outcome => withLatest(ctx, outcome, ws => ({ note: viewOrGone(ws.notes.find(n => n.id === note.id), noteView) })));
        },
    },
    {
        name: 'update_note',
        scope: 'suggest',
        description: 'Change a note\'s title, text, labels, colour, pin, or its place on the calendar. Only the fields you pass change. Use the to-do tools for checklist entries.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                text: { type: 'string', description: 'Replaces the whole body of a text note.' },
                labels: { type: 'array', items: { type: 'string' } },
                color: { type: 'string', enum: NOTE_COLORS },
                pinned_to_home: { type: 'boolean' },
                ...TASK_PROPERTIES,
            },
            required: ['id'],
            additionalProperties: false,
        },
        run(ctx, args) {
            const id = text(args, 'id', { required: true });
            const title = text(args, 'title');
            const body = text(args, 'text', { max: 200000 });
            const color = choice(args, 'color', NOTE_COLORS);
            const newLabels = labels(args);
            if (args.pinned_to_home !== undefined && typeof args.pinned_to_home !== 'boolean') throw new ToolError('“pinned_to_home” must be true or false.');
            return mutate(ctx.db, ctx.userId, ctx.actor, draft => {
                const note = findNote(draft, id);
                const next = { ...note };
                if (title !== undefined) next.title = title.trim();
                if (body !== undefined) {
                    if (note.type === 'list') throw new ToolError('This note is a checklist; change its entries with add_todo and update_todo (pass note_id).');
                    next.text = body;
                }
                if (color) next.color = color;
                if (newLabels) next.labels = newLabels;
                if (args.pinned_to_home !== undefined) next.pinned = args.pinned_to_home;
                applyTaskArgs(ctx, next, args);
                replaceNote(draft, next);
                return { summary: `Changed note “${noteHeading(next)}”`, taskIds: next.calendar ? [`note:${id}`] : [], result: { id } };
            }).then(outcome => withLatest(ctx, outcome, ws => ({ note: viewOrGone(ws.notes.find(n => n.id === id), noteView) })));
        },
    },
    {
        name: 'reschedule_task',
        scope: 'suggest',
        description: 'Move anything on the calendar to a new start, by the task_id from list_schedule; its length is kept. For one occurrence of a repeating task, also pass “occurrence” (the new start must be on that same day).',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: { type: 'string' },
                start: whenSchema('New start: YYYY-MM-DDTHH:MM, or YYYY-MM-DD for an all-day task.'),
                occurrence: whenSchema('The occurrence to move, YYYY-MM-DD, as given by list_schedule. Omit to move a one-off task or the whole series.'),
            },
            required: ['task_id', 'start'],
            additionalProperties: false,
        },
        run(ctx, args) {
            const taskId = text(args, 'task_id', { required: true });
            const start = when(args, 'start', { required: true });
            const occurrence = when(args, 'occurrence', { dateOnly: true });
            return mutate(ctx.db, ctx.userId, ctx.actor, draft => {
                const task = [...draft.events, ...noteTasks(draft.notes)].find(candidate => candidate.id === taskId);
                if (!task) throw new ToolError(`Nothing on the calendar has task_id “${taskId}”. Use list_schedule to find it.`);
                if (task.status === 'committed') requireManage(ctx, 'Moving a committed task');
                if (isDate(start) !== !!task.allDay) throw new ToolError(task.allDay ? 'This is an all-day task: give “start” as YYYY-MM-DD.' : 'This is a timed task: give “start” as YYYY-MM-DDTHH:MM.');

                let change;
                if (occurrence) {
                    if (!task.repeat) throw new ToolError('This task doesn\'t repeat; leave “occurrence” out.');
                    if (task.allDay) throw new ToolError('Single occurrences of all-day tasks can\'t be moved.');
                    const day = parseLocal(occurrence);
                    if (!expandEvents([task], day, addDays(day, 1)).some(o => o.key === occurrence)) throw new ToolError(`This task has no occurrence on ${occurrence}.`);
                    if (start.slice(0, 10) !== occurrence) throw new ToolError('A single occurrence can only be moved within its own day.');
                    change = source => ({ ...source, moves: { ...(source.moves || {}), [occurrence]: start } });
                } else if (task.note) {
                    change = source => { const next = { ...source, due: start }; delete next.exdates; delete next.moves; return next; };
                } else {
                    const times = eventTimes({ start }, task);
                    change = source => { const next = { ...source, ...times, exdates: [] }; delete next.moves; return next; };
                }

                if (task.item) {
                    replaceNote(draft, { ...task.note, items: task.note.items.map(item => item.id === task.item.id ? change(item) : item) });
                } else if (task.note) {
                    replaceNote(draft, change(task.note));
                } else {
                    draft.events = draft.events.map(event => event.id === taskId ? change(event) : event);
                }
                return { summary: `Moved “${task.title || '(No title)'}” to ${start}`, taskIds: [taskId], result: { task_id: taskId } };
            });
        },
    },
    {
        name: 'delete_event',
        scope: 'manage',
        description: 'Delete a calendar event (the whole series if it repeats).',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
        run(ctx, args) {
            const id = text(args, 'id', { required: true });
            return mutate(ctx.db, ctx.userId, ctx.actor, draft => {
                const event = draft.events.find(candidate => candidate.id === id);
                if (!event) throw new ToolError(`There is no event with id “${id}”.`);
                draft.events = draft.events.filter(candidate => candidate.id !== id);
                return { summary: `Deleted event “${event.title || '(No title)'}”`, result: { deleted: id } };
            });
        },
    },
    {
        name: 'delete_todo',
        scope: 'manage',
        description: 'Delete a to-do or checklist entry. To just tick it off, use update_todo with done: true instead.',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' }, note_id: { type: 'string', description: 'The checklist note it is in, if not the to-do list.' } },
            required: ['id'],
            additionalProperties: false,
        },
        run(ctx, args) {
            const id = text(args, 'id', { required: true });
            const noteId = text(args, 'note_id');
            return mutate(ctx.db, ctx.userId, ctx.actor, draft => {
                const note = findChecklist(draft, noteId);
                const item = (note.items || []).find(candidate => candidate.id === id);
                if (!item) throw new ToolError(`“${note.title || note.id}” has no entry with id “${id}”.`);
                replaceNote(draft, { ...note, items: note.items.filter(candidate => candidate.id !== id), ...(note.current === id ? { current: null } : {}) });
                return { summary: `Deleted to-do “${item.text}”`, result: { deleted: id } };
            });
        },
    },
    {
        name: 'delete_note',
        scope: 'manage',
        description: 'Delete a note. The to-do list and the distraction diary can\'t be deleted.',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
        run(ctx, args) {
            const id = text(args, 'id', { required: true });
            return mutate(ctx.db, ctx.userId, ctx.actor, draft => {
                const note = findNote(draft, id);
                if (isDefaultNote(note)) throw new ToolError('The to-do list and the distraction diary can\'t be deleted.');
                draft.notes = draft.notes.filter(candidate => candidate.id !== id);
                return { summary: `Deleted note “${noteHeading(note)}”`, result: { deleted: id } };
            });
        },
    },
    {
        name: 'undo_change',
        scope: 'manage',
        description: 'Undo one earlier change made through a token, by its id from list_history or from a write tool\'s “change_id”. Everything that change touched goes back to how it was before it.',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
        run(ctx, args) {
            return undo(ctx.db, ctx.userId, ctx.actor, text(args, 'id', { required: true }));
        },
    },
];

const entryOf = (workspace, noteId, itemId) => ((workspace.notes.find(note => note.id === noteId) || {}).items || []).find(item => item.id === itemId);
const viewOrGone = (item, view) => item ? view(item) : 'no longer on record (the scheduling rules removed it; see adjustments)';

/* Add the saved item, as it now is (the rules may have moved it), to a write's outcome. */
async function withLatest(ctx, outcome, describe) {
    return { ...outcome, result: { ...outcome.result, ...describe(await loadWorkspace(ctx.db, ctx.userId)) } };
}

/* What a write tool reports back: its own result, what the scheduling rules moved, and how to undo it. */
export function describeOutcome(outcome) {
    if (!outcome || !('adjustments' in outcome)) return outcome;
    return {
        ...outcome.result,
        ...(outcome.adjustments.length ? {
            adjustments: outcome.adjustments.map(move => ({
                task_id: move.task_id,
                title: move.title,
                from: toLocalISO(move.from),
                to: move.to ? toLocalISO(move.to) : 'taken off the calendar (no free time left that day)',
            })),
        } : {}),
        ...(outcome.historyId ? { change_id: outcome.historyId } : { note: 'Nothing needed changing.' }),
    };
}
