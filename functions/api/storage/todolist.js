import {saveTodoListForUser, fetchTodoListForUser} from '../_db_d1/todolist';
import { getUserIdFromSession } from '../_sessions_kv/sessions';

export async function onRequestPost(context) {
  try {
    console.log('fetching userId');
    const userId = await getUserIdFromSession(context);
    const body = await context.request.json();
    console.log(`body: ${JSON.stringify(body)}`);

    const result = await saveTodoListForUser(context.env.db, userId, body.list, body.version || 0);
    console.log(`results for user_id: ${userId}, ${JSON.stringify(result)}`);

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(error.message, { status: 500 });
  }
}

export async function onRequestGet(context) {
  try {
    console.log('fetching userId');
    const userId = await getUserIdFromSession(context);
    const results = await fetchTodoListForUser(context.env.db, userId);
    console.log(`results for user_id: ${userId}, ${JSON.stringify(results)}`);

    return new Response(JSON.stringify(results), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(error.message, { status: 500 });
  }
}