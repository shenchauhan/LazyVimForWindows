// Quality checks for a finished build: narration intelligibility over the music (Azure speech to
// text on the final mix), loudness, and output format.
// Usage: node scripts/qa.mjs [path/to/trailer.mp4]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSpeechCredentials, transcribe } from './lib/azure.mjs';
import { run } from './lib/ffmpeg.mjs';
import { BUILD, ROOT } from './lib/paths.mjs';

const video = process.argv[2] ?? join(ROOT, 'dist', 'LazyVim-for-Windows-trailer.mp4');
const script = JSON.parse(readFileSync(join(ROOT, 'script.json'), 'utf8'));
const words = (s) => s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/-/g, ' ').split(/\s+/).filter(Boolean);
const joined = (s) => words(s).join('');

/** Character error rate on letters and digits only, so "Lazy Vim" and "LazyVim" compare equal. */
function cer(reference, hypothesis) {
  const a = joined(reference);
  const b = joined(hypothesis);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] / a.length;
}

const info = await run(['-i', video, '-f', 'null', '-']).catch((e) => e.message);
const streams = info.split('\n').filter((l) => /Duration|Stream #/.test(l)).map((l) => l.trim());
console.log(`Output: ${video}`);
streams.forEach((s) => console.log(`  ${s}`));

const wav = join(BUILD, 'qa-mix.wav');
await run(['-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
const log = await run(['-i', video, '-vn', '-af', 'loudnorm=print_format=json', '-f', 'null', '-']);
const m = JSON.parse(log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1));
console.log(`Loudness: ${m.input_i} LUFS integrated, ${m.input_tp} dBTP true peak, ${m.input_lra} LU range`);

const result = await transcribe(getSpeechCredentials(), readFileSync(wav));
const reference = script.lines.map((l) => l.text).join(' ');
console.log(`Narration heard over the music:\n  "${result.text}"`);
console.log(`Character error rate vs script: ${(cer(reference, result.text) * 100).toFixed(1)}%`);
const missing = words(reference).filter((w) => !joined(result.text).includes(w.replace(/-/g, '')));
if (missing.length) console.log(`Words not recognized: ${[...new Set(missing)].join(', ')}`);
