/*
 * Creates a To-do list that consists of an array of objects, each object has the format: {"text": "", "complete": false, "order": 1, "id": ""}
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
		const newItemText = input.value.trim();
		if (newItemText) {
			this.list.push(this._idNewItem(newItemText));
			input.value = "";
			this.displayList();
			await this.saveState();
		}
	}

	async markComplete(id) {
		const item = this.list.find(item => item.id === id);
		if (item) {
			item.complete = true;
			this.displayList();
			await this.saveState();
		}
	}

	async clearCompleted() {
		this.list = this.list.filter(item => !item.complete);
		this.displayList();
		await this.saveState();
	}

	displayList() {
		const containerInstance = document.getElementById(this.uiContainer);
		if (!containerInstance) return;
		containerInstance.innerHTML = '';
		this.list.forEach((item) => {
			const p = document.createElement("p");
			p.textContent = item.text;
			if (item.complete) {
				p.style.textDecoration = "line-through";
				containerInstance.appendChild(p);
			} else {
				const b = document.createElement("button");
				p.style.textDecoration = "none";
				b.textContent = "Mark Complete";
				b.onclick = () => this.markComplete(item.id);
				containerInstance.appendChild(p);
				containerInstance.appendChild(b);
			}
		});
	}
}

const todoList = new TodoList().init();

document.getElementById('new-item-input').addEventListener('keydown', async (event) => {
	if (event.key === 'Enter') {
		event.preventDefault();
		if (event.target.value.trim() !== '') {
			await todoList.addItem();
		}
	}
});
