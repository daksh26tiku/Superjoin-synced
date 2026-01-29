import { Worker, Job } from 'bullmq';
import { redis } from '../../config/redis';
import { db } from '../../config/database';
import { googleSheetsService } from '../../services/GoogleSheetsService';
import { logger } from '../../utils/logger';
import { DbToSheetJobData } from '../dbToSheetQueue';

let worker: Worker<DbToSheetJobData> | null = null;

/**
 * Process a single DB -> Sheet sync job.
 * Updates the Google Sheet with the row data from MySQL.
 */
async function processJob(job: Job<DbToSheetJobData>): Promise<void> {
  const { tableName, sheetId, sheetName, rowId, row, values, columnMapping } = job.data;

  logger.info('Processing DB->Sheet sync job', {
    jobId: job.id,
    sheetId,
    rowId,
    row,
  });

  try {
    // Update the Google Sheet
    await googleSheetsService.updateSheetRow({
      spreadsheetId: sheetId,
      sheetName,
      row,
      values,
      columnMapping,
    });

    // Mark as SYNCED in the database
    await db.execute(
      `UPDATE \`${tableName}\` 
       SET _sync_status = 'SYNCED', 
           _synced_at = NOW() 
       WHERE _sync_row_id = ?`,
      [rowId]
    );

    logger.info('DB->Sheet sync completed', {
      jobId: job.id,
      sheetId,
      rowId,
      row,
    });

    // Log to sync_audit_log for Live Event Feed
    await db.execute(
      `INSERT INTO sync_audit_log (operation_type, details, created_at)
       VALUES ('DB_TO_SHEET', ?, NOW())`,
      [JSON.stringify({ message: `Row ${row} synced to ${sheetName}`, rowId, sheetId })]
    );
  } catch (error: any) {
    logger.error('DB->Sheet sync failed', {
      jobId: job.id,
      sheetId,
      rowId,
      error: error.message,
    });

    // Mark as ERROR in the database
    await db.execute(
      `UPDATE \`${tableName}\` 
       SET _sync_status = 'ERROR' 
       WHERE _sync_row_id = ?`,
      [rowId]
    );

    throw error; // Re-throw to trigger BullMQ retry
  }
}

/**
 * Start the DB -> Sheet worker.
 */
export function startDbToSheetWorker(): void {
  if (worker) {
    logger.warn('DB to Sheet worker already running');
    return;
  }

  worker = new Worker<DbToSheetJobData>(
    'db-to-sheet',
    processJob,
    {
      connection: redis.getClient(),
      concurrency: 5,
      limiter: {
        max: 50,
        duration: 60000, // 50 jobs per minute (respects Google API rate limits)
      },
    }
  );

  worker.on('completed', (job) => {
    logger.debug('DB->Sheet job completed', { jobId: job.id });
  });

  worker.on('failed', (job, error) => {
    logger.error('DB->Sheet job failed', {
      jobId: job?.id,
      error: error.message,
      attempts: job?.attemptsMade,
    });
  });

  worker.on('error', (error) => {
    logger.error('DB->Sheet worker error', { error: error.message });
  });

  logger.info('DB to Sheet worker started');
}

/**
 * Stop the DB -> Sheet worker gracefully.
 */
export async function stopDbToSheetWorker(): Promise<void> {
  if (!worker) {
    return;
  }

  logger.info('Stopping DB to Sheet worker...');
  await worker.close();
  worker = null;
  logger.info('DB to Sheet worker stopped');
}
