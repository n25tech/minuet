/*
 * Calendar: month, week and day views over the user's events, plus the notes and checklist
 * entries that were added to the calendar (read live from notebook.js, never copied).
 *
 * Events are { id, title, start, end, allDay, repeat, exdates, color, description, updatedAt }
 * (formats in calendar-core.js), synced to the backend when signed in (see sync.js) and
 * stored in localStorage otherwise.
 */

const EVENT_COLORS = ["green", "blue", "red", "orange", "purple", "slate"];
const CALENDAR_VIEWS = ["month", "week", "day"];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_HEIGHT = 48;   // px per hour in the week/day grid (matches --hour-height in calendar.css)
const MAX_MONTH_CHIPS = 3;

const formatTime = date => date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const formatHour = hour => new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" });

class CalendarView {
	constructor() {
		this.root = document.getElementById("calendar-root");
		this.dialog = document.getElementById("event-dialog");
		const savedView = localStorage.getItem("calendar_view");
		this.view = CALENDAR_VIEWS.includes(savedView) ? savedView : "month";
		this.cursor = startOfDay(new Date());
		this.scrollTop = null;   // week/day scroll position, kept across redraws
		this.editing = null;   // { event, key, start } while an existing event is open in the dialog
		this.store = new SyncedList({
			endpoint: "/api/storage/calendar",
			field: "events",
			localKey: "calendar",
			onChange: () => this.render(),
		});
	}

	init() {
		this._bindDialog();
		this.store.init();
		document.addEventListener("minuet:notes", () => this.render());
		document.addEventListener("minuet:view", event => { if (event.detail === "calendar") this.render(); });
		// Keep "today" and the current-time line fresh.
		setInterval(() => { if (!this.root.closest("[hidden]") && !this.dialog.open) this.render(); }, 60 * 1000);
		this.render();
		return this;
	}

	/* ---------- Navigation ---------- */

	setView(view) {
		this.view = view;
		localStorage.setItem("calendar_view", view);
		this.scrollTop = null;
		this.render();
	}

	/* Open the calendar on a given date (used by the to-do list's due-date links). */
	goTo(date, view) {
		this.cursor = startOfDay(date);
		if (view) this.view = view;
		this.scrollTop = null;
		if (currentView() === "calendar") this.render();
		else location.hash = "#/calendar";
	}

	step(direction) {
		const c = this.cursor;
		if (this.view === "month") this.cursor = new Date(c.getFullYear(), c.getMonth() + direction, 1);
		else this.cursor = addDays(c, direction * (this.view === "week" ? 7 : 1));
		this.render();
	}

	/* First day shown and number of days shown for the current view. */
	range() {
		const c = this.cursor;
		if (this.view === "day") return { start: c, days: 1 };
		if (this.view === "week") return { start: addDays(c, -c.getDay()), days: 7 };
		const first = new Date(c.getFullYear(), c.getMonth(), 1);
		return { start: addDays(first, -first.getDay()), days: 42 };
	}

	title() {
		const { start, days } = this.range();
		if (this.view === "month") return this.cursor.toLocaleDateString([], { month: "long", year: "numeric" });
		if (this.view === "day") return this.cursor.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
		return new Intl.DateTimeFormat([], { day: "numeric", month: "short", year: "numeric" }).formatRange(start, addDays(start, days - 1));
	}

	/* ---------- Data ---------- */

	/* Everything shown in [start, end): event occurrences and calendar to-dos, in one shape. */
	occurrences(start, end) {
		const items = expandEvents(this.store.items, start, end).map(occurrence => ({
			...occurrence,
			title: occurrence.event.title || "(No title)",
			allDay: !!occurrence.event.allDay,
			color: EVENT_COLORS.includes(occurrence.event.color) ? occurrence.event.color : EVENT_COLORS[0],
		}));
		// Notes, and single checklist entries, that were added to the calendar.
		for (const entry of notebook.calendarEntries()) {
			const timed = entry.due.includes("T");
			const due = parseLocal(entry.due);
			if (Number.isNaN(due.getTime())) continue;
			const dueEnd = timed ? new Date(due.getTime() + 30 * 60 * 1000) : addDays(due, 1);
			if (due < end && dueEnd > start) items.push({ entry, title: entry.title, start: due, end: dueEnd, allDay: !timed, key: toYMD(due) });
		}
		return items.sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start));
	}

	/* ---------- Rendering ---------- */

	render() {
		if (!this.root) return;
		const body = this.root.querySelector(".cal-grid-scroll");
		if (body && body.clientHeight) this.scrollTop = body.scrollTop;
		const { start, days } = this.range();
		const occurrences = this.occurrences(start, addDays(start, days));
		this.root.replaceChildren(
			this._toolbar(),
			this.view === "month" ? this._monthGrid(start, occurrences) : this._timeGrid(start, days, occurrences),
		);
		const newBody = this.root.querySelector(".cal-grid-scroll");
		if (newBody && newBody.clientHeight) {
			if (this.scrollTop === null) this.scrollTop = 6.75 * HOUR_HEIGHT;   // open around the start of the working day
			newBody.scrollTop = this.scrollTop;
		}
	}

	_toolbar() {
		return el("div", { class: "cal-toolbar" },
			el("button", { type: "button", onclick: () => { this.cursor = startOfDay(new Date()); this.scrollTop = null; this.render(); } }, "Today"),
			el("button", { type: "button", class: "icon-button", "aria-label": `Previous ${this.view}`, onclick: () => this.step(-1) }, "‹"),
			el("button", { type: "button", class: "icon-button", "aria-label": `Next ${this.view}`, onclick: () => this.step(1) }, "›"),
			el("h2", { class: "cal-title" }, this.title()),
			el("span", { class: "spacer" }),
			el("div", { class: "segmented", role: "group", "aria-label": "Calendar view" }, CALENDAR_VIEWS.map(view => el("button", {
				type: "button",
				"aria-pressed": String(view === this.view),
				onclick: () => this.setView(view),
			}, view[0].toUpperCase() + view.slice(1)))),
			el("button", { type: "button", class: "primary", onclick: () => this.newEvent(this._defaultStart()) }, "+ Event"));
	}

	/* A new event from the toolbar starts at the next full hour of the day being looked at (today if it is in view). */
	_defaultStart() {
		const now = new Date();
		const { start, days } = this.range();
		const day = now >= start && now < addDays(start, days) ? startOfDay(now) : (this.view === "month" ? new Date(this.cursor.getFullYear(), this.cursor.getMonth(), 1) : this.cursor);
		return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.min(now.getHours() + 1, 23));
	}

	_onDay(occurrences, day) {
		const next = addDays(day, 1);
		return occurrences.filter(occurrence => occurrence.start < next && occurrence.end > day);
	}

	/* A compact one-line entry (month cells and the all-day row). */
	_chip(occurrence, day) {
		if (occurrence.entry) return this._entryChip(occurrence);
		const solid = occurrence.allDay || occurrence.end - occurrence.start >= DAY_MS;
		const startsToday = !day || toYMD(occurrence.start) === toYMD(day);
		const time = solid || !startsToday ? "" : formatTime(occurrence.start) + " ";
		return el("button", {
			type: "button",
			class: "cal-chip" + (solid ? " solid" : ""),
			dataset: { color: occurrence.color },
			title: occurrence.title,
			onclick: event => { event.stopPropagation(); this.editEvent(occurrence); },
		}, solid ? null : el("span", { class: "cal-dot" }), time + occurrence.title);
	}

	/* A note (opens the note) or a checklist entry (can be ticked off right here). */
	_entryChip(occurrence) {
		return this._entry(occurrence, "cal-chip", (occurrence.allDay ? "" : formatTime(occurrence.start) + " ") + occurrence.title);
	}

	_entry(occurrence, kind, text, style) {
		const { note, item } = occurrence.entry;
		if (!item) {
			return el("button", {
				type: "button",
				class: `${kind} note`,
				style,
				dataset: { color: note.color || "default" },
				title: `Note: ${occurrence.title}`,
				onclick: event => { event.stopPropagation(); notebook.show(note.id); },
			}, icon("label", 12), el("span", {}, text));
		}
		return el("label", {
			class: `${kind} todo` + (item.done ? " complete" : ""),
			style,
			title: `${note.title || "Checklist"}: ${item.text}`,
			onclick: event => event.stopPropagation(),
		},
			el("input", { type: "checkbox", checked: !!item.done, onchange: () => notebook.toggleItem(note.id, item.id) }),
			el("span", {}, text));
	}

	_monthGrid(start, occurrences) {
		const today = toYMD(new Date());
		const grid = el("div", { class: "cal-month" });
		grid.append(...WEEKDAY_NAMES.map(name => el("div", { class: "cal-weekday" }, name)));
		for (let i = 0; i < 42; i++) {
			const day = addDays(start, i);
			const items = this._onDay(occurrences, day);
			const shown = items.length > MAX_MONTH_CHIPS ? items.slice(0, MAX_MONTH_CHIPS - 1) : items;
			const classes = ["cal-cell"];
			if (day.getMonth() !== this.cursor.getMonth()) classes.push("other-month");
			if (toYMD(day) === today) classes.push("today");
			grid.append(el("div", {
				class: classes.join(" "),
				onclick: () => this.newEvent(day, true),
			},
				el("button", {
					type: "button",
					class: "cal-daynum",
					"aria-label": day.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }),
					onclick: event => { event.stopPropagation(); this.goTo(day, "day"); },
				}, day.getDate() === 1 ? day.toLocaleDateString([], { day: "numeric", month: "short" }) : String(day.getDate())),
				shown.map(occurrence => this._chip(occurrence, day)),
				items.length > shown.length ? el("button", {
					type: "button",
					class: "cal-more",
					onclick: event => { event.stopPropagation(); this.goTo(day, "day"); },
				}, `+${items.length - shown.length} more`) : null));
		}
		return grid;
	}

	_timeGrid(start, days, occurrences) {
		const now = new Date();
		const today = toYMD(now);
		const dayList = Array.from({ length: days }, (_, i) => addDays(start, i));
		const columns = `var(--gutter) repeat(${days}, minmax(0, 1fr))`;

		const head = el("div", { class: "cal-grid-head", style: { gridTemplateColumns: columns } }, el("div"));
		const allDayRow = el("div", { class: "cal-allday", style: { gridTemplateColumns: columns } }, el("div", { class: "cal-gutter-label" }, "all-day"));
		const body = el("div", { class: "cal-grid-body", style: { gridTemplateColumns: columns } });
		body.append(el("div", { class: "cal-hours" }, Array.from({ length: 24 }, (_, hour) => el("div", { class: "cal-hour" }, hour ? el("span", {}, formatHour(hour)) : null))));

		for (const day of dayList) {
			const isToday = toYMD(day) === today;
			head.append(el("button", {
				type: "button",
				class: "cal-dayhead" + (isToday ? " today" : ""),
				onclick: () => this.goTo(day, "day"),
			}, el("span", {}, WEEKDAY_NAMES[day.getDay()]), el("strong", {}, String(day.getDate()))));

			const items = this._onDay(occurrences, day);
			const isBlock = occurrence => occurrence.allDay || occurrence.end - occurrence.start >= DAY_MS;
			allDayRow.append(el("div", { class: "cal-allday-cell", onclick: () => this.newEvent(day, true) },
				items.filter(isBlock).map(occurrence => this._chip(occurrence, day))));

			const nextDay = addDays(day, 1);
			const segments = layoutDay(items.filter(occurrence => !isBlock(occurrence)).map(occurrence => {
				const startMin = occurrence.start <= day ? 0 : occurrence.start.getHours() * 60 + occurrence.start.getMinutes();
				const endMin = occurrence.end >= nextDay ? 1440 : occurrence.end.getHours() * 60 + occurrence.end.getMinutes();
				// Give short entries enough height to be readable and clickable.
				return { occurrence, startMin, endMin: Math.max(endMin, Math.min(startMin + 25, 1440)) };
			}));
			const column = el("div", {
				class: "cal-daycol" + (isToday ? " today" : ""),
				onclick: event => {
					const y = event.clientY - column.getBoundingClientRect().top;
					const minutes = Math.max(0, Math.min(23 * 60, Math.floor(y / HOUR_HEIGHT * 2) * 30));
					this.newEvent(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes));
				},
			}, segments.map(segment => this._block(segment)));
			if (isToday) {
				column.append(el("div", { class: "cal-now", style: { top: `${(now.getHours() * 60 + now.getMinutes()) / 1440 * 100}%` } }));
			}
			body.append(column);
		}
		return el("div", { class: "cal-grid" }, head, allDayRow, el("div", { class: "cal-grid-scroll" }, body));
	}

	/* A positioned block in a week/day column. */
	_block({ occurrence, startMin, endMin, col, cols }) {
		const style = {
			top: `${startMin / 1440 * 100}%`,
			height: `${(endMin - startMin) / 1440 * 100}%`,
			left: `${col / cols * 100}%`,
			width: `${100 / cols}%`,
		};
		const range = `${formatTime(occurrence.start)} – ${formatTime(occurrence.end)}`;
		if (occurrence.entry) return this._entry(occurrence, "cal-block", `${occurrence.title} · ${formatTime(occurrence.start)}`, style);
		// Under 45 minutes there is only room for one line.
		const short = endMin - startMin < 45;
		return el("button", {
			type: "button",
			class: "cal-block" + (short ? " short" : ""),
			style,
			dataset: { color: occurrence.color },
			title: `${occurrence.title}\n${range}`,
			onclick: event => { event.stopPropagation(); this.editEvent(occurrence); },
		}, el("strong", {}, occurrence.title), el("span", {}, short ? formatTime(occurrence.start) : range));
	}

	/* ---------- Event dialog ---------- */

	newEvent(start, allDay = false) {
		const end = allDay ? start : new Date(start.getTime() + 60 * 60 * 1000);
		this._openDialog(null, { title: "", description: "", color: EVENT_COLORS[0], allDay, repeat: null }, start, end);
	}

	editEvent(occurrence) {
		const { event, start, end, key } = occurrence;
		// For an all-day event the stored end is its last day, while occurrence.end is the midnight after it.
		this._openDialog({ event, key, start }, event, start, event.allDay ? addDays(end, -1) : end);
	}

	_field(id) {
		return document.getElementById(`event-${id}`);
	}

	_openDialog(editing, event, start, end) {
		this.editing = editing;
		this.dialogColor = EVENT_COLORS.includes(event.color) ? event.color : EVENT_COLORS[0];
		this._field("title").value = event.title || "";
		this._field("allday").checked = !!event.allDay;
		this._field("start-date").value = toYMD(start);
		this._field("end-date").value = toYMD(end);
		// An all-day event still gets sensible times in case "All day" is switched off.
		this._field("start-time").value = event.allDay ? "09:00" : toHM(start);
		this._field("end-time").value = event.allDay ? "10:00" : toHM(end);
		this._field("repeat").value = (event.repeat && event.repeat.freq) || "";
		this._field("until").value = (event.repeat && event.repeat.until) || "";
		this._field("description").value = event.description || "";
		this._field("delete").hidden = !editing;
		const scope = this._field("scope");
		scope.hidden = !(editing && editing.event.repeat);
		scope.querySelector('input[value="this"]').checked = true;
		this._field("error").hidden = true;
		this.previousStart = this._readStart();
		this._syncDialog();
		this.dialog.showModal();
		this._field("title").focus();
	}

	_readStart() {
		return parseLocal(`${this._field("start-date").value}T${this._field("start-time").value || "00:00"}`);
	}

	_scope() {
		return this.dialog.querySelector('input[name="event-scope"]:checked').value;
	}

	/* Show only the fields that apply to the current choices. */
	_syncDialog() {
		const allDay = this._field("allday").checked;
		this._field("start-time").hidden = allDay;
		this._field("end-time").hidden = allDay;
		// Changing one occurrence of a series can't change how the series repeats.
		const single = !this._field("scope").hidden && this._scope() === "this";
		this._field("repeat").closest(".field-row").hidden = single;
		this._field("until-field").hidden = !this._field("repeat").value;
		document.querySelectorAll("#event-colors button").forEach(button => {
			button.setAttribute("aria-pressed", String(button.dataset.color === this.dialogColor));
		});
	}

	_bindDialog() {
		this._field("colors").replaceChildren(...EVENT_COLORS.map(color => el("button", {
			type: "button",
			class: "swatch",
			dataset: { color },
			title: color[0].toUpperCase() + color.slice(1),
			"aria-label": color,
			onclick: () => { this.dialogColor = color; this._syncDialog(); },
		})));
		for (const id of ["allday", "repeat"]) this._field(id).addEventListener("change", () => this._syncDialog());
		this._field("scope").addEventListener("change", () => this._syncDialog());
		// Moving the start keeps the event's length, as in Google Calendar.
		for (const id of ["start-date", "start-time"]) {
			this._field(id).addEventListener("change", () => {
				const start = this._readStart();
				const end = parseLocal(`${this._field("end-date").value}T${this._field("end-time").value || "00:00"}`);
				const previous = this.previousStart;
				if (previous && ![start, end, previous].some(date => Number.isNaN(date.getTime()))) {
					const moved = new Date(end.getTime() + (start - previous));
					this._field("end-date").value = toYMD(moved);
					this._field("end-time").value = toHM(moved);
				}
				this.previousStart = start;
			});
		}
		this._field("cancel").addEventListener("click", () => this.dialog.close());
		this._field("delete").addEventListener("click", () => this._delete());
		this._field("form").addEventListener("submit", event => {
			event.preventDefault();
			this._save();
		});
		this.dialog.addEventListener("click", event => { if (event.target === this.dialog) this.dialog.close(); });
	}

	_showError(message) {
		const error = this._field("error");
		error.textContent = message;
		error.hidden = false;
	}

	/* The dialog's fields as event properties, or null (with a message shown) when they are invalid. */
	_readForm() {
		const allDay = this._field("allday").checked;
		const startDate = this._field("start-date").value;
		const endDate = this._field("end-date").value;
		const startTime = this._field("start-time").value;
		const endTime = this._field("end-time").value;
		if (!startDate || !endDate || (!allDay && (!startTime || !endTime))) {
			this._showError("Enter a start and an end.");
			return null;
		}
		const start = allDay ? startDate : `${startDate}T${startTime}`;
		const end = allDay ? endDate : `${endDate}T${endTime}`;
		if (allDay ? end < start : end <= start) {
			this._showError("The end must be after the start.");
			return null;
		}
		const freq = this._field("repeat").value;
		const until = this._field("until").value;
		if (freq && until && until < startDate) {
			this._showError("“Until” must be on or after the start date.");
			return null;
		}
		return {
			title: this._field("title").value.trim(),
			description: this._field("description").value.trim(),
			color: this.dialogColor,
			allDay,
			start,
			end,
			repeat: freq ? { freq, until: until || null } : null,
		};
	}

	_save() {
		const form = this._readForm();
		if (!form) return;
		const editing = this.editing;
		if (!editing) {
			this.store.upsert({ id: crypto.randomUUID(), ...form, exdates: [] });
		} else if (!editing.event.repeat) {
			this.store.upsert({ ...editing.event, ...form });
		} else if (this._scope() === "this") {
			// Take this occurrence out of the series and save the edited copy as its own event.
			this.store.upsert(
				{ ...editing.event, exdates: [...(editing.event.exdates || []), editing.key] },
				{ id: crypto.randomUUID(), ...form, repeat: null, exdates: [] },
			);
		} else {
			this.store.upsert({ ...editing.event, ...form, ...this._seriesDates(editing, form) });
		}
		this.dialog.close();
	}

	/*
	 * The dialog shows the dates of the occurrence that was clicked. When the change applies to the
	 * whole series, move the series by however far that occurrence was moved instead of restarting it there.
	 */
	_seriesDates(editing, form) {
		if (!form.repeat) return {};
		const shift = daysBetween(editing.start, parseLocal(form.start));
		const span = daysBetween(parseLocal(form.start), parseLocal(form.end));
		const seriesStart = addDays(startOfDay(parseLocal(editing.event.start)), shift);
		const format = (date, source) => form.allDay ? toYMD(date) : `${toYMD(date)}T${source.split("T")[1]}`;
		return {
			start: format(seriesStart, form.start),
			end: format(addDays(seriesStart, span), form.end),
			exdates: (editing.event.exdates || []).map(date => toYMD(addDays(parseLocal(date), shift))),
		};
	}

	_delete() {
		const editing = this.editing;
		if (!editing) return;
		if (editing.event.repeat && this._scope() === "this") {
			this.store.upsert({ ...editing.event, exdates: [...(editing.event.exdates || []), editing.key] });
		} else {
			this.store.remove(editing.event.id);
		}
		this.dialog.close();
	}
}

const calendarView = new CalendarView().init();
