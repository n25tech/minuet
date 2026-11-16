
# Minuet

A productivity app written in vanilla js.

### Features:

* **Pomodoro** (`#/pomodoro`) - pomodoro timer, to-do list and distraction diary.
  Tick "Add to calendar" on a new to-do to give it a date and (optionally) a time.
  The to-do list and the diary are two default notes labelled `pomodoro`, so they can also be opened under Notes.
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
