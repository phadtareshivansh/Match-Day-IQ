// Neon's own driver: connects over HTTP instead of a raw TCP+TLS socket or
// a WebSocket. Both socket-based transports were getting reset between
// Vercel's function and Neon (ECONNRESET on raw TLS, then again on
// WebSocket) even though Neon's own SQL Editor — which talks over HTTP —
// worked instantly. That comparison is what pointed at HTTP as the
// transport that actually survives this network path.
const { Pool, neonConfig } = require("@neondatabase/serverless");
const bcrypt = require("bcryptjs");

neonConfig.poolQueryViaFetch = true;

if (!process.env.DATABASE_URL) {
  console.warn(
    "Warning: DATABASE_URL is not set. Copy the pooled connection string " +
    "from the Neon dashboard -> Connect (hostname should contain '-pooler')."
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5, // serverless: many short-lived function instances, keep each pool small
});

// ---------------- SCHEMA ----------------
// Neon's serverless driver runs each query as a prepared statement, which
// (unlike plain `pg`'s simple query protocol) does not allow multiple
// semicolon-separated statements in a single call — so these run as four
// separate queries instead of one combined string.
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('organizer', 'volunteer')),
      display_name TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS zones (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'low'
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS incidents (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      location TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      resolved BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS preferences (
      user_id TEXT PRIMARY KEY,
      checklist TEXT NOT NULL DEFAULT '{}',
      lang TEXT NOT NULL DEFAULT 'en'
    )
  `);
}

// ---------------- SEED USERS (only if empty) ----------------
async function seedUsers() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM users");
  if (rows[0].c > 0) return;

  const demoUsers = [
    { username: "organizer1", password: "organizer123", role: "organizer", displayName: "Ops Lead — Mariana" },
    { username: "volunteer1", password: "volunteer123", role: "volunteer", displayName: "Volunteer — Diego" },
  ];
  for (const u of demoUsers) {
    const hash = bcrypt.hashSync(u.password, 10);
    await pool.query(
      "INSERT INTO users (username, password_hash, role, display_name) VALUES ($1, $2, $3, $4)",
      [u.username, hash, u.role, u.displayName]
    );
  }
  console.log("Seeded demo accounts: organizer1/organizer123, volunteer1/volunteer123 — change these before real use.");
}

// ---------------- SEED ZONES (only if empty) ----------------
async function seedZones() {
  const zoneSeed = [
    { id: "gateA", name: "Gate A" },
    { id: "gateC", name: "Gate C" },
    { id: "metro", name: "Metro Link" },
    { id: "concourse", name: "Concourse" },
    { id: "vip", name: "Palcos/VIP" },
    { id: "gateD", name: "Gate D" },
  ];

  const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM zones");
  if (rows[0].c > 0) return;

  for (const z of zoneSeed) {
    await pool.query("INSERT INTO zones (id, name, status) VALUES ($1, $2, 'low')", [z.id, z.name]);
  }
}

// Called once at server startup, before app.listen().
async function initDb() {
  await initSchema();
  await seedUsers();
  await seedZones();
}

module.exports = { pool, initDb };
