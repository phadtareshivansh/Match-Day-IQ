// Vercel entry point. Every request to /api/* is routed here (see
// vercel.json). This wraps the exact same Express app used by server.js on
// a normal host — no duplicated route logic.
const serverless = require("serverless-http");
const { app, dbReady } = require("../server/app");

const handler = serverless(app);

module.exports = async (req, res) => {
  try {
    await dbReady; // safe to await repeatedly; resolves once, cached across warm invocations
  } catch (err) {
    res.statusCode = 500;
    res.end("Database initialization failed — check DATABASE_URL in Vercel project settings.");
    return;
  }
  return handler(req, res);
};
