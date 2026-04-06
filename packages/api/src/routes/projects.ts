import { Router } from 'express';
export const projectsRouter = Router();
projectsRouter.get('/', (_req, res) => res.json({ success: true, data: [] }));
