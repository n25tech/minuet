const list = ["moolah dev", "ebpf/kernel learning"];

function createList(list) {
	const container = document.getElementById("todolist-table-container");
	list.forEach((item) => {
		const p = document.createElement("p");
		p.textContent = item;
		container.appendChild(p);
		}
	)
}

createList(list);

//addItem();
//removeItem();
