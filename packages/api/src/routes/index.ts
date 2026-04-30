import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
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
router.use('/google-calendar', googleCalendarRouter);

// Public: serve attachment files (images in documents) without auth — filenames are random/unguessable
router.get('/documents/attachments/file/:filename', (req, res) => {
  const attachDir = path.join(config.vaultPath, 'Attachments');
  const filePath = path.join(attachDir, req.params['filename']!);
  if (!fs.existsSync(filePath)) { res.status(404).json({ success: false, error: 'File not found' }); return; }
  res.sendFile(filePath);
});

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
router.use('/admin', adminRouter);
