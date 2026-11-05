
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
`npm install && npm run dev` - serves the app and API at http://localhost:3000

### Database:

The D1 schema lives in `migrations/`. Apply it with:

* `npm run db:migrate` - local database
* `npm run db:migrate:remote` - production database (run before deploying schema changes)

### Deployment:

This project is deployed via cloudflare pages. You can view it at: https://minuet.n25tech.com/

### Motivation:

I just wanted to write something in vanilla js.
