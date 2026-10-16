// ITU-R BS.1770 K-weighted loudness for 48 kHz audio, measured over chosen time regions.

function biquad(x, [b0, b1, b2], [, a1, a2]) {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

function kWeight(x) {
  const shelf = biquad(x, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]);
  return biquad(shelf, [1, -2, 1], [1, -1.99004745483398, 0.99007225036621]);
}

/** Loudness (LUFS, ungated) of `channels` within `regions` ([start, end] seconds). */
export function regionLoudness(channels, sampleRate, regions) {
  let sum = 0;
  let count = 0;
  for (const ch of channels) {
    const k = kWeight(ch);
    for (const [a, b] of regions) {
      const i0 = Math.max(0, Math.floor(a * sampleRate));
      const i1 = Math.min(k.length, Math.floor(b * sampleRate));
      for (let i = i0; i < i1; i++) sum += k[i] * k[i];
      if (ch === channels[0]) count += Math.max(0, i1 - i0);
    }
  }
  return -0.691 + 10 * Math.log10(sum / Math.max(1, count) + 1e-20);
}

/** 400 ms windows (BS.1770 momentary blocks) whose level is above `floorDb`, as regions. */
export function activeRegions(channels, sampleRate, floorDb = -50) {
  const win = Math.round(sampleRate * 0.4);
  const regions = [];
  for (let i = 0; i + win <= channels[0].length; i += win / 2) {
    let sum = 0;
    for (const ch of channels) for (let j = i; j < i + win; j++) sum += ch[j] * ch[j];
    const db = 10 * Math.log10(sum / (win * channels.length) + 1e-20);
    if (db > floorDb) regions.push([i / sampleRate, (i + win) / sampleRate]);
  }
  return regions;
}
