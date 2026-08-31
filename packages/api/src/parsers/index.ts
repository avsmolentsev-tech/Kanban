import { parseTxt } from './txt.parser';
import { parsePdf } from './pdf.parser';
import { parseDocx } from './docx.parser';
import { parseImage } from './image.parser';
import { parseAudio } from './audio.parser';
import { parseUrl } from './url.parser';
import type { IngestFileType } from '@pis/shared';

export { parseUrl } from './url.parser';

export async function parseFile(buffer: Buffer, fileType: IngestFileType): Promise<string> {
  switch (fileType) {
    case 'txt':
    case 'md':
      return parseTxt(buffer);
    case 'pdf':
      return parsePdf(buffer);
    case 'docx':
      return parseDocx(buffer);
    case 'png':
    case 'jpg':
    case 'jpeg':
      return parseImage(buffer, fileType);
    case 'mp3':
    case 'wav':
    case 'm4a':
    case 'ogg':
      return parseAudio(buffer, fileType);
    case 'url':
      throw new Error('URL parsing requires a URL string, not a buffer. Use parseUrl() directly.');
    default:
      throw new Error(`Unsupported file type in Phase 1: ${fileType}`);
  }
}

export function detectFileType(filename: string): IngestFileType {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, IngestFileType> = {
    txt: 'txt', md: 'md', pdf: 'pdf', docx: 'docx',
    png: 'png', jpg: 'jpg', jpeg: 'jpeg',
    mp3: 'mp3', wav: 'wav', m4a: 'm4a', ogg: 'ogg',
  };
  return map[ext] ?? 'txt';
}
