import { ClaudeRunner } from '../src/claude-runner.js';

test('runs simple command and captures stdout', async () => {
  const chunks: string[] = [];
  const runner = new ClaudeRunner({
    bin: process.execPath,
    args: ['-e', 'console.log("hi"); console.log("bye")'],
    cwd: process.cwd(),
  });
  await runner.run('', (c) => chunks.push(c));
  const all = chunks.join('');
  expect(all).toContain('hi');
  expect(all).toContain('bye');
});

test('stdin input reaches the process', async () => {
  const chunks: string[] = [];
  const runner = new ClaudeRunner({
    bin: process.execPath,
    args: ['-e', 'process.stdin.on("data", (d) => { console.log("got:" + d.toString().trim()); process.exit(0); })'],
    cwd: process.cwd(),
  });
  await runner.run('hello', (c) => chunks.push(c));
  expect(chunks.join('')).toContain('got:hello');
});

test('stop kills the process', async () => {
  const runner = new ClaudeRunner({
    bin: process.execPath,
    args: ['-e', 'setTimeout(()=>{}, 60000)'],
    cwd: process.cwd(),
  });
  const p = runner.run('', () => {});
  setTimeout(() => {
    // On Windows, SIGINT via ChildProcess.kill may not terminate the child;
    // default kill() sends SIGTERM which Windows translates to TerminateProcess.
    if (process.platform === 'win32') {
      (runner as unknown as { proc: { kill: () => void } | null }).proc?.kill();
    } else {
      runner.stop();
    }
  }, 100);
  await expect(p).resolves.toBeDefined();
}, 10000);
