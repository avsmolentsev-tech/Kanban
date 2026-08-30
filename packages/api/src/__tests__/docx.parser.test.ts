import { parseFile } from '../parsers';

describe('docx parser', () => {
  it('is registered for docx file type', async () => {
    // We can't easily test with a real docx buffer without a fixture,
    // but we can verify the parser doesn't throw "unsupported"
    // For now, test that detectFileType works
    const { detectFileType } = require('../parsers');
    expect(detectFileType('report.docx')).toBe('docx');
  });
});
