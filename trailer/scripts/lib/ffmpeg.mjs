import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

/** Runs ffmpeg and resolves with its stderr log. Pass `stdin: true` to get a writable input stream. */
export function ffmpeg(args, { stdin = false } = {}) {
  const proc = spawn(ffmpegPath, ['-hide_banner', '-y', ...args], { stdio: [stdin ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
  let log = '';
  proc.stderr.on('data', (d) => { log += d; });
  const done = new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve(log) : reject(new Error(`ffmpeg exited with ${code}:\n${log.slice(-3000)}`))));
  });
  return { proc, done };
}

export const run = (args) => ffmpeg(args).done;
