import pg from 'pg';
const { Pool } = pg;

let pool;

function toPgParams(sql) {
  let n = 0;
  const out = sql.replace(/\?/g, () => `$${++n}`);
  return out;
}

async function query(sql, params = []) {
  const pgSql = toPgParams(sql);
  const normalized = params.map((p) => (p === undefined ? null : p));
  const res = await pool.query(pgSql, normalized);
  return res;
}

export const db = {
  async run(sql, ...params) {
    await query(sql, params);
  },
  async get(sql, ...params) {
    const res = await query(sql, params);
    return res.rows[0] ?? null;
  },
  async all(sql, ...params) {
    const res = await query(sql, params);
    return res.rows;
  },
};

export function getDb() {
  if (!pool) throw new Error('DB not initialized. Call await initDb() first.');
  return db;
}

export async function initDb() {
  if (pool) return db;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required (Supabase Postgres connection string). See README.');
  }
  pool = new Pool({
    connectionString,
    ssl: connectionString.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });
  return db;
}
