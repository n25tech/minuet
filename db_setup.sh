LOCATION="--local"
if [[ $1 == "remote" ]]; then
    LOCATION="--remote"
fi

echo $LOCATION
#npx wrangler d1 execute db "${LOCATION}" --command="DROP TABLE "

npx wrangler d1 execute db "${LOCATION}" --command="\
CREATE TABLE users (
    user_id TEXT PRIMARY KEY,
    google_sub TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);"

npx wrangler d1 execute db "${LOCATION}" --command="\
CREATE TABLE todolist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    text TEXT NOT NULL,
    sort_order INTEGER,
    complete INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);"

npx wrangler d1 execute db "${LOCATION}" --command="\
CREATE INDEX idx_todolist_user_id ON todolist(user_id);"