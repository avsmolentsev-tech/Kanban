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
import { journalRouter } from './journal';
import { exportRouter } from './export';
import { tagsRouter } from './tags';
import { templatesRouter } from './templates';
import { emailWebhookRouter } from './email-webhook';
import { widgetRouter } from './widget';
import { googleCalendarRouter } from './google-calendar';
import { authRouter } from './auth';
import { requireAuth } from '../middleware/auth';
import { adminRouter } from './admin';

export const router = Router();

// Public routes (no auth required)
router.use('/auth', authRouter);
router.use('/widget', widgetRouter);
router.use('/email-webhook', emailWebhookRouter);

// All routes below require authentication
router.use(requireAuth);

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
router.use('/journal', journalRouter);
router.use('/export', exportRouter);
router.use('/tags', tagsRouter);
router.use('/templates', templatesRouter);
router.use('/google-calendar', googleCalendarRouter);
router.use('/admin', adminRouter);
