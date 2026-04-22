// utils/db.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Unexpected DB pool error:', err);
});

const db = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  pool,
};

module.exports = db;
