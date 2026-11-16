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
		// A time on its own means today.
		const date = dateInput.value || (timeInput.value ? toYMD(new Date()) : "");
		if (date) {
			item.due = timeInput.value ? `${date}T${timeInput.value}` : date;
			if (calendarInput.checked) item.calendar = true;
		}
		input.value = "";
		dateInput.value = "";
		timeInput.value = "";
		await this._save([...this.list, item]);
	}

	async toggleComplete(id) {
		await this._save(this.list.map(item => item.id === id ? { ...item, done: !item.done } : item));
	}

	async clearCompleted() {
		await this._save(this.list.filter(item => !item.done));
	}

	_dueLabel(item) {
		const due = parseLocal(item.due);
		const options = { weekday: "short", day: "numeric", month: "short" };
		if (due.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
		if (item.due.includes("T")) Object.assign(options, { hour: "numeric", minute: "2-digit" });
		return due.toLocaleString([], options);
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
				const label = (item.calendar ? "📅 " : "") + this._dueLabel(item);
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

// "Add to calendar" only applies to items with a date; remember the user's last choice.
(() => {
	const form = document.getElementById("todo-form");
	const dateInput = document.getElementById("new-item-date");
	const timeInput = document.getElementById("new-item-time");
	const calendarInput = document.getElementById("new-item-calendar");
	calendarInput.checked = localStorage.getItem("todo_add_to_calendar") !== "false";
	const syncCalendarOption = () => { calendarInput.disabled = !dateInput.value && !timeInput.value; };
	dateInput.addEventListener("input", syncCalendarOption);
	timeInput.addEventListener("input", syncCalendarOption);
	calendarInput.addEventListener("change", () => localStorage.setItem("todo_add_to_calendar", calendarInput.checked));
	syncCalendarOption();
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		await todoList.addItem();
		syncCalendarOption();
	});
})();
