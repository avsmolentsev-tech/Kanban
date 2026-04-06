import { parseFile, detectFileType } from '../parsers';

describe('parsers', () => {
  it('parses txt content', async () => {
    const result = await parseFile(Buffer.from('Hello world'), 'txt');
    expect(result).toBe('Hello world');
  });

  it('parses md content', async () => {
    const result = await parseFile(Buffer.from('# Title\nContent'), 'md');
    expect(result).toBe('# Title\nContent');
  });

  it('detects file types', () => {
    expect(detectFileType('doc.txt')).toBe('txt');
    expect(detectFileType('notes.md')).toBe('md');
    expect(detectFileType('report.pdf')).toBe('pdf');
    expect(detectFileType('unknown.xyz')).toBe('txt');
  });

  it('throws on unsupported type', async () => {
    await expect(parseFile(Buffer.from('data'), 'docx')).rejects.toThrow('Unsupported file type');
  });
});
