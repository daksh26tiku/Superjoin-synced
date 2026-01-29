import { Queue } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';

export interface DbToSheetJobData {
  tableName: string;
  sheetId: string;
  sheetName: string;
  rowId: string;
  row: number;
  values: Record<string, unknown>;
  columnMapping: Record<string, string>;
  timestamp: string;
}

let queue: Queue<DbToSheetJobData> | null = null;

/**
 * Get or create the DB to Sheet queue.
 * Lazy initialization to avoid calling redis.getClient() before Redis is initialized.
 */
export function getDbToSheetQueue(): Queue<DbToSheetJobData> {
  if (!queue) {
    queue = new Queue<DbToSheetJobData>('db-to-sheet', {
      connection: redis.getClient(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: {
          count: 1000,
          age: 24 * 60 * 60, // 24 hours
        },
        removeOnFail: {
          count: 500,
        },
      },
    });

    queue.on('error', (error) => {
      logger.error('DB to Sheet queue error', { error: error.message });
    });

    logger.info('DB to Sheet queue initialized');
  }

  return queue;
}
