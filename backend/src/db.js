import pg from 'pg';
import dns from 'dns';

const { Pool } = pg;
const dnsPromises = dns.promises;

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
  if (!connectionString || typeof connectionString !== 'string') {
    throw new Error('DATABASE_URL is required (Supabase Postgres connection string). See README.');
  }
  const trimmed = connectionString.trim();
  if (trimmed.length < 20 || trimmed.startsWith('$')) {
    throw new Error(
      'DATABASE_URL looks invalid (e.g. placeholder or empty host). ' +
      'Set it to the full Postgres URL from Supabase (Project Settings → Database). ' +
      'Encode special chars in password: # → %23, @ → %40, $ → %24, / → %2F, ? → %3F'
    );
  }
  let parsed;
  try {
    const u = new URL(trimmed.replace(/^postgresql:\/\//, 'https://'));
    if (!u.hostname || u.hostname === '$' || u.hostname.length < 2) {
      throw new Error('DATABASE_URL host is missing or invalid. Encode special characters in the password (e.g. @ → %40, $ → %24).');
    }
    parsed = u;
  } catch (e) {
    if (e.message && e.message.includes('DATABASE_URL')) throw e;
    throw new Error(
      'DATABASE_URL could not be parsed. Encode special chars in password: # → %23, @ → %40, $ → %24, / → %2F, ? → %3F'
    );
  }

  const hostname = parsed.hostname;
  const useSsl = trimmed.includes('supabase');
  let poolConfig;

  try {
    const ipv4 = await dnsPromises.resolve4(hostname);
    if (ipv4 && ipv4.length > 0) {
      poolConfig = {
        host: ipv4[0],
        port: parseInt(parsed.port || '5432', 10),
        user: decodeURIComponent(parsed.username || 'postgres'),
        password: decodeURIComponent(parsed.password || ''),
        database: (parsed.pathname || '/postgres').slice(1) || 'postgres',
        ssl: useSsl ? { rejectUnauthorized: false, servername: hostname } : undefined,
      };
    }
  } catch (_) {}

  if (!poolConfig) {
    poolConfig = {
      connectionString: trimmed,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    };
  }

  pool = new Pool(poolConfig);
  return db;
}
