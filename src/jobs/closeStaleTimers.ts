import cron from 'node-cron';
import { closeStaleLogs } from '../service/timeLogService';

export function startStaleTimerJob() {
  // Check every minute so an 8-hour session is closed promptly when it reaches 8 hours
  cron.schedule('0 * * * *', async () => {
    try {
      await closeStaleLogs();
    } catch (e) {
      console.error('Stale timer job failed', e);
    }
  });
}