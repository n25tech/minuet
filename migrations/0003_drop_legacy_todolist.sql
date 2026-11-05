-- The original per-row todolist table was never written to (its only INSERT was invalid SQL);
-- todo lists live in todo_state.
DROP INDEX IF EXISTS idx_todolist_user_id;
DROP TABLE IF EXISTS todolist;
