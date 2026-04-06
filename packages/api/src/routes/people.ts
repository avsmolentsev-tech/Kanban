import { Router } from 'express';
export const peopleRouter = Router();
peopleRouter.get('/', (_req, res) => res.json({ success: true, data: [] }));
