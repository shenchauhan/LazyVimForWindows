import { readFileSync, writeFileSync } from 'node:fs';

/** Reads a PCM16 / PCM24 / Float32 WAV file into per-channel Float32Arrays. */
export function readWav(path) {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path} is not a RIFF/WAVE file.`);
  }

  let format;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
      if (format.audioFormat === 0xfffe && size >= 26) {
        format.audioFormat = buf.readUInt16LE(body + 24);
      }
    } else if (id === 'data') {
      if (!format) throw new Error(`${path} has a data chunk before its fmt chunk.`);
      // Streaming TTS responses can report a placeholder size; clamp to the real file length.
      const dataSize = Math.min(size, buf.length - body);
      return decode(buf.subarray(body, body + dataSize), format);
    }
    offset = body + size + (size % 2);
  }
  throw new Error(`${path} has no data chunk.`);
}

function decode(data, { audioFormat, channels, sampleRate, bitsPerSample }) {
  const bytes = bitsPerSample / 8;
  const frames = Math.floor(data.length / (bytes * channels));
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const p = (i * channels + c) * bytes;
      let v;
      if (audioFormat === 3 && bitsPerSample === 32) v = data.readFloatLE(p);
      else if (audioFormat === 1 && bitsPerSample === 16) v = data.readInt16LE(p) / 32768;
      else if (audioFormat === 1 && bitsPerSample === 24) v = data.readIntLE(p, 3) / 8388608;
      else throw new Error(`Unsupported WAV format ${audioFormat}/${bitsPerSample}-bit.`);
      out[c][i] = v;
    }
  }
  return { sampleRate, channels: out };
}

/** Writes per-channel Float32Arrays as a 32-bit float WAV file. */
export function writeWavFloat(path, channels, sampleRate) {
  const frames = channels[0].length;
  const n = channels.length;
  const dataSize = frames * n * 4;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20);
  buf.writeUInt16LE(n, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * n * 4, 28);
  buf.writeUInt16LE(n * 4, 32);
  buf.writeUInt16LE(32, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  let p = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < n; c++, p += 4) buf.writeFloatLE(channels[c][i], p);
  }
  writeFileSync(path, buf);
}

/** Finds where audible content starts and ends, using a short RMS window. */
export function findSpeechBounds(samples, sampleRate, thresholdDb = -45) {
  const win = Math.round(sampleRate * 0.01);
  const threshold = 10 ** (thresholdDb / 20);
  let first = -1;
  let last = -1;
  for (let i = 0; i + win <= samples.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += samples[j] * samples[j];
    if (Math.sqrt(sum / win) >= threshold) {
      if (first < 0) first = i;
      last = i + win;
    }
  }
  if (first < 0) return { start: 0, end: samples.length / sampleRate };
  return { start: first / sampleRate, end: last / sampleRate };
}
