import { spawn, ChildProcess } from 'node:child_process';

export interface ClaudeRunnerOpts {
  bin: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export interface RunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export class ClaudeRunner {
  private proc: ChildProcess | null = null;

  constructor(private readonly opts: ClaudeRunnerOpts) {}

  run(stdinInput: string, onOutput: (chunk: string) => void): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.opts.bin, this.opts.args, {
        cwd: this.opts.cwd,
        // IS_SANDBOX=1 tells Claude Code to skip its root-user safety guard —
        // needed because kanban-app on this server runs as root.
        env: { ...process.env, IS_SANDBOX: '1', ...this.opts.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.proc = proc;

      proc.stdout?.on('data', (d: Buffer) => onOutput(d.toString()));
      proc.stderr?.on('data', (d: Buffer) => onOutput(d.toString()));

      proc.on('error', (err) => {
        this.proc = null;
        reject(err);
      });
      proc.on('close', (code, signal) => {
        this.proc = null;
        resolve({ exitCode: code, signal });
      });

      if (stdinInput) proc.stdin?.write(stdinInput + '\n');
      proc.stdin?.end();
    });
  }

  stop(): void {
    if (!this.proc) return;
    const p = this.proc;
    try { p.kill('SIGINT'); } catch {}
    setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 5000).unref?.();
  }

  isRunning(): boolean {
    return this.proc != null && !this.proc.killed;
  }
}
