const { Pool } = require("pg");

// Load env only in local (Render already provides env)
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  // Neon / Render requires SSL
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
});

module.exports = pool;