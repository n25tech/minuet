
# Minuet

A productivity app written in vanilla js.

### Features:

* **Pomodoro** (`#/pomodoro`) - pomodoro timer, to-do list and distraction diary.
  Tick "Add to calendar" on a new to-do to give it a date and (optionally) a time.
  The to-do list and the diary are two default notes labelled `pomodoro`, so they can also be opened under Notes.
  Label any other note `pomodoro` to use it here too: checklists can be picked above the to-do list (and their
  to-dos picked as "Working on"), plain notes above the diary.
* **Notes** (`#/notes`) - Keep-style notes with colours, labels and search. The options menu at the bottom
  of a note turns it into a checklist (and back) or adds the note to the calendar; each checklist entry
  can also be added to the calendar on its own. The Notes home only shows the notes you pin to it;
  "All notes" lists everything.
* **Calendar** (`#/calendar`) - month, week and day views, all-day and repeating events
  (daily / weekly / monthly / yearly), plus the notes and checklist entries you added to the calendar.
* Google sign-in to sync everything across devices; signed out, it all lives in localStorage.

Anything on the calendar (an event, a note, a checklist entry) can repeat and is either **suggested** or
**committed**. Suggested tasks can share a time and can be moved; only one committed task can hold a time.
When a committed task lands on suggested ones, they move to the next free time that day (or come off the
calendar if the day is full). All-day tasks never clash.

Dates and times are stored as local wall-clock values with no time zone.

### AI access (MCP server)

Minuet has a [Model Context Protocol](https://modelcontextprotocol.io) server at `/api/mcp`, so an AI assistant
can read and change your notes, to-dos and calendar and help with scheduling.

1. Sign in, open **Settings**, check your time zone, and create an access token.
2. Give the assistant the server address and the token. Either send the token as
   `Authorization: Bearer mnt_...`, or use the address with `?token=mnt_...` for assistants that only take a URL.
   For Claude Code: `claude mcp add --transport http minuet https://minuet.n25tech.com/api/mcp --header "Authorization: Bearer mnt_..."`

A token has one of three access levels:

* **View only** (`read`) - see notes, to-dos and the calendar, and find free time.
* **View and suggest** (`read`, `suggest`) - also add and change notes, to-dos and *suggested* tasks.
* **Full control** (`read`, `suggest`, `manage`) - also commit tasks to fixed times, change committed tasks, delete, and undo.

Changes made with a token go through the same suggested/committed rules as the app, never overwrite edits
from your devices (they use the same versioned saves), and are listed under Settings with an **Undo**.
Tokens are stored hashed, can expire, and can be revoked at any time.

The scheduling rules live in `js/calendar-core.js` and `js/tasks-core.js`. `npm run build` copies them into
`functions/api/_lib/core.js` for the server; that generated file is committed, and a test fails if it is stale.

### Future Ideas:
* White noise machine

### Run Locally:
`npm install && npm run dev` - serves the app and API at http://localhost:3000

### Database:

The D1 schema lives in `migrations/`. Apply it with:

* `npm run db:migrate` - local database
* `npm run db:migrate:remote` - production database (run before deploying schema changes)

### Deployment:

This project is deployed via cloudflare pages. You can view it at: https://minuet.n25tech.com/

### Motivation:

I just wanted to write something in vanilla js.
