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
import { todoistRouter } from './todoist';
import { yandexCalendarRouter } from './yandex-calendar';
import { authRouter } from './auth';
import { requireAuth } from '../middleware/auth';
import { adminRouter } from './admin';
import { downloadMeetingHandler } from './meetings';
import { advisorsRouter } from './advisors';
import { commitmentsRouter } from './commitments';
import { transcribeRouter } from './transcribe';
import { apiTokensRouter } from './api-tokens';
import { docsRouter } from './docs';

export const router = Router();

// Public routes (no auth required)
router.use('/auth', authRouter);
router.use(docsRouter); // GET /openapi.yaml, GET /docs — без авторизации
router.use('/widget', widgetRouter);
router.use('/email-webhook', emailWebhookRouter);
router.use('/google-calendar', googleCalendarRouter);
router.use('/todoist', todoistRouter);
router.use('/yandex-calendar', yandexCalendarRouter);

// Public: serve attachment files (images in documents) without auth — filenames are random/unguessable
const INLINE_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.ico']);
router.get('/documents/attachments/file/:filename', (req, res) => {
  const attachDir = path.resolve(config.vaultPath, 'Attachments');
  const filename = path.basename(req.params['filename']!); // strip any ../ sequences
  const filePath = path.join(attachDir, filename);
  if (!filePath.startsWith(attachDir) || !fs.existsSync(filePath)) {
    res.status(404).json({ success: false, error: 'File not found' });
    return;
  }
  // Never let the browser sniff/execute content. Images render inline; anything
  // else (e.g. a stray uploaded HTML/SVG) is forced to download, not rendered.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!INLINE_IMAGE_EXT.has(path.extname(filename).toLowerCase())) {
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  }
  res.sendFile(filePath);
});

// Public: meeting file download — authorized by a scoped ?token= (browser
// navigations can't send an Authorization header). The handler auths itself.
router.get('/meetings/:id/download', downloadMeetingHandler);

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
router.use('/advisors', advisorsRouter);
router.use('/commitments', commitmentsRouter);
router.use('/transcribe', transcribeRouter);
router.use('/api-tokens', apiTokensRouter);
router.use('/admin', adminRouter);
