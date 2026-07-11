# MatchDay IQ — Full-Stack Operations Console

## ⏱ Deploying right now, under time pressure? Do this.

**Have a card (even just for a $0 verification hold, never charged on the free tier)?** → Option A, fastest.
**No card at all?** → Option B. Vercel's free tier has never required one.

### Option A: Render + Neon
1. **Neon**: neon.tech → sign in → your project (or create one) → **Connect** → copy the pooled connection string (includes `?sslmode=require`).
2. **Render**: render.com → **New → Web Service** → connect this GitHub repo.
   - Build command: `npm install` · Start command: `npm start`
   - Env vars: `DATABASE_URL` = the Neon string, `SESSION_SECRET` = any random string, `NODE_ENV` = `production`
   - Deploy.
3. Open the Render URL. Free tier sleeps after 15 min idle — open it yourself a few minutes before you present so it's warm.

### Option B: Vercel + Neon (no card, ever)
This repo deploys to Vercel as serverless functions — `api/index.js` wraps the same Express app, `vercel.json` routes `/api/*` there, and everything else in `public/` is served as static files automatically.

1. **Neon**: same as above — copy the pooled connection string.
2. **Vercel**: vercel.com → **Add New → Project** → import this GitHub repo → deploy with defaults (it auto-detects `vercel.json`).
3. Project → **Settings → Environment Variables**: add `DATABASE_URL` (the Neon string) and `SESSION_SECRET` (any random string). Redeploy so the function picks them up.
4. Open the Vercel URL. No cold-start sleep issue like Render's free tier, since Neon and Vercel's functions both scale to zero gracefully rather than needing a warm-up.

Either way: `/` is the landing page, `/login.html` signs in, `/dashboard.html` is the console. Demo accounts: `organizer1` / `organizer123`, `volunteer1` / `volunteer123`.

If you already have a Vercel deployment of just the static frontend from earlier: replace it with this repo instead of layering on top — this version includes the `api/` functions the old one didn't have.

---


Real backend for the Estadio Banorte (Azteca) operations dashboard: **Express API + Postgres (Neon) database**, serving the same UI you already reviewed.

## What's real now
- **Zones and Incidents** are stored in Postgres (Neon) and shared across every browser/device pointed at the server — this is a genuine multi-user shared board, not per-browser storage.
- **Sessions** are also stored in Postgres, in a `session` table that `connect-pg-simple` creates automatically — so logins survive restarts and redeploys instead of resetting whenever the server process restarts.
- **Checklist progress and language preference** are personal per user, keyed by a random ID the browser generates once and keeps in `localStorage`.
- The frontend polls the server every 4 seconds for zone/incident updates, so two staff members with the dashboard open at once will see each other's changes.

## Authentication (new)
- **Login is required.** Every `/api/*` route (except `/api/auth/login`) returns `401` without a valid session. The frontend checks this on load and redirects to `/login.html` automatically.
- **Two roles: `organizer` and `volunteer`.** Your persona in the dashboard is now **locked to your account's role** — you can't manually switch to the other persona anymore (the inactive toggle button is greyed out with a tooltip explaining why).
- **Organizer-only action:** resolving an incident (`POST /api/incidents/:id/resolve`) requires the `organizer` role — a volunteer account gets a `403` if it tries.
- **Personal data is protected per-account:** `GET/PUT /api/preferences/:userId` checks that `userId` matches your own session username — you can't read or overwrite someone else's checklist/language preference.
- **Sessions** last 8 hours (a shift length) and are stored server-side in Postgres via `connect-pg-simple`, with only the session id in an `httpOnly` cookie.
- **Passwords** are hashed with `bcryptjs` — never stored in plaintext.

### Demo accounts (seeded automatically on first run)
| Username | Password | Role |
|---|---|---|
| `organizer1` | `organizer123` | organizer |
| `volunteer1` | `volunteer123` | volunteer |

**Change or remove these before any real deployment.** To add real accounts, either insert directly into the `users` table in your Neon database (hash passwords with `bcryptjs.hashSync`, via Neon's SQL editor or `psql`), or add a small admin script/route — not included here since account provisioning policy varies by organization.

### What auth does *not* yet cover
- No password reset / forgot-password flow
- No rate limiting on login attempts (add `express-rate-limit` before exposing this publicly)
- No HTTPS enforcement — add a reverse proxy (nginx/Caddy) with TLS in front of this for any real deployment, since cookies should be `secure` in production
- No per-organizer-account admin panel to create/deactivate volunteer accounts — currently that's a direct DB operation

## Project structure
```
matchday-iq-fullstack/
├── package.json
├── vercel.json           # Routes /api/* to api/index.js — only used by Vercel deploys
├── api/
│   └── index.js          # Vercel serverless entry point, wraps server/app.js
├── server/
│   ├── app.js             # Express app + REST routes + auth (no listen() call — used by both entry points)
│   ├── server.js         # Entry point for Render/Railway/a VPS/local: calls app.listen()
│   └── db.js             # Postgres (Neon) pool + schema + seed data (zones + demo users)
└── public/
    ├── index.html         # Public marketing landing page (Asta design system)
    ├── login.html         # Sign-in page
    ├── config.js          # One-line edit point if frontend/backend are ever split across hosts
    └── dashboard.html     # Operations dashboard — auth-gated, persona locked to role
```

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string. Neon (Neon dashboard → Connect → include `?sslmode=require`) or, if deploying on Railway with credits available, Railway's own **Add PostgreSQL** plugin auto-sets this for you |
| `SESSION_SECRET` | Recommended | Signs the session cookie. Falls back to a dev default — **set this in any real deployment**, since the default is public in this repo |
| `PORT` | No | Defaults to `3000` (Railway/Render set this automatically) |
| `NODE_ENV` | Yes, if frontend and backend are on different domains | Set to `production` so cookies use `Secure; SameSite=None` — required for cross-site cookies over HTTPS. Railway/Render set this automatically |
| `FRONTEND_ORIGIN` | Only if frontend is hosted separately (e.g. Vercel) | The exact origin your frontend is served from, e.g. `https://match-day-iq.vercel.app`. Comma-separate multiple origins. Without this, cross-origin requests are rejected by CORS |

### Frontend + backend on different hosts (e.g. Vercel + Railway)

This app was written to be served as one app (Express serves both the API and `public/`) — see `public/config.js` for why. If you split them across two hosts instead:

1. Edit `public/config.js` and set `window.MATCHDAY_API_BASE` to your backend's full URL, e.g. `"https://match-day-iq-production.up.railway.app/api"`. This file is loaded by every page, so it's the only edit needed on the frontend.
2. On the backend (Railway), set `FRONTEND_ORIGIN` to your Vercel URL and `NODE_ENV=production`.
3. Redeploy both. Open the network tab if login still fails — a CORS error there means `FRONTEND_ORIGIN` doesn't exactly match the origin making the request (check for trailing slashes or a preview-deployment URL that doesn't match production).

**This split-host setup is more failure-prone than running one app** — CORS and cross-site cookies are a real source of subtle bugs (Safari and some privacy settings block third-party cookies outright, no code fix available). If you don't have a specific reason to keep them separate, deploying only to Railway (which already serves `public/` via Express) removes this entire category of problem.

## Run it locally

**Requirements:** Node.js 18+, and a Neon project (free tier is fine — [neon.tech](https://neon.tech)).

```bash
cd matchday-iq-fullstack
npm install
export DATABASE_URL="postgresql://<user>:<password>@<host>/<db>?sslmode=require"
export SESSION_SECRET="something-random-and-long"
npm start
```

On first boot, `db.js` creates the `users`, `zones`, `incidents`, and `preferences` tables if they don't exist yet, and seeds the demo accounts and zones — safe to run every time, it only seeds when a table is empty. `connect-pg-simple` creates its own `session` table the same way.

Then open **http://localhost:3000** in your browser — you'll land on the public marketing page. Click **Sign in** (or **Open the console**) to go to `/login.html`, then sign in with one of the demo accounts above; you'll land on `/dashboard.html`.

Open the same URL in a second tab (or a second device on your network) and click a zone or log an incident — you'll see it appear in the other tab within a few seconds, since both are now reading from the same Neon database through the API.

## API reference

| Method | Endpoint | Auth required | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | No | Sign in — body: `{ username, password }` |
| POST | `/api/auth/logout` | Yes | End the current session |
| GET | `/api/auth/me` | Yes | Get the current session's user info |
| GET | `/api/zones` | Yes | List all zones with current status |
| POST | `/api/zones/:id/cycle` | Yes | Advance one zone to its next status |
| GET | `/api/incidents` | Yes | List the 100 most recent incidents |
| POST | `/api/incidents` | Yes | Log a new incident — body: `{ type, severity, location }` |
| POST | `/api/incidents/:id/resolve` | Organizer only | Mark an incident resolved |
| GET | `/api/preferences/:userId` | Yes, own account only | Fetch checklist state + language preference |
| PUT | `/api/preferences/:userId` | Yes, own account only | Save checklist state + language preference |

## Deploying it for real matchday use
This is a plain Node/Express app that connects out to Neon, so it runs anywhere Node runs — Railway, Render, and Fly.io all work with zero code changes:
- Connect the repo, set the start command to `npm start`.
- Set `DATABASE_URL` and `SESSION_SECRET` as environment variables on the host — don't hardcode them.
- No volume or persistent disk needed on the app host itself; all state (zones, incidents, sessions) lives in Neon, not on the container's filesystem. This also means redeploys and restarts no longer reset your data — that was a real problem under the old SQLite-on-a-container setup and it's now fixed structurally, not just worked around.
- Add a reverse proxy or platform-level HTTPS (Railway/Render provide this by default) — cookies should be `secure` in production.

## What's still simulated
- No real stadium sensors feed `zones` — status changes are manual (organizer/volunteer clicks).
- No rate limiting on login attempts (add `express-rate-limit` before exposing this publicly).
- No password reset / forgot-password flow, and no admin UI to create/deactivate accounts — both are direct-database operations for now.
