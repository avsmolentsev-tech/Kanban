import { Router } from 'express';
export const aiRouter = Router();
aiRouter.post('/chat', (_req, res) => res.json({ success: true, data: { reply: '' } }));
aiRouter.post('/daily-brief', (_req, res) => res.json({ success: true, data: { brief: '' } }));
