/*
 * Notes: Keep-style cards. Each note is
 *   { id, type: "text" | "list", title, text, items: [{ id, text, done }], color, labels: [..], pinned, createdAt, updatedAt }
 * Synced to the backend when signed in (see sync.js), stored in localStorage otherwise.
 *
 * The Notes home shows only the notes the user pinned to it ("Show on Notes home");
 * "All notes" lists everything, and searching always looks through every note.
 */

/*
 * The Pomodoro page's to-do list and distraction diary are two default notes, labelled
 * "pomodoro" (see todolist.js and diary.js). They have fixed ids so every device agrees on
 * which notes they are, and they can be edited like any other note but not deleted.
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
	const items = (Array.isArray(list) ? list : []).filter(item => item && typeof item.text === "string").map(item => ({
		id: String(item.id || crypto.randomUUID()),
		text: item.text,
		done: !!item.complete,
		...(item.due ? { due: item.due } : {}),
		...(item.calendar ? { calendar: true } : {}),
	}));
	return { items, text: typeof text === "string" ? text : "" };
}

const NOTE_COLORS = ["default", "red", "orange", "yellow", "green", "teal", "blue", "purple"];

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

	init() {
		document.querySelectorAll("[data-notes-scope]").forEach(button => {
			button.addEventListener("click", () => this.setScope(button.dataset.notesScope));
		});
		this.search.addEventListener("input", () => this.render());
		document.getElementById("notes-new-text").addEventListener("click", () => this.create("text"));
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

	/* ---------- Grid ---------- */

	render() {
		// The Pomodoro page's to-do list and diary, and the calendar's to-dos, are drawn from the notes.
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
		let message = "No notes yet. Create one with “+ Note” or “+ Checklist”.";
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
		card.append(el("button", {
			type: "button",
			class: "note-pin",
			"aria-pressed": String(!!note.pinned),
			title: note.pinned ? "Remove from Notes home" : "Show on Notes home",
			"aria-label": note.pinned ? "Remove from Notes home" : "Show on Notes home",
			onclick: event => { event.stopPropagation(); this.store.upsert({ ...note, pinned: !note.pinned }); },
		}, "📌"));
		if (note.title) card.append(el("h4", { class: "note-card-title" }, note.title));
		if (note.type === "list") {
			const items = note.items || [];
			const shown = items.slice(0, 8);
			card.append(el("ul", { class: "note-card-items" }, shown.map(item => el("li", { class: item.done ? "done" : "" },
				el("input", {
					type: "checkbox",
					checked: !!item.done,
					"aria-label": item.text,
					onclick: event => event.stopPropagation(),
					onchange: () => this._toggleItem(note, item.id),
				}),
				el("span", {}, item.text)))));
			if (items.length > shown.length) card.append(el("p", { class: "note-card-more" }, `+ ${items.length - shown.length} more`));
		} else if (note.text) {
			card.append(el("p", { class: "note-card-text" }, note.text));
		}
		if ((note.labels || []).length) {
			card.append(el("div", { class: "note-card-labels" }, note.labels.map(label => el("span", { class: "chip small" }, label))));
		}
		return card;
	}

	_toggleItem(note, itemId) {
		const items = (note.items || []).map(item => item.id === itemId ? { ...item, done: !item.done } : item);
		this.store.upsert({ ...note, items });
	}

	/* ---------- Editor ---------- */

	create(type) {
		const now = Date.now();
		// A note created while looking at the home is put on the home, so it doesn't vanish on save.
		const pinned = this.scope === "home";
		const labels = this.label ? [this.label] : [];
		this._edit({ id: crypto.randomUUID(), type, title: "", text: "", items: [], color: "default", labels, pinned, createdAt: now }, true);
	}

	open(id) {
		const note = this.store.get(id);
		if (note) this._edit(structuredClone(note), false);
	}

	_edit(note, isNew) {
		this.draft = { text: "", items: [], labels: [], color: "default", ...note };
		this.draftIsNew = isNew;
		this.draftOriginal = JSON.stringify(this.draft);
		const isList = this.draft.type === "list";
		document.getElementById("note-title").value = this.draft.title || "";
		const text = document.getElementById("note-text");
		text.value = this.draft.text;
		text.hidden = isList;
		document.getElementById("note-items").hidden = !isList;
		const newItem = document.getElementById("note-new-item");
		newItem.hidden = !isList;
		newItem.value = "";
		document.getElementById("note-labels").value = this.draft.labels.join(", ");
		document.getElementById("note-label-options").replaceChildren(...this.labels.map(label => el("option", { value: label })));
		document.getElementById("note-pinned").checked = !!this.draft.pinned;
		document.getElementById("note-delete").hidden = isNew || isDefaultNote(this.draft);
		this._renderDraftItems();
		this._renderDraftColor();
		this.dialog.showModal();
		(isNew && isList ? newItem : isNew ? text : document.getElementById("note-title")).focus();
	}

	_renderDraftColor() {
		this.dialog.dataset.color = this.draft.color;
		document.querySelectorAll("#note-colors button").forEach(button => {
			button.setAttribute("aria-pressed", String(button.dataset.color === this.draft.color));
		});
	}

	_renderDraftItems() {
		const container = document.getElementById("note-items");
		container.replaceChildren(...this.draft.items.map(item => {
			const input = el("input", {
				type: "text",
				value: item.text,
				"aria-label": "List item",
				oninput: () => { item.text = input.value; },
				onkeydown: event => {
					if (event.key !== "Enter") return;
					event.preventDefault();
					document.getElementById("note-new-item").focus();
				},
			});
			const row = el("div", { class: "note-item" + (item.done ? " done" : "") },
				el("input", {
					type: "checkbox",
					checked: !!item.done,
					"aria-label": "Done",
					onchange: event => { item.done = event.target.checked; row.classList.toggle("done", item.done); },
				}),
				input,
				el("button", {
					type: "button", class: "icon-button", title: "Remove item", "aria-label": "Remove item",
					onclick: () => {
						this.draft.items = this.draft.items.filter(other => other !== item);
						this._renderDraftItems();
					},
				}, "×"));
			return row;
		}));
	}

	_addDraftItem(keepTyping = false) {
		const input = document.getElementById("note-new-item");
		const text = input.value.trim();
		if (!text) return;
		this.draft.items.push({ id: crypto.randomUUID(), text, done: false });
		input.value = "";
		this._renderDraftItems();
		if (keepTyping) input.focus();
	}

	_bindEditor() {
		document.getElementById("note-colors").replaceChildren(...NOTE_COLORS.map(color => el("button", {
			type: "button",
			class: "swatch",
			dataset: { color },
			title: color[0].toUpperCase() + color.slice(1),
			"aria-label": color,
			onclick: () => { this.draft.color = color; this._renderDraftColor(); },
		})));
		const newItem = document.getElementById("note-new-item");
		newItem.addEventListener("keydown", event => {
			if (event.key !== "Enter") return;
			event.preventDefault();
			this._addDraftItem(true);
		});
		newItem.addEventListener("blur", () => this._addDraftItem());
		document.getElementById("note-form").addEventListener("submit", event => {
			event.preventDefault();
			this.dialog.close();
		});
		document.getElementById("note-delete").addEventListener("click", () => {
			const id = this.draft.id;
			this.draft = null;
			this.dialog.close();
			this.store.remove(id);
		});
		// Clicking the backdrop closes (and saves), like Keep.
		this.dialog.addEventListener("click", event => { if (event.target === this.dialog) this.dialog.close(); });
		// Every way of closing the editor (Done, Escape, backdrop) saves the note.
		this.dialog.addEventListener("close", () => this._saveDraft());
	}

	_saveDraft() {
		const draft = this.draft;
		if (!draft) return;
		this.draft = null;
		this._pendingItem(draft);
		draft.title = document.getElementById("note-title").value.trim();
		if (draft.type === "list") draft.items = draft.items.filter(item => item.text.trim());
		else draft.text = document.getElementById("note-text").value;
		draft.labels = parseLabels(document.getElementById("note-labels").value);
		draft.pinned = document.getElementById("note-pinned").checked;
		if (isBlankNote(draft) && !isDefaultNote(draft)) {
			if (!this.draftIsNew) this.store.remove(draft.id);
			return;
		}
		if (JSON.stringify(draft) !== this.draftOriginal) this.store.upsert(draft);
	}

	/* Text still sitting in the "+ List item" box counts as an item. */
	_pendingItem(draft) {
		const text = document.getElementById("note-new-item").value.trim();
		if (draft.type === "list" && text) draft.items.push({ id: crypto.randomUUID(), text, done: false });
	}
}

const notebook = new Notebook().init();
