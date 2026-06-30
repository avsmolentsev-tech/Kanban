import { spawn } from 'node:child_process';

export interface VerifyResult {
  passed: boolean;
  output: string;
  command: string;
}

export async function runVerify(cwd: string, command: string): Promise<VerifyResult> {
  const hasScript = await checkScript(cwd, command);
  if (!hasScript) {
    return { passed: true, output: '(no verify command configured)', command };
  }

  return new Promise((resolve) => {
    const [cmd, ...args] = command.split(' ');
    const proc = spawn(cmd!, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
    let output = '';
    proc.stdout.on('data', (d: Buffer) => { output += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { output += d.toString(); });
    proc.on('close', (code) => {
      resolve({
        passed: code === 0,
        output: output.slice(-2000),
        command,
      });
    });
    setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      resolve({ passed: false, output: 'Timeout: verify exceeded 5 minutes', command });
    }, 300_000);
  });
}

async function checkScript(cwd: string, command: string): Promise<boolean> {
  if (!command.startsWith('npm run')) return true;
  const scriptName = command.replace('npm run ', '');
  try {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync(`${cwd}/package.json`, 'utf-8'));
    return !!pkg.scripts?.[scriptName];
  } catch {
    return false;
  }
}

export function formatVerifyResult(result: VerifyResult): string {
  if (result.passed) {
    return `🧪 Verify: ✅ PASS\n🔨 Command: ${result.command}`;
  }
  return `🧪 Verify: ❌ FAIL\n🔨 Command: ${result.command}\n\n${result.output.slice(-500)}`;
}
