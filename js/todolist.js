/*
 * Creates a To-do list that consists of an array of objects, each object has the format: {"text": "", "complete": false, "deleted": false, "order": 1, "id": ""}
 */

class TodoList {
	constructor(uiContainer = "todolist-table-container", storageKey = "this.storageKey", uiItemInput = "new-item-input") {
		this.uiContainer = uiContainer;
		this.storageKey = storageKey;
		this.list = [];
		this.completedList = [];
		this.uiItemInput = uiItemInput;
	}
	init() {
		this.loadState();
		this.displayList();
		return this;
	}
	loadState() {
		let state = localStorage.getItem(this.storageKey) ? JSON.parse(localStorage.getItem(this.storageKey)) : { list: [], completedList: [] };
		this.list = state.list || [];
		this.completedList = state.completedList || [];
	}
	saveState() {
		let state = {
			list: this.list,
			completedList: this.completedList
		};
		localStorage.setItem(this.storageKey, JSON.stringify(state));
	}
	deleteState() {
		this.list = [];
		this.completedList = [];
		localStorage.removeItem(this.storageKey);
		console.log('deleted state');
	}

	_idNewItem(text) {
		let order, id;
		if (this.list.length > 0) {
			order = this.list[this.list.length - 1]['order'] + 1;
			id = this.list[this.list.length - 1]['id'] + 1;
		} else {
			order = 1;
			id = 1;
		}
		const item = { "text": text, "order": order, "id": id };
		return item;
	}

	addItem() {
		const input = document.getElementById(this.uiItemInput);
		const newItemText = input.value.trim();
		if (newItemText) {
			const newItem = this._idNewItem(newItemText);
			this.list.push(newItem);
			this.saveState();
			this.displayList();
			input.value = "";
		}
	}

	markComplete(id) {
		const item = this.list.find(item => item.id === id);
		if (item) {
			this.list = this.list.filter(i => i.id !== id);
			this.completedList.push(item);
			this.saveState();
			this.displayList();
		}
	}
	clearCompleted() {
		//this.list = this.list.filter(item => !item.complete);
		this.completedList = [];
		this.saveState();
		this.displayList();
	}
	displayList() {
		const containerInstance = document.getElementById(this.uiContainer);
		containerInstance.innerHTML = '';
		this.completedList.forEach((item) => {
			const p = document.createElement("p");
			p.style.textDecoration = "line-through";
			p.textContent = item.text;
			containerInstance.appendChild(p);
		});
		this.list.forEach((item) => {
			const p = document.createElement("p");
			const b = document.createElement("button");
			p.style.textDecoration = "none";
			p.textContent = item.text;
			b.textContent = item.complete ? "Mark Incomplete" : "Mark Complete";
			b.onclick = () => {
				this.markComplete(item.id);
			}
			containerInstance.appendChild(p);
			containerInstance.appendChild(b);
		}
		)
	}

}


let todoList;

document.addEventListener('DOMContentLoaded', () => {
	todoList = new TodoList().init();
});

/*
const inputElement = document.getElementById('new-item-input');

inputElement.addEventListener('keydown', (event) => {
	// Check if the pressed key is "Enter"
	if (event.key === 'Enter') {
		// Prevent the default browser action if necessary
		event.preventDefault(); 
	    
		const inputValue = event.target.value.trim();
	    
		if (inputValue !== '') {
			todoList.addItem();
		}
	}
});
*/