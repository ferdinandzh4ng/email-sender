import pg from 'pg';
import dns from 'dns';

const { Pool } = pg;

// Force DNS lookups to try IPv4 first. Render cannot reach IPv6 addresses,
// and Supabase hostnames resolve to both. Without this, pg may pick IPv6
// and fail with ENETUNREACH.
const _origLookup = dns.lookup;
dns.lookup = function (hostname, options, cb) {
  if (typeof options === 'function') {
    cb = options;
    options = {};
  } else if (typeof options === 'number') {
    options = { family: options };
  } else {
    options = { ...options };
  }
  const origFamily = options.family;
  options.family = 4;
  _origLookup.call(this, hostname, options, (err, address, family) => {
    if (err && (!origFamily || origFamily === 0)) {
      delete options.family;
      return _origLookup.call(this, hostname, options, cb);
    }
    cb(err, address, family);
  });
};

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

/** Returns the underlying pg Pool for use by connect-pg-simple etc. Call after initDb(). */
export function getPool() {
  if (!pool) throw new Error('DB not initialized. Call await initDb() first.');
  return pool;
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
  try {
    const u = new URL(trimmed.replace(/^postgresql:\/\//, 'https://'));
    if (!u.hostname || u.hostname === '$' || u.hostname.length < 2) {
      throw new Error('DATABASE_URL host is missing or invalid. Encode special characters in the password (e.g. @ → %40, $ → %24).');
    }
  } catch (e) {
    if (e.message && e.message.includes('DATABASE_URL')) throw e;
    throw new Error(
      'DATABASE_URL could not be parsed. Encode special chars in password: # → %23, @ → %40, $ → %24, / → %2F, ? → %3F'
    );
  }

  pool = new Pool({
    connectionString: trimmed,
    ssl: trimmed.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });
  return db;
}
