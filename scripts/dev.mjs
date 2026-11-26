import { spawn } from 'node:child_process';

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const serverProc = spawn(npmCmd, ['run', 'dev:server'], {
  stdio: 'inherit',
});

const clientProc = spawn(npmCmd, ['run', 'dev:client'], {
  stdio: 'inherit',
});

let exiting = false;

function shutdown(code = 0) {
  if (exiting) return;
  exiting = true;
  serverProc.kill('SIGTERM');
  clientProc.kill('SIGTERM');
  process.exit(code);
}

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));

serverProc.on('exit', (code) => {
  if (!exiting) shutdown(code ?? 1);
});

clientProc.on('exit', (code) => {
  if (!exiting) shutdown(code ?? 0);
});
