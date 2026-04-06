import { Router } from 'express';
export const meetingsRouter = Router();
meetingsRouter.get('/', (_req, res) => res.json({ success: true, data: [] }));
