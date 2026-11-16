/*
 * The Pomodoro page's to-do list. It is a view of the default "To-do list" checklist note
 * (label "pomodoro") in the notebook (see notebook.js), so the same list can be opened and
 * edited under Notes. Each item is
 *   { id, text, done, due: "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" (optional), calendar: true (optional) }
 * An item with a due date and calendar: true is shown on the Calendar (see calendar.js), which reads
 * this list directly - the to-do is the single source of truth, nothing is copied.
 *
 * The to-do being worked on (picked next to the timer) is stored on the note as `current`
 * (an entry id), so it syncs to other devices with the list.
 */
class TodoList {
	constructor(uiContainer = "todolist-table-container", uiItemInput = "new-item-input") {
		this.uiContainer = uiContainer;
		this.uiItemInput = uiItemInput;
	}

	init() {
		const select = document.getElementById("pomodoro-task");
		if (select) select.addEventListener("change", () => this.setCurrent(select.value));
		document.addEventListener("minuet:notes", () => this.displayList());
		this.displayList();
		return this;
	}

	get list() {
		return notebook.defaultNote(TODO_NOTE_ID).items || [];
	}

	_save(items, changes = {}) {
		return notebook.store.upsert({ ...notebook.defaultNote(TODO_NOTE_ID), items, ...changes });
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
		const saved = this._save([...this.list, item]);
		// Apply the suggested/committed rules to the new to-do.
		settleSchedule([`item:${TODO_NOTE_ID}:${item.id}`]);
		await saved;
	}

	/* Id of the to-do being worked on, or "" for none. */
	get currentId() {
		return notebook.defaultNote(TODO_NOTE_ID).current || "";
	}

	setCurrent(id) {
		return this._save(this.list, { current: id || null });
	}

	/* The "Working on" picker lists the to-dos that are still open. */
	_renderCurrent() {
		const select = document.getElementById("pomodoro-task");
		if (!select) return;
		const open = this.list.filter(item => !item.done);
		const current = open.some(item => item.id === this.currentId) ? this.currentId : "";
		select.replaceChildren(
			el("option", { value: "" }, open.length ? "Nothing selected" : "No open to-dos"),
			...open.map(item => el("option", { value: item.id, selected: item.id === current }, item.text)));
		select.value = current;
	}

	async toggleComplete(id) {
		// Ticking off the to-do being worked on means it is no longer the current one.
		const ticking = this.list.some(item => item.id === id && !item.done);
		const items = this.list.map(item => item.id === id ? { ...item, done: !item.done } : item);
		await this._save(items, ticking && id === this.currentId ? { current: null } : {});
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
		this._renderCurrent();
		const current = this.currentId;
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
