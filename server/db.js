const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const dbPath = path.join(__dirname, "matchday.sqlite");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

// ---------------- SCHEMA ----------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('organizer', 'volunteer')),
    display_name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS zones (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'low'
  );

  CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    severity TEXT NOT NULL,
    location TEXT NOT NULL,
    created_at TEXT NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS preferences (
    user_id TEXT PRIMARY KEY, -- stores the authenticated user's username
    checklist TEXT NOT NULL DEFAULT '{}',
    lang TEXT NOT NULL DEFAULT 'en'
  );
`);

// ---------------- SEED USERS (only if empty) ----------------
const userCount = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
if (userCount === 0) {
  const insertUser = db.prepare(
    "INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, ?, ?)"
  );
  const demoUsers = [
    { username: "organizer1", password: "organizer123", role: "organizer", displayName: "Ops Lead — Mariana" },
    { username: "volunteer1", password: "volunteer123", role: "volunteer", displayName: "Volunteer — Diego" },
  ];
  demoUsers.forEach((u) => {
    const hash = bcrypt.hashSync(u.password, 10);
    insertUser.run(u.username, hash, u.role, u.displayName);
  });
  console.log("Seeded demo accounts: organizer1/organizer123, volunteer1/volunteer123 — change these before real use.");
}

// ---------------- SEED ZONES (only if empty) ----------------
const zoneSeed = [
  { id: "gateA", name: "Gate A" },
  { id: "gateC", name: "Gate C" },
  { id: "metro", name: "Metro Link" },
  { id: "concourse", name: "Concourse" },
  { id: "vip", name: "Palcos/VIP" },
  { id: "gateD", name: "Gate D" },
];

const zoneCount = db.prepare("SELECT COUNT(*) AS c FROM zones").get().c;
if (zoneCount === 0) {
  const insert = db.prepare("INSERT INTO zones (id, name, status) VALUES (?, ?, 'low')");
  const insertMany = db.transaction((rows) => {
    for (const z of rows) insert.run(z.id, z.name);
  });
  insertMany(zoneSeed);
}

module.exports = db;
