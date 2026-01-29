import { Router } from 'express';
import { webhookRouter } from './webhook';

export const apiRouter = Router();

apiRouter.use(webhookRouter);
