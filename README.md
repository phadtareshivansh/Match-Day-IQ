# MatchDay IQ — Full-Stack Operations Console

Real backend for the Estadio Banorte (Azteca) operations dashboard: **Express API + SQLite database**, serving the same UI you already reviewed.

## What's real now
- **Zones and Incidents** are stored in SQLite (`server/matchday.sqlite`, created automatically) and shared across every browser/device pointed at the server — this is a genuine multi-user shared board, not per-browser storage.
- **Checklist progress and language preference** are personal per user, keyed by a random ID the browser generates once and keeps in `localStorage`.
- The frontend polls the server every 4 seconds for zone/incident updates, so two staff members with the dashboard open at once will see each other's changes.

## Authentication (new)
- **Login is required.** Every `/api/*` route (except `/api/auth/login`) returns `401` without a valid session. The frontend checks this on load and redirects to `/login.html` automatically.
- **Two roles: `organizer` and `volunteer`.** Your persona in the dashboard is now **locked to your account's role** — you can't manually switch to the other persona anymore (the inactive toggle button is greyed out with a tooltip explaining why).
- **Organizer-only action:** resolving an incident (`POST /api/incidents/:id/resolve`) requires the `organizer` role — a volunteer account gets a `403` if it tries.
- **Personal data is protected per-account:** `GET/PUT /api/preferences/:userId` checks that `userId` matches your own session username — you can't read or overwrite someone else's checklist/language preference.
- **Sessions** last 8 hours (a shift length) and are stored server-side via `express-session`, with the session id in an `httpOnly` cookie.
- **Passwords** are hashed with `bcryptjs` — never stored in plaintext.

### Demo accounts (seeded automatically on first run)
| Username | Password | Role |
|---|---|---|
| `organizer1` | `organizer123` | organizer |
| `volunteer1` | `volunteer123` | volunteer |

**Change or remove these before any real deployment.** To add real accounts, either insert directly into the `users` table in `server/matchday.sqlite` (hash passwords with `bcryptjs.hashSync`), or add a small admin script/route — not included here since account provisioning policy varies by organization.

### What auth does *not* yet cover
- No password reset / forgot-password flow
- No rate limiting on login attempts (add `express-rate-limit` before exposing this publicly)
- No HTTPS enforcement — add a reverse proxy (nginx/Caddy) with TLS in front of this for any real deployment, since cookies should be `secure` in production
- No per-organizer-account admin panel to create/deactivate volunteer accounts — currently that's a direct DB operation

## Project structure
```
matchday-iq-fullstack/
├── package.json
├── server/
│   ├── server.js        # Express app + REST routes + auth
│   └── db.js             # SQLite schema + seed data (zones + demo users)
└── public/
    ├── index.html         # Public marketing landing page (Asta design system)
    ├── login.html         # Sign-in page
    └── dashboard.html     # Operations dashboard — auth-gated, persona locked to role
```

## Run it locally

**Requirements:** Node.js 18+ installed.

```bash
cd matchday-iq-fullstack
npm install
npm start
```

Then open **http://localhost:3000** in your browser — you'll land on the public marketing page. Click **Sign in** (or **Open the console**) to go to `/login.html`, then sign in with one of the demo accounts above; you'll land on `/dashboard.html`.

Open the same URL in a second tab (or a second device on your network) and click a zone or log an incident — you'll see it appear in the other tab within a few seconds, since both are now reading from the same SQLite database through the API.

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
This is a plain Node/Express app, so it runs anywhere Node runs:
- **Render / Railway / Fly.io** — connect the repo, set start command `npm start`, done.
- **A VPS** — `npm install && npm start` behind a process manager (pm2) and a reverse proxy (nginx/Caddy) for HTTPS.
- **Docker** — wrap it in a small Node image; SQLite file lives in a mounted volume if you want data to survive container restarts.

For real production use with many concurrent staff, consider swapping SQLite for Postgres (the query patterns in `db.js` translate almost directly) and adding authentication so `userId` isn't just a random browser-generated string.

## What's still simulated
- No real stadium sensors feed `zones` — status changes are manual (organizer/volunteer clicks), matching how the original mock tool calls (`get_crowd_status`, `report_incident`, etc.) were framed as simulated data sources.
- No authentication/authorization layer — anyone with the URL can act as any persona. Add auth before using this beyond a local demo.
