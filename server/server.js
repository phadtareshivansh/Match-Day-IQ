const path = require("path");
const express = require("express");
const session = require("express-session");
const { createClient } = require("redis");
const RedisStore = require("connect-redis").default;
const bcrypt = require("bcryptjs");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.connect().catch((err) => {
  console.error("Redis connection error:", err);
});

app.use(express.json());
app.use(
  session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSION_SECRET || "matchday-iq-dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 8 * 60 * 60 * 1000, // 8-hour shift-length session
      sameSite: "lax",
    },
  })
);

const STATUS_CYCLE = ["low", "moderate", "high", "severe"];

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
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
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
});

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
app.get("/api/zones", (req, res) => {
  const rows = db.prepare("SELECT id, name, status FROM zones").all();
  res.json(rows);
});

// Cycle a single zone to its next status (low -> moderate -> high -> severe -> low)
app.post("/api/zones/:id/cycle", (req, res) => {
  const { id } = req.params;
  const zone = db.prepare("SELECT * FROM zones WHERE id = ?").get(id);
  if (!zone) return res.status(404).json({ error: "Zone not found" });

  const nextIdx = (STATUS_CYCLE.indexOf(zone.status) + 1) % STATUS_CYCLE.length;
  const nextStatus = STATUS_CYCLE[nextIdx];

  db.prepare("UPDATE zones SET status = ? WHERE id = ?").run(nextStatus, id);
  res.json({ id, status: nextStatus });
});

// ---------------------------------------------------------------
// INCIDENTS — shared operational log
// ---------------------------------------------------------------
app.get("/api/incidents", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM incidents ORDER BY id DESC LIMIT 100")
    .all();
  res.json(rows);
});

app.post("/api/incidents", (req, res) => {
  const { type, severity, location } = req.body;
  if (!type || !severity || !location) {
    return res.status(400).json({ error: "type, severity, and location are required" });
  }
  const createdAt = new Date().toISOString();
  const info = db
    .prepare(
      "INSERT INTO incidents (type, severity, location, created_at) VALUES (?, ?, ?, ?)"
    )
    .run(type, severity, location, createdAt);

  const incident = db.prepare("SELECT * FROM incidents WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json(incident);
});

// Organizer-only: resolving an incident is a decision-making action,
// restricted to the Organizer role.
app.post("/api/incidents/:id/resolve", requireRole("organizer"), (req, res) => {
  const { id } = req.params;
  const info = db.prepare("UPDATE incidents SET resolved = 1 WHERE id = ?").run(id);
  if (info.changes === 0) return res.status(404).json({ error: "Incident not found" });
  res.json({ id, resolved: true });
});

// ---------------------------------------------------------------
// PREFERENCES — personal per-user (checklist progress + language)
// Keyed by the authenticated username. A user may only read/write their own.
// ---------------------------------------------------------------
app.get("/api/preferences/:userId", (req, res) => {
  const { userId } = req.params;
  if (userId !== req.session.user.username) {
    return res.status(403).json({ error: "Cannot access another user's preferences" });
  }

  let row = db.prepare("SELECT * FROM preferences WHERE user_id = ?").get(userId);
  if (!row) {
    db.prepare("INSERT INTO preferences (user_id, checklist, lang) VALUES (?, '{}', 'en')").run(userId);
    row = { user_id: userId, checklist: "{}", lang: "en" };
  }
  res.json({ checklist: JSON.parse(row.checklist), lang: row.lang });
});

app.put("/api/preferences/:userId", (req, res) => {
  const { userId } = req.params;
  if (userId !== req.session.user.username) {
    return res.status(403).json({ error: "Cannot modify another user's preferences" });
  }
  const { checklist, lang } = req.body;

  db.prepare(
    `INSERT INTO preferences (user_id, checklist, lang) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET checklist = excluded.checklist, lang = excluded.lang`
  ).run(userId, JSON.stringify(checklist ?? {}), lang ?? "en");

  res.json({ ok: true });
});

// ---------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`MatchDay IQ full-stack server running at http://localhost:${PORT}`);
});
