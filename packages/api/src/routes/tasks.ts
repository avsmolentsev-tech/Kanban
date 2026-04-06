import { Router } from 'express';
export const tasksRouter = Router();
tasksRouter.get('/', (_req, res) => res.json({ success: true, data: [] }));
