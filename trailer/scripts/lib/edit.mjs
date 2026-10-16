import { writeFileSync } from 'node:fs';

const FRAME = 0.01;

function frameDb(samples, sampleRate) {
  const win = Math.round(sampleRate * FRAME);
  const out = new Float32Array(Math.floor(samples.length / win));
  for (let f = 0; f < out.length; f++) {
    let sum = 0;
    for (let j = f * win; j < (f + 1) * win; j++) sum += samples[j] * samples[j];
    out[f] = 10 * Math.log10(sum / win + 1e-12);
  }
  return out;
}

/** Returns loud regions (seconds) that no recognized word covers, e.g. stutters the recognizer dropped. */
export function findUntranscribedSpeech(samples, sampleRate, words, { thresholdDb = -32, minLength = 0.12, slack = 0.15 } = {}) {
  const db = frameDb(samples, sampleRate);
  const covered = (t) => words.some((w) => t >= w.start - slack && t <= w.end + slack);
  const regions = [];
  let start = -1;
  for (let f = 0; f <= db.length; f++) {
    const t = f * FRAME;
    const hit = f < db.length && db[f] > thresholdDb && !covered(t);
    if (hit && start < 0) start = t;
    if (!hit && start >= 0) {
      if (t - start >= minLength) regions.push({ start, end: t });
      start = -1;
    }
  }
  return regions;
}

/**
 * Shortens long silent pauses and trims the ends of a narration take. Returns the new samples,
 * remapped word timings, and the regions that were removed.
 */
export function tightenTake(samples, sampleRate, words, { maxPause = 0.4, keepPause = 0.3, silenceDb = -55, head = 0.04, tail = 0.12 } = {}) {
  const db = frameDb(samples, sampleRate);
  const loud = [];
  for (let f = 0; f < db.length; f++) if (db[f] > silenceDb) loud.push(f);
  if (!loud.length) return { samples, words, removed: [] };

  const first = loud[0] * FRAME;
  const last = (loud.at(-1) + 1) * FRAME;
  const removed = [];
  if (first - head > 0) removed.push([0, first - head]);

  let runStart = -1;
  for (let f = loud[0]; f <= loud.at(-1); f++) {
    const silent = db[f] <= silenceDb;
    if (silent && runStart < 0) runStart = f;
    if (!silent && runStart >= 0) {
      const a = runStart * FRAME;
      const b = f * FRAME;
      if (b - a > maxPause) removed.push([a + keepPause / 2, b - keepPause / 2]);
      runStart = -1;
    }
  }
  const total = samples.length / sampleRate;
  if (last + tail < total) removed.push([last + tail, total]);

  const keep = [];
  let cursor = 0;
  for (const [a, b] of removed) {
    if (a > cursor) keep.push([cursor, a]);
    cursor = b;
  }
  if (cursor < total) keep.push([cursor, total]);

  const fade = Math.round(sampleRate * 0.004);
  const pieces = keep.map(([a, b]) => samples.slice(Math.round(a * sampleRate), Math.round(b * sampleRate)));
  const out = new Float32Array(pieces.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of pieces) {
    // Tiny fades keep the joins click-free even if a cut lands on low-level noise.
    for (let i = 0; i < Math.min(fade, p.length); i++) {
      p[i] *= i / fade;
      p[p.length - 1 - i] *= i / fade;
    }
    out.set(p, offset);
    offset += p.length;
  }

  const shift = (t) => {
    let s = 0;
    for (const [a, b] of removed) {
      if (t >= b) s += b - a;
      else if (t > a) s += t - a;
    }
    return +(t - s).toFixed(3);
  };
  return {
    samples: out,
    words: words.map((w) => ({ ...w, start: shift(w.start), end: shift(w.end) })),
    removed: removed.map(([a, b]) => [+a.toFixed(3), +b.toFixed(3)]),
  };
}

/** Writes mono samples as a 16-bit PCM WAV file. */
export function writeWav16(path, samples, sampleRate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVEfmt ', 8, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  }
  writeFileSync(path, buf);
}
