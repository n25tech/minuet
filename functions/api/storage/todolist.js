import { saveTodoListForUser, fetchTodoListForUser } from '../_db_d1/todolist.js';
import { syncHandlers } from './_sync.js';

export const { onRequestGet, onRequestPost } = syncHandlers({
  fetch: fetchTodoListForUser,
  save: saveTodoListForUser,
  isValid: Array.isArray,
  field: 'list',
});
