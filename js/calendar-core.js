/*
 * Calendar logic with no DOM: local date helpers, expanding repeating events into
 * occurrences, and laying out overlapping events side by side.
 *
 * Dates are stored as local wall-clock strings with no time zone ("floating" times):
 *   timed event:   start/end = "YYYY-MM-DDTHH:MM"
 *   all-day event: start/end = "YYYY-MM-DD" (end is the last day, inclusive)
 * An event may repeat: repeat = { freq: "daily" | "weekly" | "monthly" | "yearly", until: "YYYY-MM-DD" | null },
 * with exdates = ["YYYY-MM-DD", ...] listing occurrence start dates that were removed or replaced, and
 * moves = { "YYYY-MM-DD": "YYYY-MM-DDTHH:MM" } giving single occurrences a different start (same day).
 *
 * Anything on the calendar is a "task" in this shape - events, and the notes and checklist entries
 * added to the calendar. A task's status is "committed" (a fixed time; only one committed task can
 * occupy a time) or anything else, meaning suggested (movable; any number can share a time).
 * See resolveSchedule.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const pad2 = n => String(n).padStart(2, "0");

function toYMD(date) {
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function toHM(date) {
	return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function toLocalISO(date) {
	return `${toYMD(date)}T${toHM(date)}`;
}

/* Parse "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" as local time. */
function parseLocal(text) {
	const [datePart, timePart = "00:00"] = String(text).split("T");
	const [year, month, day] = datePart.split("-").map(Number);
	const [hour, minute] = timePart.split(":").map(Number);
	return new Date(year, month - 1, day, hour || 0, minute || 0);
}

function startOfDay(date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes());
}

/* Whole days from a to b, ignoring the time of day (and so daylight-saving shifts). */
function daysBetween(a, b) {
	return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS);
}

/* The first occurrence's bounds as Dates; end is exclusive (an all-day event ends at the next midnight). */
function eventBounds(event) {
	const start = parseLocal(event.start);
	const end = event.allDay ? addDays(parseLocal(event.end || event.start), 1) : parseLocal(event.end || event.start);
	return { start, end: end > start ? end : new Date(start.getTime() + 60 * 1000) };
}

/* Start of the n-th occurrence (n = 0 is the event itself), or null when that date doesn't exist (e.g. 31 Feb). */
function occurrenceStart(start, freq, n) {
	const [y, m, d, h, min] = [start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()];
	if (freq === "daily") return new Date(y, m, d + n, h, min);
	if (freq === "weekly") return new Date(y, m, d + 7 * n, h, min);
	const date = freq === "monthly" ? new Date(y, m + n, d, h, min) : new Date(y + n, m, d, h, min);
	return date.getDate() === d ? date : null;
}

const REPEAT_FREQS = ["daily", "weekly", "monthly", "yearly"];

/*
 * Every occurrence of `events` overlapping [rangeStart, rangeEnd), as
 * { event, start, end, key } sorted by start. `key` is the occurrence's start date (YYYY-MM-DD).
 */
function expandEvents(events, rangeStart, rangeEnd) {
	const occurrences = [];
	for (const event of events) {
		if (!event || !event.start) continue;
		const { start, end } = eventBounds(event);
		if (Number.isNaN(start.getTime())) continue;
		const spanDays = daysBetween(start, end);
		const endOf = s => new Date(s.getFullYear(), s.getMonth(), s.getDate() + spanDays, end.getHours(), end.getMinutes());
		const freq = event.repeat && REPEAT_FREQS.includes(event.repeat.freq) ? event.repeat.freq : null;
		if (!freq) {
			if (start < rangeEnd && end > rangeStart) occurrences.push({ event, start, end, key: toYMD(start) });
			continue;
		}
		const until = event.repeat.until ? addDays(parseLocal(event.repeat.until), 1) : null;
		const excluded = new Set(event.exdates || []);
		const moves = event.moves || {};
		// Skip straight to just before the range rather than walking from the first occurrence.
		const daysAhead = daysBetween(start, rangeStart) - spanDays;
		const perStep = { daily: 1, weekly: 7, monthly: 31, yearly: 366 }[freq];
		let n = Math.max(0, Math.floor(daysAhead / perStep) - 1);
		for (let steps = 0; steps < 800; steps++, n++) {
			const regular = occurrenceStart(start, freq, n);
			if (!regular) continue;
			if (regular >= rangeEnd || (until && regular >= until)) break;
			const key = toYMD(regular);
			if (excluded.has(key)) continue;
			// A moved occurrence keeps its length.
			const s = moves[key] ? parseLocal(moves[key]) : regular;
			const e = moves[key] ? new Date(s.getTime() + (endOf(regular) - regular)) : endOf(regular);
			if (e > rangeStart && s < rangeEnd) occurrences.push({ event, start: s, end: e, key });
		}
	}
	return occurrences.sort((a, b) => a.start - b.start || b.end - a.end);
}

/*
 * Lay out timed segments of one day ({ startMin, endMin, ... }) so overlapping ones sit side by side.
 * Sets `col` (0-based column) and `cols` (columns in its overlap group) on each segment.
 */
function layoutDay(segments) {
	const sorted = [...segments].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
	let group = [];
	let groupEnd = -1;
	let columnEnds = [];
	const closeGroup = () => { for (const segment of group) segment.cols = columnEnds.length; };
	for (const segment of sorted) {
		if (segment.startMin >= groupEnd) {
			closeGroup();
			group = [];
			columnEnds = [];
		}
		let col = columnEnds.findIndex(end => end <= segment.startMin);
		if (col === -1) col = columnEnds.length;
		columnEnds[col] = segment.endMin;
		segment.col = col;
		group.push(segment);
		groupEnd = Math.max(groupEnd, segment.endMin);
	}
	closeGroup();
	return sorted;
}

// How far ahead a repeating task's occurrences are checked for clashes when it is saved.
const SCHEDULE_HORIZON_DAYS = 180;

/*
 * Enforce the suggested/committed rules after the tasks `changedIds` were saved. Only timed tasks
 * take part (all-day ones never clash). Returns what has to change, without changing anything:
 *   demoted: [{ task, blocker, at }]  a changed committed task overlaps another committed task, so it
 *                                     can't be committed; it is treated as suggested below
 *   moved:   [{ task, key, from, to }] a suggested occurrence overlapped a committed one and moves to
 *                                     the next time that day free of committed tasks; to is null when
 *                                     there is no room left that day and it comes off the calendar
 *   patches: Map(task id -> { start, end } | { moves, exdates } | { removed: true })  the same moves,
 *                                     as changes to the stored tasks
 */
function resolveSchedule(tasks, changedIds) {
	const result = { demoted: [], moved: [], patches: new Map() };
	const timed = tasks.filter(task => task && task.start && !task.allDay);
	const changed = timed.filter(task => changedIds.includes(task.id));
	if (!changed.length) return result;

	// The days the changed tasks touch.
	let from = null;
	let to = null;
	for (const task of changed) {
		const { start, end } = eventBounds(task);
		const first = startOfDay(start);
		let last = addDays(startOfDay(end), 1);
		if (task.repeat) {
			last = addDays(first, SCHEDULE_HORIZON_DAYS);
			if (task.repeat.until && addDays(parseLocal(task.repeat.until), 1) < last) last = addDays(parseLocal(task.repeat.until), 1);
		}
		if (!from || first < from) from = first;
		if (!to || last > to) to = last;
	}

	const overlaps = (a, b) => a.start < b.end && b.start < a.end;
	const demoted = new Set();
	const isCommitted = task => task.status === "committed" && !demoted.has(task);
	let committed = expandEvents(timed.filter(isCommitted), from, to);
	for (const task of changed.filter(isCommitted)) {
		for (const occurrence of committed) {
			if (occurrence.event !== task) continue;
			const clash = committed.find(other => other.event !== task && !demoted.has(other.event) && overlaps(occurrence, other));
			if (!clash) continue;
			demoted.add(task);
			result.demoted.push({ task, blocker: clash.event, at: occurrence.start });
			break;
		}
	}
	committed = committed.filter(occurrence => !demoted.has(occurrence.event));
	if (!committed.length) return result;

	for (const occurrence of expandEvents(timed.filter(task => !isCommitted(task)), from, to)) {
		const blocker = committed.find(other => overlaps(occurrence, other));
		if (!blocker) continue;
		const task = occurrence.event;
		const length = occurrence.end - occurrence.start;
		const dayEnd = addDays(startOfDay(occurrence.start), 1);
		let start = blocker.end;
		for (;;) {
			const end = new Date(start.getTime() + length);
			if (end > dayEnd) {
				start = null;
				break;
			}
			const next = committed.find(other => other.start < end && start < other.end);
			if (!next) break;
			start = next.end;
		}
		result.moved.push({ task, key: occurrence.key, from: occurrence.start, to: start });
		const patch = result.patches.get(task.id) || {};
		if (task.repeat) {
			// One occurrence of a series: reschedule or skip just that one.
			patch.moves = { ...(patch.moves || task.moves || {}) };
			patch.exdates = [...(patch.exdates || task.exdates || [])];
			if (start) patch.moves[occurrence.key] = toLocalISO(start);
			else patch.exdates.push(occurrence.key);
		} else if (start) {
			patch.start = toLocalISO(start);
			patch.end = toLocalISO(new Date(start.getTime() + length));
		} else {
			patch.removed = true;
		}
		result.patches.set(task.id, patch);
	}
	return result;
}
