import 'dotenv/config';
import express from 'express';
import cors from 'cors';
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

  const extensionOrigin = process.env.EXTENSION_ORIGIN || '*';
  app.use(cors({ origin: extensionOrigin }));
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
