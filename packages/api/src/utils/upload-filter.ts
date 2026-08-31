import type { Request } from 'express';
import * as path from 'path';

// Extensions that can execute script when rendered in a browser. Attachments are
// served to the app origin, so an uploaded .html/.svg would be stored XSS.
const DANGEROUS_EXT = new Set([
  '.html', '.htm', '.xhtml', '.mhtml', '.svg', '.xml', '.js', '.mjs',
  '.php', '.phtml', '.exe', '.sh', '.bat', '.cmd', '.com', '.scr',
]);

/**
 * multer fileFilter for user attachments. Rejects browser-executable types.
 * Pair with the download-forcing headers on the serve route for defense in depth.
 */
export function attachmentFileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
): void {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (DANGEROUS_EXT.has(ext)) {
    cb(new Error(`Тип файла не разрешён: ${ext}`), false);
    return;
  }
  cb(null, true);
}
