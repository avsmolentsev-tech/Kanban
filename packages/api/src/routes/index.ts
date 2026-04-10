import { Router } from 'express';
import { projectsRouter } from './projects';
import { tasksRouter } from './tasks';
import { meetingsRouter } from './meetings';
import { peopleRouter } from './people';
import { ingestRouter } from './ingest';
import { aiRouter } from './ai';
import { ideasRouter } from './ideas';
import { documentsRouter } from './documents';
import { searchRouter } from './search';
import { claudeNotesRouter } from './claude-notes';
import { habitsRouter } from './habits';
import { goalsRouter } from './goals';

export const router = Router();

router.use('/projects', projectsRouter);
router.use('/tasks', tasksRouter);
router.use('/meetings', meetingsRouter);
router.use('/people', peopleRouter);
router.use('/ingest', ingestRouter);
router.use('/ai', aiRouter);
router.use('/ideas', ideasRouter);
router.use('/documents', documentsRouter);
router.use('/search', searchRouter);
router.use('/claude-notes', claudeNotesRouter);
router.use('/habits', habitsRouter);
router.use('/goals', goalsRouter);
