
# Minuet

A productivity app written in vanilla js.

### Features:

* **Pomodoro** (`#/pomodoro`) - pomodoro timer, to-do list and distraction diary.
  A to-do can be given a date and (optionally) a time, and ticked "Add to calendar" to show up on the calendar.
* **Notes** (`#/notes`) - Keep-style notes and checklists with colours, labels and search.
  The Notes home only shows the notes you pin to it; "All notes" lists everything.
* **Calendar** (`#/calendar`) - month, week and day views, all-day and repeating events
  (daily / weekly / monthly / yearly), plus your dated to-dos.
* Google sign-in to sync everything across devices; signed out, it all lives in localStorage.

Dates and times are stored as local wall-clock values with no time zone.

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
