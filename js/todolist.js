/*
 * The Pomodoro page's to-do list. It shows one checklist note from the notebook (see notebook.js):
 * the default "To-do list" note, or any other checklist labelled "pomodoro", picked above the list
 * (the choice is kept per device). So the same list can be opened and edited under Notes. Each item is
 *   { id, text, done, due: "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" (optional), calendar: true (optional) }
 * An item with a due date and calendar: true is shown on the Calendar (see calendar.js), which reads
 * the notes directly - the to-do is the single source of truth, nothing is copied.
 *
 * The to-do being worked on (picked next to the timer, from any of the pomodoro checklists) is stored
 * as `current` (an entry id) on the note it belongs to, so it syncs to other devices with the list.
 */
const POMODORO_LIST_KEY = "pomodoro_list";

class TodoList {
	constructor(uiContainer = "todolist-table-container", uiItemInput = "new-item-input") {
		this.uiContainer = uiContainer;
		this.uiItemInput = uiItemInput;
		try {
			this.listId = localStorage.getItem(POMODORO_LIST_KEY) || TODO_NOTE_ID;
		} catch {
			this.listId = TODO_NOTE_ID;
		}
	}

	init() {
		const select = document.getElementById("pomodoro-task");
		if (select) select.addEventListener("change", () => {
			const [noteId, itemId] = select.value ? JSON.parse(select.value) : [];
			this.setCurrent(noteId, itemId);
		});
		const picker = document.getElementById("pomodoro-list");
		if (picker) picker.addEventListener("change", () => this.selectList(picker.value));
		document.addEventListener("minuet:notes", () => this.displayList());
		this.displayList();
		return this;
	}

	/* The checklists that can be used here, the default one first. */
	get lists() {
		return pomodoroNotes(notebook.store.items, "list");
	}

	/* The checklist shown; back to the default one if the chosen one was deleted or lost its label. */
	get note() {
		const lists = this.lists;
		return lists.find(note => note.id === this.listId) || lists[0];
	}

	get list() {
		return this.note.items || [];
	}

	selectList(id) {
		this.listId = id;
		try {
			localStorage.setItem(POMODORO_LIST_KEY, id);
		} catch { /* the choice just isn't remembered */ }
		this.displayList();
	}

	_save(items, changes = {}, note = this.note) {
		return notebook.store.upsert({ ...note, items, ...changes });
	}

	async addItem() {
		const input = document.getElementById(this.uiItemInput);
		const dateInput = document.getElementById("new-item-date");
		const timeInput = document.getElementById("new-item-time");
		const calendarInput = document.getElementById("new-item-calendar");
		const newItemText = input.value.trim();
		if (!newItemText) return;
		const item = { id: crypto.randomUUID(), text: newItemText, done: false };
		if (calendarInput.checked && dateInput.value) {
			item.due = composeDue(dateInput.value, timeInput.value);
			item.calendar = true;
			setRepeat(item, document.getElementById("new-item-repeat").value);
			setStatus(item, document.getElementById("new-item-status").value);
		}
		input.value = "";
		const note = this.note;
		const saved = this._save([...this.list, item], {}, note);
		// Apply the suggested/committed rules to the new to-do.
		settleSchedule([`item:${note.id}:${item.id}`]);
		await saved;
	}

	/* The to-do being worked on, as { note, item }, or null for none. */
	get current() {
		for (const note of this.lists) {
			const item = note.current && (note.items || []).find(entry => entry.id === note.current && !entry.done);
			if (item) return { note, item };
		}
		return null;
	}

	/* Work on one entry (or nothing); only one note holds the choice at a time. */
	setCurrent(noteId, itemId) {
		const changed = this.lists.filter(note => note.id === noteId ? note.current !== itemId : note.current)
			.map(note => ({ ...note, current: note.id === noteId ? itemId : null }));
		if (changed.length) return notebook.store.upsert(...changed);
	}

	/* The "Working on" picker lists the to-dos that are still open, from every pomodoro checklist. */
	_renderCurrent() {
		const select = document.getElementById("pomodoro-task");
		if (!select) return;
		const current = this.current;
		const lists = this.lists.map(note => ({ note, open: (note.items || []).filter(item => !item.done) })).filter(list => list.open.length);
		const option = (note, item) => el("option", {
			value: JSON.stringify([note.id, item.id]),
			selected: !!current && current.note.id === note.id && current.item.id === item.id,
		}, item.text);
		select.replaceChildren(
			el("option", { value: "" }, lists.length ? "Nothing selected" : "No open to-dos"),
			// With more than one checklist in use, each one's to-dos are grouped under its name.
			...(lists.length > 1
				? lists.map(({ note, open }) => el("optgroup", { label: noteHeading(note) }, open.map(item => option(note, item))))
				: lists.flatMap(({ note, open }) => open.map(item => option(note, item)))));
		select.value = current ? JSON.stringify([current.note.id, current.item.id]) : "";
	}

	/* The list picker only appears once there is more than one pomodoro checklist. */
	_renderPicker() {
		const picker = document.getElementById("pomodoro-list");
		if (!picker) return;
		const lists = this.lists;
		const shown = this.note.id;
		picker.hidden = lists.length < 2;
		picker.replaceChildren(...lists.map(note => el("option", { value: note.id, selected: note.id === shown }, noteHeading(note))));
		picker.value = shown;
	}

	async toggleComplete(id) {
		// Ticking off the to-do being worked on means it is no longer the current one.
		const note = this.note;
		const ticking = this.list.some(item => item.id === id && !item.done);
		const items = this.list.map(item => item.id === id ? { ...item, done: !item.done } : item);
		await this._save(items, ticking && id === note.current ? { current: null } : {}, note);
	}

	async clearCompleted() {
		await this._save(this.list.filter(item => !item.done));
	}

	_isOverdue(item) {
		if (item.done) return false;
		const due = parseLocal(item.due);
		return (item.due.includes("T") ? due : addDays(due, 1)) < new Date();
	}

	displayList() {
		const containerInstance = document.getElementById(this.uiContainer);
		if (!containerInstance) return;
		containerInstance.innerHTML = '';
		this._renderPicker();
		this._renderCurrent();
		const current = this.current && this.current.note.id === this.note.id ? this.current.item.id : "";
		this.list.forEach((item) => {
			const checkbox = el("input", { type: "checkbox", checked: !!item.done, onchange: () => this.toggleComplete(item.id) });
			const row = el("label", { class: "todo-item" + (item.done ? " complete" : "") + (!item.done && item.id === current ? " current" : ""), title: !item.done && item.id === current ? "Working on this now" : undefined },
				checkbox,
				el("span", { class: "todo-text" }, item.text));
			containerInstance.appendChild(row);
			if (item.due) {
				const label = (item.calendar ? "📅 " : "") + taskSummary(item);
				const due = item.calendar
					? el("button", {
						type: "button", class: "todo-due on-calendar", title: "Show on calendar",
						onclick: () => calendarView.goTo(parseLocal(item.due)),
					}, label)
					: el("span", { class: "todo-due" }, label);
				if (this._isOverdue(item)) due.classList.add("overdue");
				containerInstance.appendChild(due);
			}
		});
	}
}

const todoList = new TodoList().init();
localStorage.removeItem("pomodoro_task");   // where an earlier version kept the "Working on" choice

// The date and time fields stay hidden until "Add to calendar" is ticked.
(() => {
	const form = document.getElementById("todo-form");
	const dateInput = document.getElementById("new-item-date");
	const timeInput = document.getElementById("new-item-time");
	const calendarInput = document.getElementById("new-item-calendar");
	const syncWhen = () => {
		document.getElementById("new-item-when").hidden = !calendarInput.checked;
		if (calendarInput.checked && !dateInput.value) dateInput.value = toYMD(new Date());
	};
	calendarInput.addEventListener("change", syncWhen);
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		if (!document.getElementById("new-item-input").value.trim()) return;
		await todoList.addItem();
		calendarInput.checked = false;
		dateInput.value = "";
		timeInput.value = "";
		document.getElementById("new-item-repeat").value = "";
		document.getElementById("new-item-status").value = "";
		syncWhen();
	});
})();
