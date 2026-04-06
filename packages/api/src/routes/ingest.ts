import { Router } from 'express';
export const ingestRouter = Router();
ingestRouter.post('/', (_req, res) => res.json({ success: true, data: null }));
ingestRouter.get('/status/:id', (_req, res) => res.json({ success: true, data: null }));
