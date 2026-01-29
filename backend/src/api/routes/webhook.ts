import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';
import { enqueueSheetToDbJob } from '../../queues/sheetToDbQueue';
import { SheetWebhookPayload } from '../../types';

export const webhookRouter = Router();

function isValidPayload(body: any): body is SheetWebhookPayload {
  return (
    body &&
    typeof body.sheetId === 'string' &&
    typeof body.sheetName === 'string' &&
    typeof body.row === 'number' &&
    typeof body.col === 'number' &&
    'value' in body &&
    typeof body.timestamp === 'string'
  );
}

webhookRouter.post('/webhook', async (req: Request, res: Response) => {
  try {
    if (!isValidPayload(req.body)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PAYLOAD', message: 'Invalid webhook payload' },
        timestamp: new Date().toISOString(),
      });
    }

    const payload = req.body;
    const jobId = uuidv4();

    await enqueueSheetToDbJob({
      jobId,
      sheetId: payload.sheetId,
      sheetName: payload.sheetName,
      row: payload.row,
      col: payload.col,
      value: payload.value,
      timestamp: payload.timestamp,
    });

    return res.status(202).json({
      success: true,
      data: { jobId },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to enqueue webhook job', { error });
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to process webhook' },
      timestamp: new Date().toISOString(),
    });
  }
});
