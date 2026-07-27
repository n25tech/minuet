export async function fetchTodoListForUser(userId) {
    const results = await db.prepare("SELECT * FROM todolist WHERE user_id = ?").bind(userId).all();
    if (results.length === 0) {
        console.log('no todos found for user');
        return [];
    }
    return [];
}

export async function saveTodoListForUser(userId, todolist) {
    const result = await db.prepare("INSERT INTO todolist () VALUES()").bind().run();
    console.log(result);
}