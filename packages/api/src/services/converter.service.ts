import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/** Convert markdown file to PDF via pandoc + wkhtmltopdf */
export function mdToPdf(mdPath: string): string {
  const pdfPath = mdPath.replace(/\.md$/, '.pdf');
  try {
    execSync(`pandoc "${mdPath}" -o "${pdfPath}" --pdf-engine=wkhtmltopdf -V margin-top=20 -V margin-bottom=20 -V margin-left=20 -V margin-right=20 --metadata title=" "`, {
      timeout: 60000,
    });
    return pdfPath;
  } catch (err) {
    // Fallback: simple HTML → PDF
    try {
      const htmlPath = mdPath.replace(/\.md$/, '.html');
      execSync(`pandoc "${mdPath}" -o "${htmlPath}" --standalone --metadata title=" "`, { timeout: 30000 });
      execSync(`wkhtmltopdf --quiet "${htmlPath}" "${pdfPath}"`, { timeout: 60000 });
      try { fs.unlinkSync(htmlPath); } catch {}
      return pdfPath;
    } catch {
      throw new Error('PDF conversion failed: ' + (err instanceof Error ? err.message : 'unknown'));
    }
  }
}

/** Convert markdown file to DOCX via pandoc */
export function mdToDocx(mdPath: string): string {
  const docxPath = mdPath.replace(/\.md$/, '.docx');
  try {
    execSync(`pandoc "${mdPath}" -o "${docxPath}"`, { timeout: 30000 });
    return docxPath;
  } catch (err) {
    throw new Error('DOCX conversion failed: ' + (err instanceof Error ? err.message : 'unknown'));
  }
}

/** Convert markdown file to TXT (plain text, stripped of markdown) */
export function mdToTxt(mdPath: string): string {
  const txtPath = mdPath.replace(/\.md$/, '.txt');
  try {
    execSync(`pandoc "${mdPath}" -t plain -o "${txtPath}"`, { timeout: 30000 });
    return txtPath;
  } catch (err) {
    throw new Error('TXT conversion failed: ' + (err instanceof Error ? err.message : 'unknown'));
  }
}

/** Generate all formats from a markdown file. Returns paths to created files. */
export function generateAllFormats(mdPath: string): { md: string; pdf?: string; docx?: string; txt?: string } {
  const result: { md: string; pdf?: string; docx?: string; txt?: string } = { md: mdPath };

  try { result.pdf = mdToPdf(mdPath); } catch (e) { console.warn('[converter] PDF failed:', e); }
  try { result.docx = mdToDocx(mdPath); } catch (e) { console.warn('[converter] DOCX failed:', e); }
  try { result.txt = mdToTxt(mdPath); } catch (e) { console.warn('[converter] TXT failed:', e); }

  return result;
}
