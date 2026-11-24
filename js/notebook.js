/*
 * Notes: Keep-style cards. Each note is
 *   { id, type: "text" | "list", title, text, items: [{ id, text, done, due?, calendar? }],
 *     color, labels: [..], pinned, due?, calendar?, createdAt, updatedAt }
 * A note is plain text or a checklist and can be switched between the two. A whole note, or a
 * single checklist entry, can be added to the calendar: calendar: true with
 * due: "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM", and optionally repeat: { freq }, status: "committed"
 * (otherwise suggested), and exdates / moves for single occurrences of a repeating one
 * (see calendar-core.js; calendar.js reads all of this from here).
 * Synced to the backend when signed in (see sync.js), stored in localStorage otherwise.
 *
 * The Notes home shows only the notes the user pinned to it ("Show on Notes home");
 * "All notes" lists everything, and searching always looks through every note.
 */

/*
 * Before the to-do list and diary became notes they were stored on their own
 * (/api/storage/todolist and /api/storage/notes, or localStorage when signed out).
 * Reads whatever is there so it can be carried into the default notes; throws when
 * signed in and the server can't be reached, so the import is retried later.
 */
async function loadLegacyPomodoroData() {
	const local = key => {
		try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
	};
	const remote = async (name, field) => {
		const response = await fetch(`${window.APP_CONFIG.BACKEND_API_URL}/api/storage/${name}`, { credentials: "include" });
		if (!response.ok) throw new Error(`GET /api/storage/${name} failed: ${response.status}`);
		return (await response.json())[field];
	};
	let list = local("todolist");
	if (list && !Array.isArray(list)) list = list.list;   // oldest format: { list, completedList }
	let text = local("notes");
	if (window.minuetAuth.user) {
		const [remoteList, remoteText] = await Promise.all([remote("todolist", "list"), remote("notes", "content")]);
		if (Array.isArray(remoteList) && remoteList.length) list = remoteList;
		if (remoteText) text = remoteText;
	}
	const items = legacyTodoItems(list, () => crypto.randomUUID());
	return { items, text: typeof text === "string" ? text : "" };
}

const NOTE_COLORS = ["default", "red", "orange", "yellow", "green", "teal", "blue", "purple"];

// Material Design icon outlines (24x24).
const ICONS = {
	pin: "M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z",
	calendar: "M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z",
	more: "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
	checklist: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
	label: "M17.63 5.84C17.27 5.33 16.67 5 16 5L5 5.01C3.9 5.01 3 5.9 3 7v10c0 1.1.9 1.99 2 1.99L16 19c.67 0 1.27-.33 1.63-.84L22 12l-4.37-6.16z",
	palette: "M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z",
	close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
	add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
};

function icon(name, size = 18) {
	const span = document.createElement("span");
	span.className = "icon";
	span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path fill="currentColor" d="${ICONS[name]}"/></svg>`;
	return span;
}

/* "2026-11-17" or "2026-11-17T15:00" as a short readable date. */
function formatDue(due) {
	const date = parseLocal(due);
	const options = { weekday: "short", day: "numeric", month: "short" };
	if (date.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
	if (due.includes("T")) Object.assign(options, { hour: "numeric", minute: "2-digit" });
	return date.toLocaleString([], options);
}

// The task fields and helpers (clearTask, setRepeat, noteTasks, ...) live in tasks-core.js.
const REPEAT_OPTIONS = [["", "Does not repeat"], ["daily", "Repeats daily"], ["weekly", "Repeats weekly"], ["monthly", "Repeats monthly"], ["yearly", "Repeats yearly"]];
const STATUS_OPTIONS = [["", "Suggested (can be moved)"], ["committed", "Committed (fixed time)"]];

/* When a note or entry is on the calendar, in a few words: "Tue, Nov 17, 3:00 PM · weekly · committed". */
function taskSummary(source) {
	const parts = [formatDue(source.due)];
	if (source.repeat) parts.push(source.repeat.freq);
	if (source.status === "committed") parts.push("committed");
	return parts.join(" · ");
}

function optionSelect(options, value, label, onchange) {
	return el("select", { "aria-label": label, onchange: event => onchange(event.target.value) },
		options.map(([optionValue, text]) => el("option", { value: optionValue, selected: optionValue === value }, text)));
}

function noteMatches(note, query) {
	const haystack = [note.title, note.text, ...(note.items || []).map(item => item.text), ...(note.labels || [])]
		.join("\n").toLowerCase();
	return query.toLowerCase().split(/\s+/).filter(Boolean).every(word => haystack.includes(word));
}

function parseLabels(text) {
	const labels = [];
	for (const raw of text.split(",")) {
		const label = raw.trim().slice(0, 40);
		if (label && !labels.some(existing => existing.toLowerCase() === label.toLowerCase())) labels.push(label);
	}
	return labels;
}

function isBlankNote(note) {
	return !note.title.trim() && !note.text.trim() && !(note.items || []).some(item => item.text.trim());
}

class Notebook {
	constructor() {
		this.grid = document.getElementById("notes-grid");
		this.labelRow = document.getElementById("notes-labels");
		this.search = document.getElementById("notes-search");
		this.dialog = document.getElementById("note-dialog");
		this.scope = localStorage.getItem("notes_scope") === "all" ? "all" : "home";
		this.label = null;   // label filter, or null for every label
		this.draft = null;   // the note open in the editor
		this.unsaved = [];   // { isBusy, flush } for editors holding text not yet in the store (the diary box)
		this.store = new SyncedList({
			endpoint: "/api/storage/notebook",
			field: "notes",
			localKey: "notebook",
			onChange: () => this.render(),
			onLoad: () => this._ensureDefaultNotes(),
			isBusy: () => this.unsaved.some(editor => editor.isBusy()),
			flushPending: () => this.unsaved.forEach(editor => editor.flush()),
		});
	}

	init() {
		document.querySelectorAll("[data-notes-scope]").forEach(button => {
			button.addEventListener("click", () => this.setScope(button.dataset.notesScope));
		});
		this.search.addEventListener("input", () => this.render());
		document.getElementById("notes-new-text").addEventListener("click", () => this.create("text"));
		document.getElementById("notes-new-list").append(icon("checklist", 20));
		document.getElementById("notes-new-list").addEventListener("click", () => this.create("list"));
		this._bindEditor();
		this.store.init();
		this.render();
		return this;
	}

	setScope(scope) {
		this.scope = scope;
		localStorage.setItem("notes_scope", scope);
		this.render();
	}

	/* The stored default note, or a fresh one if it hasn't been created yet. */
	defaultNote(id) {
		return this.store.get(id) || newDefaultNote(id);
	}

	/* Create the default notes if this account/device doesn't have them yet, bringing over the old to-do list and diary. */
	async _ensureDefaultNotes() {
		const run = this.ensureRun = (this.ensureRun || 0) + 1;
		const missing = () => [TODO_NOTE_ID, DIARY_NOTE_ID].filter(id => !this.store.get(id));
		// Signed in but the notebook couldn't be loaded: don't create defaults over notes we can't see.
		if (!missing().length || this.store.doc.remote !== this.store.doc.signedIn) return;
		let legacy;
		try {
			legacy = await loadLegacyPomodoroData();
		} catch (error) {
			console.error(error);
			return;
		}
		if (run !== this.ensureRun) return;   // signed in or out meanwhile; that load runs its own check
		const created = missing().map(id => ({ ...newDefaultNote(id), ...(id === TODO_NOTE_ID ? { items: legacy.items } : { text: legacy.text }) }));
		if (created.length) this.store.upsert(...created);
	}

	get labels() {
		const labels = new Map();
		for (const note of this.store.items) {
			for (const label of note.labels || []) if (!labels.has(label.toLowerCase())) labels.set(label.toLowerCase(), label);
		}
		return [...labels.values()].sort((a, b) => a.localeCompare(b));
	}

	visibleNotes() {
		const query = this.search.value.trim();
		let notes = this.store.items;
		if (query) notes = notes.filter(note => noteMatches(note, query));
		else if (this.scope === "home") notes = notes.filter(note => note.pinned);
		if (this.label) notes = notes.filter(note => (note.labels || []).some(label => label.toLowerCase() === this.label.toLowerCase()));
		return [...notes].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
	}

	/* Tick or untick one entry of a checklist note. */
	toggleItem(noteId, itemId) {
		const note = this.store.get(noteId);
		if (!note) return;
		const items = (note.items || []).map(item => item.id === itemId ? { ...item, done: !item.done } : item);
		return this.store.upsert({ ...note, items });
	}

	/* Everything the notes put on the calendar, as calendar tasks (see noteTasks in tasks-core.js). */
	calendarEntries(notes = this.store.items) {
		return noteTasks(notes);
	}

	/* ---------- Grid ---------- */

	render() {
		// The Pomodoro page's to-do list and diary, and the calendar's entries, are drawn from the notes.
		document.dispatchEvent(new CustomEvent("minuet:notes"));
		if (!this.grid) return;
		const searching = !!this.search.value.trim();
		document.querySelectorAll("[data-notes-scope]").forEach(button => {
			button.setAttribute("aria-pressed", String(!searching && button.dataset.notesScope === this.scope));
		});
		const labels = this.labels;
		if (this.label && !labels.some(label => label.toLowerCase() === this.label.toLowerCase())) this.label = null;
		this.labelRow.replaceChildren(...(labels.length ? [null, ...labels] : []).map(label => el("button", {
			type: "button",
			class: "chip",
			"aria-pressed": String(label === this.label),
			onclick: () => { this.label = label; this.render(); },
		}, label === null ? "All labels" : label)));

		const notes = this.visibleNotes();
		if (notes.length) {
			this.grid.replaceChildren(...notes.map(note => this._card(note)));
			return;
		}
		let message = "Notes you add appear here.";
		if (searching) message = "No notes match your search.";
		else if (this.label) message = `No notes labelled “${this.label}” here.`;
		else if (this.scope === "home" && this.store.items.length) {
			message = "Nothing on your Notes home yet. Open “All notes” and pin the notes you want to see here.";
		}
		this.grid.replaceChildren(el("p", { class: "empty-state" }, message));
	}

	_card(note) {
		const open = () => this.open(note.id);
		const card = el("article", {
			class: "note-card",
			dataset: { color: note.color || "default" },
			tabIndex: 0,
			onclick: open,
			onkeydown: event => { if (event.key === "Enter" && event.target === card) open(); },
		});
		const pinLabel = note.pinned ? "Remove from Notes home" : "Show on Notes home";
		card.append(el("button", {
			type: "button",
			class: "note-pin",
			"aria-pressed": String(!!note.pinned),
			title: pinLabel,
			"aria-label": pinLabel,
			onclick: event => { event.stopPropagation(); this.store.upsert({ ...note, pinned: !note.pinned }); },
		}, icon("pin")));
		if (note.title) card.append(el("h4", { class: "note-card-title" }, note.title));
		if (note.type === "list") {
			const open = (note.items || []).filter(item => !item.done);
			const doneCount = (note.items || []).length - open.length;
			const shown = open.slice(0, 8);
			if (shown.length) {
				card.append(el("ul", { class: "note-card-items" }, shown.map(item => el("li", {},
					el("input", {
						type: "checkbox",
						"aria-label": item.text,
						onclick: event => event.stopPropagation(),
						onchange: () => this.toggleItem(note.id, item.id),
					}),
					el("span", {}, item.text,
						item.calendar && item.due ? el("small", { class: "note-due" }, icon("calendar", 12), taskSummary(item)) : null)))));
			}
			const more = [];
			if (open.length > shown.length) more.push(`${open.length - shown.length} more`);
			if (doneCount) more.push(`${doneCount} ticked`);
			if (more.length) card.append(el("p", { class: "note-card-more" }, "+ " + more.join(", ")));
		} else if (note.text) {
			// Long notes are cut short on the card; the editor shows the whole note.
			const long = note.text.split("\n").length > 14 || note.text.length > 900;
			const text = el("div", { class: "note-card-text md" + (long ? " long" : "") });
			text.append(renderMarkdown(note.text));
			// Links open in a new tab rather than opening the note.
			text.querySelectorAll("a").forEach(link => link.addEventListener("click", event => event.stopPropagation()));
			card.append(text);
			if (long) card.append(el("p", { class: "note-card-more" }, "Open to read the whole note"));
		}
		const chips = [];
		if (note.calendar && note.due) chips.push(el("span", { class: "chip small" }, icon("calendar", 12), taskSummary(note)));
		chips.push(...(note.labels || []).map(label => el("span", { class: "chip small" }, label)));
		if (chips.length) card.append(el("div", { class: "note-card-labels" }, chips));
		return card;
	}

	/* ---------- Editor ---------- */

	create(type) {
		// A note created while looking at the home is put on the home, so it doesn't vanish on save.
		const pinned = this.scope === "home";
		const labels = this.label ? [this.label] : [];
		const items = type === "list" ? [{ id: crypto.randomUUID(), text: "", done: false }] : [];
		this._edit({ id: crypto.randomUUID(), type, title: "", text: "", items, color: "default", labels, pinned, createdAt: Date.now() }, true);
	}

	open(id) {
		const note = this.store.get(id);
		if (note) this._edit(structuredClone(note), false);
	}

	/* Switch to the Notes page and open a note there (used by the calendar). */
	show(id) {
		location.hash = "#/notes";
		this.open(id);
	}

	_part(id) {
		return document.getElementById(`note-${id}`);
	}

	_edit(note, isNew) {
		this.draft = { text: "", items: [], labels: [], color: "default", ...note };
		this.draftIsNew = isNew;
		this.draftOriginal = JSON.stringify(this.draft);
		this._part("title").value = this.draft.title || "";
		this._part("labels").value = this.draft.labels.join(", ");
		this._part("label-options").replaceChildren(...this.labels.map(label => el("option", { value: label })));
		for (const panel of ["menu", "panel-colors", "panel-labels"]) this._part(panel).hidden = true;
		this._part("edited").textContent = this.draft.updatedAt
			? "Edited " + new Date(this.draft.updatedAt).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
			: "";
		// A note that already uses formatting opens showing it; new and plain notes open for typing.
		this.previewing = !isNew && this.draft.type !== "list" && hasMarkdown(this.draft.text);
		this._renderDraft();
		this.dialog.showModal();
		this._autosize();
		if (!isNew) this._part("title").focus();
		else if (this.draft.type === "list") this._focusItem(this.draft.items[0].id);
		else this._part("text").focus();
	}

	/* Redraw everything in the editor that depends on the draft's settings. */
	_renderDraft() {
		const draft = this.draft;
		const isList = draft.type === "list";
		this.dialog.dataset.color = draft.color;
		const text = this._part("text");
		const previewing = !isList && this.previewing;
		text.hidden = isList || previewing;
		if (!isList) text.value = draft.text;
		this._part("format").hidden = isList;
		this._part("format-tools").hidden = previewing;
		const toggle = this._part("preview-toggle");
		toggle.textContent = previewing ? "Edit" : "Preview";
		toggle.setAttribute("aria-pressed", String(previewing));
		// On a wide screen the formatted note can sit next to the text while typing.
		const wide = this.wideScreen.matches;
		const split = !isList && !previewing && wide && this.split;
		const splitToggle = this._part("split-toggle");
		splitToggle.hidden = isList || previewing || !wide;
		splitToggle.setAttribute("aria-pressed", String(!!this.split));
		this._part("body").classList.toggle("split", split);
		this.dialog.classList.toggle("split", split);
		this._part("preview").hidden = !(previewing || split);
		this._renderPreview();
		this._part("items").hidden = !isList;
		if (isList) this._renderItems();

		const pin = this._part("pin");
		pin.setAttribute("aria-pressed", String(!!draft.pinned));
		pin.title = draft.pinned ? "Remove from Notes home" : "Show on Notes home";

		this._part("when").hidden = !draft.calendar;
		const [date = "", time = ""] = (draft.due || "").split("T");
		this._part("date").value = date;
		this._part("time").value = time;
		this._part("repeat").value = (draft.repeat && draft.repeat.freq) || "";
		this._part("status").value = draft.status === "committed" ? "committed" : "";
		this._part("chips").replaceChildren(...draft.labels.map(label => el("span", { class: "chip small" }, label)));

		const fixed = isDefaultNote(draft);   // the Pomodoro page relies on these two keeping their kind
		this._part("toggle-list").hidden = fixed;
		this._part("toggle-list").replaceChildren(icon("checklist"), isList ? "Turn into a plain note" : "Turn into a checklist");
		this._part("toggle-calendar").replaceChildren(icon("calendar"), draft.calendar ? "Remove note from calendar" : "Add note to calendar");
		this._part("delete").hidden = this.draftIsNew || fixed;
		document.querySelectorAll("#note-panel-colors button").forEach(button => {
			button.setAttribute("aria-pressed", String(button.dataset.color === draft.color));
		});
		this._autosize();
	}

	_renderPreview() {
		const preview = this._part("preview");
		if (preview.hidden || !this.draft) return;
		preview.replaceChildren(renderMarkdown(this.draft.text));
		if (!this.draft.text.trim()) preview.append(el("p", { class: "empty-state" }, "Nothing written yet."));
	}

	/* Grows the text with what's typed. A min-height, so it can also stretch to fill the editor or match the preview beside it. */
	_autosize() {
		const text = this._part("text");
		if (text.hidden) return;
		text.style.height = "";
		// Side by side, the text fills its half and scrolls instead of growing.
		if (this._part("body").classList.contains("split")) {
			text.style.minHeight = "";
			return;
		}
		text.style.minHeight = "0";
		text.style.minHeight = `${text.scrollHeight + 2}px`;
	}

	_focusItem(id) {
		const input = this._part("items").querySelector(`[data-item-id="${id}"] input[type="text"]`);
		if (input) input.focus();
	}

	/* Unticked entries first, then "+ List item", then the ticked ones - as in Keep. */
	_renderItems() {
		const items = this.draft.items;
		const open = items.filter(item => !item.done);
		const done = items.filter(item => item.done);
		this._part("items").replaceChildren(
			...open.map(item => this._itemRow(item)),
			el("button", { type: "button", class: "note-add-item", onclick: () => this._addItem() }, icon("add"), "List item"),
			...(done.length ? [el("div", { class: "note-done-divider" }, `${done.length} ticked ${done.length === 1 ? "item" : "items"}`)] : []),
			...done.map(item => this._itemRow(item)));
	}

	_addItem(after) {
		const items = this.draft.items;
		const item = { id: crypto.randomUUID(), text: "", done: false };
		// With no entry to follow, the new one goes at the end of the unticked entries.
		const anchor = after || [...items].reverse().find(other => !other.done);
		items.splice(anchor ? items.indexOf(anchor) + 1 : 0, 0, item);
		this._renderItems();
		this._focusItem(item.id);
	}

	_itemRow(item) {
		const input = el("input", {
			type: "text",
			value: item.text,
			placeholder: "List item",
			"aria-label": "List item",
			// Phone keyboards would otherwise offer "Next", which moves on without sending Enter.
			enterkeyhint: "enter",
			oninput: () => { item.text = input.value; },
			onkeydown: event => {
				if (event.isComposing) return;   // Enter is choosing a word in an input method
				if (event.key === "Enter") {
					event.preventDefault();
					this._addItem(item);
				} else if (event.key === "Backspace" && !input.value && this.draft.items.length > 1) {
					event.preventDefault();
					const index = this.draft.items.indexOf(item);
					const previous = this.draft.items[index - 1] || this.draft.items[index + 1];
					this.draft.items.splice(index, 1);
					this._renderItems();
					this._focusItem(previous.id);
				}
			},
		});
		const calendarLabel = item.calendar ? "Remove entry from calendar" : "Add entry to calendar";
		const row = el("div", { class: "note-item" + (item.done ? " done" : ""), dataset: { itemId: item.id } },
			el("div", { class: "note-item-main" },
				el("input", {
					type: "checkbox",
					checked: !!item.done,
					"aria-label": "Ticked",
					onchange: event => { item.done = event.target.checked; this._renderItems(); },
				}),
				input,
				el("button", {
					type: "button",
					class: "icon-button note-item-calendar",
					"aria-pressed": String(!!item.calendar),
					title: calendarLabel,
					"aria-label": calendarLabel,
					onclick: () => {
						if (item.calendar) {
							clearTask(item);
						} else {
							item.calendar = true;
							item.due = item.due || toYMD(new Date());
						}
						this._renderItems();
						this._focusItem(item.id);
					},
				}, icon("calendar", 16)),
				el("button", {
					type: "button", class: "icon-button note-item-remove", title: "Delete entry", "aria-label": "Delete entry",
					onclick: () => {
						this.draft.items = this.draft.items.filter(other => other !== item);
						this._renderItems();
					},
				}, icon("close", 16))));
		// The date and time only appear once the entry is on the calendar.
		if (item.calendar) {
			const [dueDate = "", dueTime = ""] = (item.due || "").split("T");
			const date = el("input", { type: "date", value: dueDate, "aria-label": "Date" });
			const time = el("input", { type: "time", value: dueTime, "aria-label": "Time (optional)" });
			const update = () => { item.due = composeDue(date.value, time.value); };
			date.addEventListener("input", update);
			time.addEventListener("input", update);
			row.append(el("div", { class: "note-item-when" }, icon("calendar", 14), date, time,
				optionSelect(REPEAT_OPTIONS, (item.repeat && item.repeat.freq) || "", "Repeat", freq => setRepeat(item, freq)),
				optionSelect(STATUS_OPTIONS, item.status === "committed" ? "committed" : "", "Suggested or committed", status => setStatus(item, status))));
		}
		return row;
	}

	_convert() {
		const draft = this.draft;
		if (draft.type === "list") {
			// As in Keep, going back to plain text keeps the entries' text, one per line.
			draft.text = draft.items.map(item => item.text.trim()).filter(Boolean).join("\n");
			draft.items = [];
			draft.type = "text";
		} else {
			draft.items = draft.text.split("\n").map(line => line.trim()).filter(Boolean)
				.map(text => ({ id: crypto.randomUUID(), text, done: false }));
			if (!draft.items.length) draft.items.push({ id: crypto.randomUUID(), text: "", done: false });
			draft.text = "";
			draft.type = "list";
		}
		this._renderDraft();
		if (draft.type === "list") this._focusItem(draft.items[draft.items.length - 1].id);
		else this._part("text").focus();
	}

	_bindEditor() {
		this._part("pin").append(icon("pin", 20));
		this._part("color-button").append(icon("palette", 20));
		this._part("label-button").append(icon("label", 20));
		this._part("settings").append(icon("more", 20));
		this._part("when-remove").append(icon("close", 16));
		this._part("when").prepend(icon("calendar", 16));
		this._part("panel-colors").replaceChildren(...NOTE_COLORS.map(color => el("button", {
			type: "button",
			class: "swatch",
			dataset: { color },
			title: color[0].toUpperCase() + color.slice(1),
			"aria-label": color,
			onclick: () => { this.draft.color = color; this._renderDraft(); },
		})));

		this._part("title").addEventListener("input", event => { this.draft.title = event.target.value; });
		// Enter in the title goes on to the note, as in Keep.
		this._part("title").addEventListener("keydown", event => {
			if (event.key !== "Enter" || event.isComposing) return;
			event.preventDefault();
			if (this.draft.type !== "list") this._part("text").focus();
			else if (this.draft.items.some(item => !item.done)) this._focusItem(this.draft.items.find(item => !item.done).id);
			else this._addItem();
		});
		this._part("text").addEventListener("input", event => {
			this.draft.text = event.target.value;
			this._autosize();
			// Keep the side-by-side preview current, without redrawing a long note on every key.
			clearTimeout(this.previewTimer);
			this.previewTimer = setTimeout(() => this._renderPreview(), 120);
		});
		this._bindFormatting();
		this._part("labels").addEventListener("input", event => {
			this.draft.labels = parseLabels(event.target.value);
			this._renderDraft();
		});
		this._part("pin").addEventListener("click", () => {
			this.draft.pinned = !this.draft.pinned;
			this._renderDraft();
		});
		const updateDue = () => { this.draft.due = composeDue(this._part("date").value, this._part("time").value); };
		this._part("date").addEventListener("input", updateDue);
		this._part("time").addEventListener("input", updateDue);
		this._part("repeat").addEventListener("change", event => setRepeat(this.draft, event.target.value));
		this._part("status").addEventListener("change", event => setStatus(this.draft, event.target.value));
		const setCalendar = on => {
			this.draft.calendar = on;
			if (on) this.draft.due = this.draft.due || toYMD(new Date());
			else clearTask(this.draft);
			this._renderDraft();
			if (on) this._part("date").focus();
		};
		this._part("when-remove").addEventListener("click", () => setCalendar(false));

		// Bottom bar: colour and label panels, and the options menu.
		const togglePanel = id => {
			for (const panel of ["panel-colors", "panel-labels"]) this._part(panel).hidden = panel !== id || !this._part(panel).hidden;
			if (id === "panel-labels" && !this._part(id).hidden) this._part("labels").focus();
		};
		this._part("color-button").addEventListener("click", () => togglePanel("panel-colors"));
		this._part("label-button").addEventListener("click", () => togglePanel("panel-labels"));
		const menu = this._part("menu");
		const setMenu = open => {
			menu.hidden = !open;
			this._part("settings").setAttribute("aria-expanded", String(open));
		};
		this._part("settings").addEventListener("click", event => {
			event.stopPropagation();
			setMenu(menu.hidden);
		});
		this._part("toggle-list").addEventListener("click", () => this._convert());
		this._part("toggle-calendar").addEventListener("click", () => setCalendar(!this.draft.calendar));
		this._part("delete").addEventListener("click", () => {
			const id = this.draft.id;
			this.draft = null;
			this.dialog.close();
			this.store.remove(id);
		});
		this.dialog.addEventListener("click", event => {
			setMenu(false);   // choosing an option, or clicking anywhere else, closes the menu
			if (event.target === this.dialog) this.dialog.close();   // the backdrop closes (and saves), like Keep
		});
		this.dialog.addEventListener("keydown", event => {
			if (event.key === "Escape" && !menu.hidden) {
				event.preventDefault();
				setMenu(false);
			}
		});
		this._part("form").addEventListener("submit", event => {
			event.preventDefault();
			this.dialog.close();
		});
		// Enter while typing labels mustn't close the note (it would submit the form).
		this._part("labels").addEventListener("keydown", event => {
			if (event.key === "Enter" && !event.isComposing) event.preventDefault();
		});
		// Every way of closing the editor (Close, Escape, backdrop) saves the note.
		this.dialog.addEventListener("close", () => this._saveDraft());
	}

	/* The formatting toolbar, Ctrl+B / I / K, and switching between writing and the formatted view. */
	_bindFormatting() {
		const text = this._part("text");
		const setPreview = on => {
			this.previewing = on;
			this._renderDraft();
			if (!on) text.focus();
		};
		this._part("preview-toggle").addEventListener("click", () => setPreview(!this.previewing));
		this.wideScreen = matchMedia("(min-width: 64rem)");
		try { this.split = localStorage.getItem("note_split") !== "off"; } catch { this.split = true; }
		this._part("split-toggle").addEventListener("click", () => {
			this.split = !this.split;
			try { localStorage.setItem("note_split", this.split ? "on" : "off"); } catch { /* not remembered */ }
			this._renderDraft();
			text.focus();
		});
		this.wideScreen.addEventListener("change", () => { if (this.draft) this._renderDraft(); });
		// Side by side, the preview scrolls along with the text, to the same place proportionally.
		const preview = this._part("preview");
		text.addEventListener("scroll", () => {
			if (!this._part("body").classList.contains("split")) return;
			const range = text.scrollHeight - text.clientHeight;
			preview.scrollTop = range > 0 ? text.scrollTop / range * (preview.scrollHeight - preview.clientHeight) : 0;
		});
		// Clicking the formatted text goes back to editing, except on a link or inside a selection.
		this._part("preview").addEventListener("click", event => {
			if (event.target.closest("a") || String(getSelection())) return;
			setPreview(false);
		});
		this._part("format-tools").addEventListener("click", event => {
			const button = event.target.closest("[data-format]");
			if (button) this._format(button.dataset.format);
		});
		text.addEventListener("keydown", event => {
			if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
			const format = { b: "bold", i: "italic", k: "link" }[event.key.toLowerCase()];
			if (!format) return;
			event.preventDefault();
			this._format(format);
		});
	}

	/* Apply one toolbar action to the selection in the note text, as Markdown. */
	_format(kind) {
		const text = this._part("text");
		const { selectionStart: start, selectionEnd: end, value } = text;
		const selected = value.slice(start, end);
		const wrap = { bold: "**", italic: "*", strike: "~~", code: "`" }[kind];
		const prefix = { heading: "## ", bullet: "- ", number: "1. ", task: "- [ ] ", quote: "> " }[kind];
		text.focus();
		if (wrap) {
			if (kind === "code" && selected.includes("\n")) {
				text.setRangeText("```\n" + selected + "\n```", start, end, "select");
			} else {
				text.setRangeText(wrap + selected + wrap, start, end, "end");
				// With nothing selected, leave the cursor between the markers, ready to type.
				if (!selected) text.setSelectionRange(start + wrap.length, start + wrap.length);
				else text.setSelectionRange(start + wrap.length, end + wrap.length);
			}
		} else if (prefix) {
			// Applies to every line the selection touches; applying it again takes it off.
			const lineStart = start ? value.lastIndexOf("\n", start - 1) + 1 : 0;
			const lineEnd = value.indexOf("\n", end) < 0 ? value.length : value.indexOf("\n", end);
			const lines = value.slice(lineStart, lineEnd).split("\n");
			const marker = kind === "number" ? /^\d+[.)] / : new RegExp("^" + prefix.replace(/[[\]]/g, "\\$&"));
			const remove = lines.every(line => marker.test(line));
			const changed = lines.map((line, index) => {
				if (remove) return line.replace(marker, "");
				const bare = line.replace(/^(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )/, "");
				return (kind === "number" ? `${index + 1}. ` : prefix) + bare;
			}).join("\n");
			text.setRangeText(changed, lineStart, lineEnd, "end");
		} else if (kind === "link") {
			const label = selected || "link text";
			text.setRangeText(`[${label}](https://)`, start, end, "end");
			// Select the address so it can be pasted over.
			const urlAt = start + label.length + 3;
			text.setSelectionRange(urlAt, urlAt + "https://".length);
		}
		text.dispatchEvent(new Event("input"));
	}

	_saveDraft() {
		const draft = this.draft;
		if (!draft) return;
		this.draft = null;
		draft.title = (draft.title || "").trim();
		if (draft.type === "list") {
			draft.text = "";
			draft.items = draft.items.filter(item => item.text.trim());
			// An entry ticked for the calendar but left without a date isn't on it.
			for (const item of draft.items) if (item.calendar && !item.due) clearTask(item);
		} else {
			draft.items = [];
		}
		if (!draft.calendar || !draft.due) clearTask(draft);
		if (isBlankNote(draft) && !isDefaultNote(draft)) {
			if (!this.draftIsNew) this.store.remove(draft.id);
			return;
		}
		if (JSON.stringify(draft) === this.draftOriginal) return;
		this.store.upsert(draft);
		// Apply the suggested/committed rules to whatever this note has on the calendar.
		settleSchedule(this.calendarEntries([draft]).map(task => task.id));
	}
}

const notebook = new Notebook().init();
