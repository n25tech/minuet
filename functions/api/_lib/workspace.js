import { jsonListStore } from '../_db_d1/docs.js';
import { fetchTodoListForUser } from '../_db_d1/todolist.js';
import { fetchNotesForUser } from '../_db_d1/notes.js';
import { TODO_NOTE_ID, DIARY_NOTE_ID, newDefaultNote, legacyTodoItems, noteTasks, settleTasks } from './core.js';

/*
 * Server-side changes to a user's notes and calendar (the two JSON documents the browser syncs).
 * Every change made here
 *   - is applied to the latest stored documents and saved with the same version check the
 *     browser's sync uses, retrying if a device saved in between, so nothing is overwritten;
 *   - goes through the same suggested/committed rules as the app (settleTasks);
 *   - is recorded in `history` with each item's before/after state, so it can be undone.
 */
const notebookStore = jsonListStore('notebook_state', 'notes');
const calendarStore = jsonListStore('calendar_state', 'events');
const MAX_HISTORY = 200;

/* A problem with the request itself (bad input, not allowed, conflict) - reported to the caller as is. */
export class ToolError extends Error {}

/*
 * The user's notes and events. The default Pomodoro notes are added in memory when missing,
 * bringing over the pre-notes to-do list and diary exactly as the app does on first load;
 * they are only stored once a change to the notes is saved, and creating them is not itself
 * recorded as a change.
 */
export async function loadWorkspace(db, userId) {
    const [notebook, calendar] = await Promise.all([notebookStore.fetch(db, userId), calendarStore.fetch(db, userId)]);
    const notes = [...notebook.notes];
    const missing = [TODO_NOTE_ID, DIARY_NOTE_ID].filter(id => !notes.some(note => note.id === id));
    if (missing.length) {
        const [todos, diary] = await Promise.all([fetchTodoListForUser(db, userId), fetchNotesForUser(db, userId)]);
        for (const id of missing) {
            notes.push({
                ...newDefaultNote(id),
                ...(id === TODO_NOTE_ID ? { items: legacyTodoItems(todos.list, () => crypto.randomUUID()) } : { text: diary.content || '' }),
            });
        }
    }
    return { notes, events: [...calendar.events], versions: { notes: notebook.version, events: calendar.version } };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function diff(kind, before, after) {
    const changes = [];
    const beforeById = new Map(before.map(item => [item.id, item]));
    const afterIds = new Set(after.map(item => item.id));
    for (const item of after) {
        const previous = beforeById.get(item.id);
        if (!previous || !same(previous, item)) changes.push({ kind, id: item.id, before: previous || null, after: item });
    }
    for (const item of before) if (!afterIds.has(item.id)) changes.push({ kind, id: item.id, before: item, after: null });
    return changes;
}

/*
 * Change the workspace. `change({ notes, events })` edits the two arrays in place (replacing items
 * rather than mutating them) and returns { summary, taskIds?, result? }: a one-line description for
 * the history, the calendar tasks it created or moved (so the scheduling rules run for them), and
 * whatever the caller wants back. It may run more than once, so it must give the same outcome each
 * time (create ids outside it). Throw ToolError to refuse.
 *
 * Returns { result, adjustments, historyId }; adjustments lists suggested tasks the rules moved.
 */
export async function mutate(db, userId, actor, change) {
    for (let attempt = 0; attempt < 5; attempt++) {
        const workspace = await loadWorkspace(db, userId);
        const draft = { notes: [...workspace.notes], events: [...workspace.events] };
        const { summary, taskIds = [], result } = await change(draft);

        const settled = settleTasks(draft.events, draft.notes, taskIds);
        // A committed task has to be given a free time by whoever asked for it, not quietly made suggested.
        const refused = settled.demoted.find(({ task }) => taskIds.includes(task.id));
        if (refused) {
            throw new ToolError(`“${refused.task.title || '(No title)'}” would overlap the committed task “${refused.blocker.title || '(No title)'}” (${refused.blocker.id}). `
                + 'Only one committed task can hold a time: choose another time or keep it suggested.');
        }

        // Stamp what changed so the app's sync treats it as the newest edit of that item.
        const now = Date.now();
        const stamp = (items, storedItems) => {
            const storedById = new Map(storedItems.map(item => [item.id, item]));
            return items.map(item => same(storedById.get(item.id), item) ? item : { ...item, updatedAt: now });
        };
        const notes = stamp(settled.notes, workspace.notes);
        const events = stamp(settled.events, workspace.events);
        const changes = [...diff('note', workspace.notes, notes), ...diff('event', workspace.events, events)];

        const adjustments = settled.moved.map(move => ({
            task_id: move.task.id,
            title: move.task.title || '(No title)',
            from: move.from,
            to: move.to,
        }));
        if (!changes.length) return { result, adjustments, historyId: null };

        const savedNotes = !changes.some(c => c.kind === 'note') || await notebookStore.save(db, userId, notes, workspace.versions.notes);
        if (!savedNotes) continue;   // a device saved first: start again from its version
        const savedEvents = !changes.some(c => c.kind === 'event') || await calendarStore.save(db, userId, events, workspace.versions.events);
        if (!savedEvents) continue;  // the notes are saved; re-running the change on them is harmless

        const historyId = crypto.randomUUID();
        await db.prepare('INSERT INTO history (id, user_id, at, actor, summary, changes) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(historyId, userId, now, actor, summary, JSON.stringify(changes)).run();
        await db.prepare(`DELETE FROM history WHERE user_id = ? AND id NOT IN
            (SELECT id FROM history WHERE user_id = ? ORDER BY at DESC, id LIMIT ?)`).bind(userId, userId, MAX_HISTORY).run();
        return { result, adjustments, historyId };
    }
    throw new ToolError('Your notes are being changed from another device right now. Try again in a moment.');
}

export async function listHistory(db, userId, limit = 50) {
    const { results } = await db.prepare(`SELECT id, at, actor, summary, changes, undone_at FROM history
        WHERE user_id = ? ORDER BY at DESC, id LIMIT ?`).bind(userId, Math.min(Math.max(1, limit), MAX_HISTORY)).all();
    return results.map(row => ({
        id: row.id,
        at: row.at,
        actor: row.actor,
        summary: row.summary,
        undone: !!row.undone_at,
        items: JSON.parse(row.changes).map(change => ({
            kind: change.kind,
            id: change.id,
            what: !change.before ? 'added' : !change.after ? 'deleted' : 'changed',
            title: (change.after || change.before).title || '',
        })),
    }));
}

/* Put every item a history entry touched back to how it was before that change. */
export async function undo(db, userId, actor, historyId) {
    const row = await db.prepare('SELECT summary, changes, undone_at FROM history WHERE id = ? AND user_id = ?').bind(historyId, userId).first();
    if (!row) throw new ToolError('No such change in the history.');
    if (row.undone_at) throw new ToolError('That change was already undone.');
    const changes = JSON.parse(row.changes);
    const outcome = await mutate(db, userId, actor, draft => {
        const taskIds = [];
        for (const change of changes) {
            const key = change.kind === 'note' ? 'notes' : 'events';
            draft[key] = draft[key].filter(item => item.id !== change.id);
            if (!change.before) continue;
            draft[key].push(change.before);
            taskIds.push(...(change.kind === 'note' ? noteTasks([change.before]).map(task => task.id) : [change.before.id]));
        }
        return { summary: `Undid: ${row.summary}`, taskIds, result: { undone: historyId } };
    });
    await db.prepare('UPDATE history SET undone_at = ? WHERE id = ? AND user_id = ?').bind(Date.now(), historyId, userId).run();
    return outcome;
}
