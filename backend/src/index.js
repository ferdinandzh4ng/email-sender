import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './db.js';
import authRoutes from './routes/auth.js';
import campaignRoutes from './routes/campaigns.js';
import templateRoutes from './routes/templates.js';
import { startScheduler } from './scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function start() {
  await initDb();
  const app = express();

  const allowed = process.env.ALLOWED_ORIGINS || process.env.EXTENSION_ORIGIN || process.env.WEB_APP_ORIGIN || '*';
  const raw = typeof allowed === 'string' && allowed.includes(',')
    ? allowed.split(',').map((o) => o.trim()).filter(Boolean)
    : [allowed].flat();
  const normalize = (o) => (o || '').trim().replace(/\/+$/, '');
  const origins = raw.map(normalize).filter(Boolean);
  const allowCredentials = origins.length > 0 && origins[0] !== '*';
  app.use(cors({
    origin: origins.length > 1
      ? (origin, cb) => {
          const norm = normalize(origin);
          const ok = norm && origins.includes(norm);
          cb(null, ok ? origin : origins[0]);
        }
      : origins[0] === '*'
        ? '*'
        : (origin, cb) => {
            const norm = normalize(origin);
            cb(null, norm && origins.includes(norm) ? origin : false);
          },
    credentials: allowCredentials,
  }));

  const sessionSecret = process.env.SESSION_SECRET || process.env.ENCRYPTION_KEY || 'dev-secret-change-in-production';
  app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    name: 'email-sender.sid',
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  }));

  app.use(express.json({ limit: '30mb' }));
  app.use(express.static(join(__dirname, '..')));

  app.use('/', authRoutes);
  app.use('/campaigns', campaignRoutes);
  app.use('/templates', templateRoutes);

  app.get('/health', (req, res) => res.json({ ok: true }));

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
    startScheduler();
  });
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
