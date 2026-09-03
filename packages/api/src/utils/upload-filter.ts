import type { Request } from 'express';
import * as path from 'path';
import * as crypto from 'crypto';

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

/**
 * Случайная часть имени файла-вложения. routes/index.ts отдаёт содержимое
 * Attachments/ публично, без авторизации, полагаясь только на то, что имя
 * файла не подобрать. Префикс из id владельца и Date.now() (человекочитаемый,
 * для отладки) — небольшое целое число и энумерируемая метка времени,
 * подбираются перебором; настоящая непредсказуемость имени держится
 * исключительно на этом токене. 16 байт (crypto.randomBytes, 128 бит,
 * 32 hex-символа) делает перебор вычислительно неосуществимым.
 */
export function randomAttachmentToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Имя файла для вложения документа. Префикс "{docId}-{Date.now()}" оставлен
 * для читаемости при отладке — сама непредсказуемость от randomAttachmentToken().
 */
export function documentAttachmentFilename(docId: number, ext: string): string {
  return `${docId}-${Date.now()}-${randomAttachmentToken()}${ext}`;
}

/** Имя файла для фото контакта. См. documentAttachmentFilename(). */
export function personPhotoFilename(personId: number, ext: string): string {
  return `person-${personId}-${Date.now()}-${randomAttachmentToken()}${ext}`;
}

/** Имя файла для вложения задачи. См. documentAttachmentFilename(). */
export function taskAttachmentFilename(taskId: number, ext: string): string {
  return `task-${taskId}-${Date.now()}-${randomAttachmentToken()}${ext}`;
}
