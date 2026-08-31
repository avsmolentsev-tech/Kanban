import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ObsidianService } from '../services/obsidian.service';

describe('ObsidianService', () => {
  let tmpDir: string;
  let service: ObsidianService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pis-test-'));
    service = new ObsidianService(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('writes a task file with correct frontmatter', async () => {
    const vaultPath = await service.writeTask({
      title: 'Test Task', status: 'todo', priority: 3, urgency: 3, project: 'TestProject',
    });
    const content = fs.readFileSync(path.join(tmpDir, vaultPath), 'utf-8');
    expect(content).toContain('type: task');
    expect(content).toContain('status: todo');
    expect(content).toContain('priority: 3');
    expect(content).toContain('# Test Task');
  });

  it('generates correct file name for meetings', () => {
    const name = service.meetingFileName('2026-04-06', 'Test Meeting');
    expect(name).toMatch(/^2026-04-06-.+\.md$/);
  });

  it('writes a person file', async () => {
    const vaultPath = await service.writePerson({ name: 'Ivan Petrov', company: 'ACME' });
    const content = fs.readFileSync(path.join(tmpDir, vaultPath), 'utf-8');
    expect(content).toContain('type: person');
    expect(content).toContain('name: "Ivan Petrov"');
  });

  it('initializes vault folders', () => {
    service.initVaultFolders();
    expect(fs.existsSync(path.join(tmpDir, 'Tasks'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'Meetings'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'People'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'Inbox'))).toBe(true);
  });
});
