// Vercel catch-all serverless function. Routes any /api/* request through
// the same handler the local Node server uses. Static files in /public are
// served by Vercel's static layer before reaching this function.
const handler = require('../backend/server');
module.exports = (req, res) => handler(req, res);
