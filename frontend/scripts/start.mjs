import { spawn } from 'node:child_process';

const port = process.env.PORT || '3000';

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['next', 'start', '-p', port],
  {
    stdio: 'inherit',
    env: process.env,
    shell: false,
  },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});