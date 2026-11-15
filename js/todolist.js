/*
 * Creates a To-do list that consists of an array of objects, each object has the format:
 *   {"text": "", "complete": false, "order": 1, "id": "", "due": "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" (optional), "calendar": true (optional)}
 * An item with a due date and calendar: true is shown on the Calendar (see calendar.js), which reads
 * this list directly - the to-do is the single source of truth, nothing is copied.
 * Synced to the backend when signed in (see sync.js), stored in localStorage otherwise.
 */

/*
 * 3-way merge of two edited lists against the last synced list:
 * items added on either side are kept, items removed on either side are dropped,
 * and an item completed on either side stays complete.
 */
function mergeTodoLists(base, mine, theirs) {
	const baseIds = new Set(base.map(item => item.id));
	const mineById = new Map(mine.map(item => [item.id, item]));
	const theirIds = new Set(theirs.map(item => item.id));
	const merged = [];
	for (const item of theirs) {
		const local = mineById.get(item.id);
		if (local) {
			merged.push({ ...item, complete: !!(item.complete || local.complete) });
		} else if (!baseIds.has(item.id)) {
			merged.push(item); // added on another device
		} // else: removed locally
	}
	for (const item of mine) {
		if (!theirIds.has(item.id) && !baseIds.has(item.id)) merged.push(item); // added locally
	}
	return merged;
}

class TodoList {
	constructor(uiContainer = "todolist-table-container", uiItemInput = "new-item-input") {
		this.uiContainer = uiContainer;
		this.uiItemInput = uiItemInput;
		this.list = [];
		this.doc = new SyncedDoc({
			endpoint: "/api/storage/todolist",
			field: "list",
			localKey: "todolist",
			empty: () => [],
			isEmpty: list => !Array.isArray(list) || list.length === 0,
			merge: mergeTodoLists,
			// Older localStorage data was saved as { list, completedList }.
			normalize: value => Array.isArray(value) ? value : (value && value.list) || [],
			onRemoteChange: list => this._setList(list),
		});
	}

	init() {
		bindSyncedDoc(this.doc, list => this._setList(list));
		return this;
	}

	_setList(list) {
		this.list = Array.isArray(list) ? list : [];
		this.displayList();
	}

	async saveState() {
		await this.doc.save(this.list);
	}

	_idNewItem(text) {
		const last = this.list[this.list.length - 1];
		const order = last && Number.isFinite(last.order) ? last.order + 1 : this.list.length + 1;
		return { id: crypto.randomUUID(), text, order, complete: false };
	}

	async addItem() {
		const input = document.getElementById(this.uiItemInput);
		const dateInput = document.getElementById("new-item-date");
		const timeInput = document.getElementById("new-item-time");
		const calendarInput = document.getElementById("new-item-calendar");
		const newItemText = input.value.trim();
		if (!newItemText) return;
		const item = this._idNewItem(newItemText);
		// A time on its own means today.
		const date = dateInput.value || (timeInput.value ? toYMD(new Date()) : "");
		if (date) {
			item.due = timeInput.value ? `${date}T${timeInput.value}` : date;
			if (calendarInput.checked) item.calendar = true;
		}
		this.list.push(item);
		input.value = "";
		dateInput.value = "";
		timeInput.value = "";
		this.displayList();
		await this.saveState();
	}

	async toggleComplete(id) {
		const item = this.list.find(item => item.id === id);
		if (item) {
			item.complete = !item.complete;
			this.displayList();
			await this.saveState();
		}
	}

	async clearCompleted() {
		this.list = this.list.filter(item => !item.complete);
		this.displayList();
		await this.saveState();
	}

	_dueLabel(item) {
		const due = parseLocal(item.due);
		const options = { weekday: "short", day: "numeric", month: "short" };
		if (due.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
		if (item.due.includes("T")) Object.assign(options, { hour: "numeric", minute: "2-digit" });
		return due.toLocaleString([], options);
	}

	_isOverdue(item) {
		if (item.complete) return false;
		const due = parseLocal(item.due);
		return (item.due.includes("T") ? due : addDays(due, 1)) < new Date();
	}

	displayList() {
		// The calendar shows dated to-dos, so it redraws whenever the list changes.
		document.dispatchEvent(new CustomEvent("minuet:todos"));
		const containerInstance = document.getElementById(this.uiContainer);
		if (!containerInstance) return;
		containerInstance.innerHTML = '';
		this.list.forEach((item) => {
			const checkbox = el("input", { type: "checkbox", checked: !!item.complete, onchange: () => this.toggleComplete(item.id) });
			const row = el("label", { class: "todo-item" + (item.complete ? " complete" : "") },
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
