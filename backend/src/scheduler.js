import cron from 'node-cron';
import { processDueJobs } from './routes/campaigns.js';

export function startScheduler() {
  // Run every minute
  cron.schedule('* * * * *', async () => {
    try {
      await processDueJobs();
    } catch (err) {
      console.error('Scheduler error:', err);
    }
  });
  console.log('Scheduler started (every minute)');
}
