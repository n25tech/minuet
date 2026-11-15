/*
 * Calendar logic with no DOM: local date helpers, expanding repeating events into
 * occurrences, and laying out overlapping events side by side.
 *
 * Dates are stored as local wall-clock strings with no time zone ("floating" times):
 *   timed event:   start/end = "YYYY-MM-DDTHH:MM"
 *   all-day event: start/end = "YYYY-MM-DD" (end is the last day, inclusive)
 * An event may repeat: repeat = { freq: "daily" | "weekly" | "monthly" | "yearly", until: "YYYY-MM-DD" | null },
 * with exdates = ["YYYY-MM-DD", ...] listing occurrence start dates that were removed or replaced.
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
		// Skip straight to just before the range rather than walking from the first occurrence.
		const daysAhead = daysBetween(start, rangeStart) - spanDays;
		const perStep = { daily: 1, weekly: 7, monthly: 31, yearly: 366 }[freq];
		let n = Math.max(0, Math.floor(daysAhead / perStep) - 1);
		for (let steps = 0; steps < 800; steps++, n++) {
			const s = occurrenceStart(start, freq, n);
			if (!s) continue;
			if (s >= rangeEnd || (until && s >= until)) break;
			const e = endOf(s);
			const key = toYMD(s);
			if (e > rangeStart && !excluded.has(key)) occurrences.push({ event, start: s, end: e, key });
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
