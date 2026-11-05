
# Minuet

A pomodoro app written in vanilla js.

### Features:

* Pomodoro Timer
* Todo list
* Distraction diary
* Google sign-in to sync the todo list and notes across devices

### Future Ideas:
* White noise machine

### Run Locally:
`./cmd.sh`

### Database:

The D1 schema lives in `migrations/`. Apply it with:

* `npm run db:migrate` - local database
* `npm run db:migrate:remote` - production database (run before deploying schema changes)

### Deployment:

This project is deployed via cloudflare pages. You can view it at: https://minuet.n25tech.com/

### Motivation:

I just wanted to write something in vanilla js.
