const path = require("path");
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const bcrypt = require("bcryptjs");
const { pool, initDb } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

// Railway/Render/Fly sit behind a proxy; Express needs this to trust the
// proxy's X-Forwarded-Proto header, or it will think every request is plain
// HTTP and refuse to set secure cookies.
app.set("trust proxy", 1);

// FRONTEND_ORIGIN = the exact origin your frontend is served from (e.g. a
// Vercel deployment URL), required because the frontend and backend are on
// different domains. Comma-separate multiple origins if you have more than
// one (e.g. a Vercel preview URL and a production URL).
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin/non-browser requests (no Origin header) and any
      // origin explicitly listed in FRONTEND_ORIGIN.
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true, // required so the browser sends/receives the session cookie
  })
);

app.use(express.json());
app.use(
  session({
    store: new pgSession({
      pool,
      tableName: "session", // connect-pg-simple creates/manages this table itself
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "matchday-iq-dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 8 * 60 * 60 * 1000, // 8-hour shift-length session
      // Cross-site cookies (Vercel frontend + Railway backend) require
      // SameSite=None, which in turn requires Secure — browsers reject
      // SameSite=None cookies over plain HTTP. Locally (http://localhost)
      // fall back to "lax"/non-secure so login still works in dev.
      sameSite: isProd ? "none" : "lax",
      secure: isProd,
    },
  })
);

const STATUS_CYCLE = ["low", "moderate", "high", "severe"];

// Wrap async route handlers so rejected promises reach Express's error handling
// instead of crashing the process or hanging the request.
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---------------------------------------------------------------
// AUTH MIDDLEWARE
// ---------------------------------------------------------------
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Not authenticated" });
  next();
}
function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: "Not authenticated" });
    if (req.session.user.role !== role) {
      return res.status(403).json({ error: `Requires ${role} role` });
    }
    next();
  };
}

// ---------------------------------------------------------------
// AUTH ROUTES (public)
// ---------------------------------------------------------------
app.post("/api/auth/login", ah(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }

  const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.display_name,
  };
  res.json(req.session.user);
}));

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json(req.session.user);
});

// Everything below this line requires a logged-in session.
app.use("/api", requireAuth);

// Serve static files after auth routes are declared, so the public landing
// page (index.html), login.html, and dashboard.html are still reachable,
// but API calls from dashboard.html will 401 until a session exists.
app.use(express.static(path.join(__dirname, "..", "public")));

// ---------------------------------------------------------------
// ZONES  — shared operational state (everyone sees the same board)
// ---------------------------------------------------------------
app.get("/api/zones", ah(async (req, res) => {
  const { rows } = await pool.query("SELECT id, name, status FROM zones ORDER BY id");
  res.json(rows);
}));

// Cycle a single zone to its next status (low -> moderate -> high -> severe -> low)
app.post("/api/zones/:id/cycle", ah(async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query("SELECT * FROM zones WHERE id = $1", [id]);
  const zone = rows[0];
  if (!zone) return res.status(404).json({ error: "Zone not found" });

  const nextIdx = (STATUS_CYCLE.indexOf(zone.status) + 1) % STATUS_CYCLE.length;
  const nextStatus = STATUS_CYCLE[nextIdx];

  await pool.query("UPDATE zones SET status = $1 WHERE id = $2", [nextStatus, id]);
  res.json({ id, status: nextStatus });
}));

// ---------------------------------------------------------------
// INCIDENTS — shared operational log
// ---------------------------------------------------------------
app.get("/api/incidents", ah(async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM incidents ORDER BY id DESC LIMIT 100"
  );
  res.json(rows);
}));

app.post("/api/incidents", ah(async (req, res) => {
  const { type, severity, location } = req.body;
  if (!type || !severity || !location) {
    return res.status(400).json({ error: "type, severity, and location are required" });
  }
  const createdAt = new Date().toISOString();
  const { rows } = await pool.query(
    "INSERT INTO incidents (type, severity, location, created_at) VALUES ($1, $2, $3, $4) RETURNING *",
    [type, severity, location, createdAt]
  );
  res.status(201).json(rows[0]);
}));

// Organizer-only: resolving an incident is a decision-making action,
// restricted to the Organizer role.
app.post("/api/incidents/:id/resolve", requireRole("organizer"), ah(async (req, res) => {
  const { id } = req.params;
  const { rowCount } = await pool.query(
    "UPDATE incidents SET resolved = TRUE WHERE id = $1",
    [id]
  );
  if (rowCount === 0) return res.status(404).json({ error: "Incident not found" });
  res.json({ id, resolved: true });
}));

// ---------------------------------------------------------------
// PREFERENCES — personal per-user (checklist progress + language)
// Keyed by the authenticated username. A user may only read/write their own.
// ---------------------------------------------------------------
app.get("/api/preferences/:userId", ah(async (req, res) => {
  const { userId } = req.params;
  if (userId !== req.session.user.username) {
    return res.status(403).json({ error: "Cannot access another user's preferences" });
  }

  const { rows } = await pool.query("SELECT * FROM preferences WHERE user_id = $1", [userId]);
  let row = rows[0];
  if (!row) {
    await pool.query(
      "INSERT INTO preferences (user_id, checklist, lang) VALUES ($1, '{}', 'en')",
      [userId]
    );
    row = { user_id: userId, checklist: "{}", lang: "en" };
  }
  res.json({ checklist: JSON.parse(row.checklist), lang: row.lang });
}));

app.put("/api/preferences/:userId", ah(async (req, res) => {
  const { userId } = req.params;
  if (userId !== req.session.user.username) {
    return res.status(403).json({ error: "Cannot modify another user's preferences" });
  }
  const { checklist, lang } = req.body;

  await pool.query(
    `INSERT INTO preferences (user_id, checklist, lang) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET checklist = excluded.checklist, lang = excluded.lang`,
    [userId, JSON.stringify(checklist ?? {}), lang ?? "en"]
  );

  res.json({ ok: true });
}));

// Basic error handler so a thrown DB error returns JSON instead of an HTML stack trace.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// ---------------------------------------------------------------
// dbReady resolves once tables exist and demo data is seeded.
// Callers (server.js for a normal host, api/index.js for Vercel) await this
// before handling requests, instead of this file deciding how to start.
const dbReady = initDb().catch((err) => {
  console.error("Failed to initialize database:", err);
  throw err;
});

module.exports = { app, dbReady };
