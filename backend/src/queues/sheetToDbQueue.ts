import { Queue } from 'bullmq';
import { redis } from '../config/redis';
import { SheetToDbJobData } from '../types';

export const SHEET_TO_DB_QUEUE_NAME = 'sheet-to-db';

let queue: Queue<SheetToDbJobData> | null = null;

/**
 * Get or create the Sheet to DB queue.
 * Lazy initialization to avoid calling redis.createConnection() before Redis is initialized.
 */
export function getSheetToDbQueue(): Queue<SheetToDbJobData> {
  if (!queue) {
    queue = new Queue<SheetToDbJobData>(SHEET_TO_DB_QUEUE_NAME, {
      connection: redis.createConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 1000,
        removeOnFail: 2000,
      },
    });
  }
  return queue;
}

export async function enqueueSheetToDbJob(data: Omit<SheetToDbJobData, 'retryCount'>): Promise<void> {
  await getSheetToDbQueue().add('cell-change', { ...data, retryCount: 0 }, { jobId: data.jobId });
}
