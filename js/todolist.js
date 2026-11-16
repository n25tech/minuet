/*
 * The Pomodoro page's to-do list. It is a view of the default "To-do list" checklist note
 * (label "pomodoro") in the notebook (see notebook.js), so the same list can be opened and
 * edited under Notes. Each item is
 *   { id, text, done, due: "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" (optional), calendar: true (optional) }
 * An item with a due date and calendar: true is shown on the Calendar (see calendar.js), which reads
 * this list directly - the to-do is the single source of truth, nothing is copied.
 */
class TodoList {
	constructor(uiContainer = "todolist-table-container", uiItemInput = "new-item-input") {
		this.uiContainer = uiContainer;
		this.uiItemInput = uiItemInput;
	}

	init() {
		document.addEventListener("minuet:notes", () => this.displayList());
		this.displayList();
		return this;
	}

	get list() {
		return notebook.defaultNote(TODO_NOTE_ID).items || [];
	}

	_save(items) {
		return notebook.store.upsert({ ...notebook.defaultNote(TODO_NOTE_ID), items });
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
		}
		input.value = "";
		await this._save([...this.list, item]);
	}

	async toggleComplete(id) {
		await notebook.toggleItem(TODO_NOTE_ID, id);
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
		this.list.forEach((item) => {
			const checkbox = el("input", { type: "checkbox", checked: !!item.done, onchange: () => this.toggleComplete(item.id) });
			const row = el("label", { class: "todo-item" + (item.done ? " complete" : "") },
				checkbox,
				el("span", { class: "todo-text" }, item.text));
			containerInstance.appendChild(row);
			if (item.due) {
				const label = (item.calendar ? "📅 " : "") + formatDue(item.due);
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
		syncWhen();
	});
})();
