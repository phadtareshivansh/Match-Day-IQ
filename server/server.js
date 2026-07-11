// Entry point for any normal host that runs a persistent Node process
// (Render, Railway, Fly, a VPS, or your own machine). Vercel does not use
// this file — see api/index.js instead, since Vercel runs serverless
// functions rather than a long-running server.
const { app, dbReady } = require("./app");

const PORT = process.env.PORT || 3000;

dbReady
  .then(() => {
    app.listen(PORT, () => {
      console.log(`MatchDay IQ full-stack server running at http://localhost:${PORT}`);
    });
  })
  .catch(() => process.exit(1));
