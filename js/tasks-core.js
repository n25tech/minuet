/*
 * Notes-as-tasks logic with no DOM, shared by the browser and the server (the build copies this
 * file and calendar-core.js into functions/api/_lib/core.js): the default Pomodoro notes, which
 * notes and checklist entries are on the calendar, and applying the suggested/committed rules
 * to everything on the calendar at once.
 *
 * A note or a checklist entry is on the calendar when it has calendar: true and
 * due: "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM"; optionally repeat: { freq }, status: "committed"
 * (otherwise suggested), and exdates / moves for single occurrences of a repeating one.
 */

/*
 * The Pomodoro page's to-do list and distraction diary are two default notes, labelled
 * "pomodoro". They have fixed ids so every device (and the server) agrees on which notes
 * they are, and they can be edited like any other note but not deleted.
 */
const POMODORO_LABEL = "pomodoro";
const TODO_NOTE_ID = "pomodoro-todo";
const DIARY_NOTE_ID = "pomodoro-diary";
const isDefaultNote = note => note.id === TODO_NOTE_ID || note.id === DIARY_NOTE_ID;

function newDefaultNote(id) {
	const note = { id, title: "", text: "", items: [], color: "default", labels: [POMODORO_LABEL], pinned: false, createdAt: Date.now() };
	return id === TODO_NOTE_ID ? { ...note, type: "list", title: "To-do list" } : { ...note, type: "text", title: "Distraction diary" };
}

/*
 * Any other note labelled "pomodoro" can be used on the Pomodoro page too: checklists in the to-do panel
 * and plain notes in the diary panel. pomodoroNotes(notes, "list" | "text") lists the ones of a kind, the
 * default note first (even if its label was removed), then the rest by name.
 */
const hasPomodoroLabel = note => (note.labels || []).some(label => String(label).trim().toLowerCase() === POMODORO_LABEL);

function pomodoroNotes(notes, type) {
	const defaultId = type === "list" ? TODO_NOTE_ID : DIARY_NOTE_ID;
	const others = notes.filter(note => !isDefaultNote(note) && hasPomodoroLabel(note) && (note.type === "list") === (type === "list"))
		.sort((a, b) => noteHeading(a).localeCompare(noteHeading(b)));
	return [notes.find(note => note.id === defaultId) || newDefaultNote(defaultId), ...others];
}

/* To-do items as they were stored before the to-do list became a note ({ text, complete, ... }), as checklist entries. */
function legacyTodoItems(list, newId) {
	return (Array.isArray(list) ? list : []).filter(item => item && typeof item.text === "string").map(item => ({
		id: String(item.id || newId()),
		text: item.text,
		done: !!item.complete,
		...(item.due ? { due: item.due } : {}),
		...(item.calendar ? { calendar: true } : {}),
	}));
}

// Everything that puts a note or an entry on the calendar.
const TASK_FIELDS = ["calendar", "due", "repeat", "status", "exdates", "moves"];

const composeDue = (date, time) => date ? (time ? `${date}T${time}` : date) : "";

function clearTask(source) {
	for (const field of TASK_FIELDS) delete source[field];
}

function setRepeat(source, freq) {
	if (freq) source.repeat = { freq, until: null };
	else delete source.repeat;
	// Skipped and moved occurrences belonged to the old pattern.
	delete source.exdates;
	delete source.moves;
}

function setStatus(source, status) {
	if (status === "committed") source.status = "committed";
	else delete source.status;
}

/* What a note is called where there is only room for one line (calendar entries). */
function noteHeading(note) {
	return note.title || (note.text || "").trim().split("\n")[0] || ((note.items || [])[0] || {}).text || "(Untitled note)";
}

/*
 * Everything the notes put on the calendar, as tasks in the calendar's own shape (see calendar-core.js):
 * whole notes that were added to it (id "note:<note id>") and single checklist entries that were
 * (id "item:<note id>:<entry id>", with `item` set). A timed one takes half an hour.
 */
function noteTasks(notes) {
	const tasks = [];
	const add = (id, note, item, title, source) => {
		const timed = source.due.includes("T");
		const start = parseLocal(source.due);
		if (Number.isNaN(start.getTime())) return;
		tasks.push({
			id, note, item, title,
			allDay: !timed,
			start: source.due,
			end: timed ? toLocalISO(new Date(start.getTime() + 30 * 60 * 1000)) : source.due,
			repeat: source.repeat || null,
			exdates: source.exdates,
			moves: source.moves,
			status: source.status,
		});
	};
	for (const note of notes) {
		if (note.calendar && typeof note.due === "string") add(`note:${note.id}`, note, null, noteHeading(note), note);
		if (note.type !== "list") continue;
		for (const item of note.items || []) {
			if (item.calendar && typeof item.due === "string") add(`item:${note.id}:${item.id}`, note, item, item.text, item);
		}
	}
	return tasks;
}

/* A note or entry after the schedule moved it, took it off the calendar, or made it suggested. */
function rescheduled(source, patch, demote) {
	const next = { ...source };
	if (demote) delete next.status;
	if (patch && patch.removed) clearTask(next);
	else if (patch) {
		if (patch.start) next.due = patch.start;
		if (patch.moves) next.moves = patch.moves;
		if (patch.exdates) next.exdates = patch.exdates;
	}
	return next;
}

/*
 * Apply the suggested/committed rules (resolveSchedule) after the tasks `changedIds` were saved,
 * across the events and the notes together. Returns new `events` and `notes` arrays in which only
 * the affected items are new objects (a suggested event with no room left is dropped), plus
 * resolveSchedule's `moved` and `demoted` lists describing what happened.
 */
function settleTasks(events, notes, changedIds) {
	const result = resolveSchedule([...events, ...noteTasks(notes)], changedIds);
	const demotedIds = new Set(result.demoted.map(({ task }) => task.id));
	const touched = id => result.patches.has(id) || demotedIds.has(id);
	const nextEvents = [];
	for (const event of events) {
		const patch = result.patches.get(event.id);
		if (patch && patch.removed) continue;
		nextEvents.push(touched(event.id) ? { ...event, ...patch, ...(demotedIds.has(event.id) ? { status: "suggested" } : {}) } : event);
	}
	const nextNotes = notes.map(note => {
		const noteId = `note:${note.id}`;
		const itemId = item => `item:${note.id}:${item.id}`;
		if (!touched(noteId) && !(note.items || []).some(item => touched(itemId(item)))) return note;
		const next = touched(noteId) ? rescheduled(note, result.patches.get(noteId), demotedIds.has(noteId)) : { ...note };
		next.items = (note.items || []).map(item => touched(itemId(item)) ? rescheduled(item, result.patches.get(itemId(item)), demotedIds.has(itemId(item))) : item);
		return next;
	});
	return { events: nextEvents, notes: nextNotes, moved: result.moved, demoted: result.demoted };
}
