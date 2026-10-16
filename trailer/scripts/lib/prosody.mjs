// Pitch and vocal-effort statistics for judging how calm or lively a narration take sounds.
// Pitch is tracked with the YIN algorithm on a 16 kHz copy of the signal.

function yin(frame, sr, minTau, maxTau, threshold) {
  // The frame holds 2 * maxTau + 2 samples, so lags up to maxTau + 1 (needed for interpolation) are valid.
  const w = frame.length - maxTau - 1;
  const d = new Float64Array(maxTau + 2);
  for (let tau = 1; tau <= maxTau + 1; tau++) {
    let sum = 0;
    for (let i = 0; i < w; i++) {
      const diff = frame[i] - frame[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  // Cumulative mean normalized difference.
  let running = 0;
  const cmnd = new Float64Array(maxTau + 2);
  cmnd[0] = 1;
  for (let tau = 1; tau <= maxTau + 1; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= maxTau && cmnd[tau + 1] < cmnd[tau]) tau++;
      // Parabolic interpolation for sub-sample accuracy.
      const a = cmnd[tau - 1];
      const b = cmnd[tau];
      const c = cmnd[tau + 1];
      const denom = a - 2 * b + c;
      const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
      return sr / (tau + Math.max(-1, Math.min(1, shift)));
    }
  }
  return 0;
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];

/**
 * Returns { medianHz, sdSt, rangeSt, voiced, effortDb } for mono samples.
 * - medianHz: typical pitch; it rises sharply when a voice gets excited or shouty.
 * - sdSt / rangeSt: pitch movement in semitones (SD and 10th–90th percentile range); low values sound monotone.
 * - effortDb: share of energy above 1 kHz; louder, pushed delivery is brighter (closer to 0 dB).
 */
export function analyzeProsody(samples, sampleRate, { fmin = 60, fmax = 500, threshold = 0.12 } = {}) {
  const factor = Math.max(1, Math.floor(sampleRate / 16000));
  const sr = sampleRate / factor;
  const n = Math.floor(samples.length / factor);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += samples[i * factor + k];
    x[i] = s / factor;
  }

  const minTau = Math.floor(sr / fmax);
  const maxTau = Math.ceil(sr / fmin);
  const len = maxTau * 2 + 2;
  const hop = Math.round(sr * 0.01);
  const frames = [];
  for (let start = 0; start + len <= n; start += hop) {
    const frame = x.subarray(start, start + len);
    let e = 0;
    for (let i = 0; i < frame.length; i++) e += frame[i] * frame[i];
    frames.push({ start, db: 10 * Math.log10(e / len + 1e-12), frame });
  }
  if (!frames.length) return { medianHz: 0, sdSt: 0, rangeSt: 0, voiced: 0, effortDb: -99 };
  const levels = frames.map((f) => f.db).sort((a, b) => a - b);
  const gate = Math.max(-45, percentile(levels, 0.95) - 25);
  const active = frames.filter((f) => f.db > gate);
  const raw = frames.map((f) => (f.db > gate ? yin(f.frame, sr, minTau, maxTau, threshold) : 0));

  // Median-filter the pitch track over voiced neighbours to remove octave blips.
  const smooth = raw.map((v, i) => {
    if (!v) return 0;
    const near = raw.slice(Math.max(0, i - 2), i + 3).filter(Boolean).sort((a, b) => a - b);
    return near[Math.floor(near.length / 2)];
  });
  const voicedHz = smooth.filter(Boolean).sort((a, b) => a - b);
  if (voicedHz.length < 5) return { medianHz: 0, sdSt: 0, rangeSt: 0, voiced: 0, effortDb: -99 };
  const medianHz = percentile(voicedHz, 0.5);
  const st = voicedHz.filter((f) => f > medianHz / 2.2 && f < medianHz * 2.2).map((f) => 12 * Math.log2(f / 100));
  const mean = st.reduce((s, v) => s + v, 0) / st.length;
  const sdSt = Math.sqrt(st.reduce((s, v) => s + (v - mean) ** 2, 0) / st.length);
  const sortedSt = [...st].sort((a, b) => a - b);

  // Energy above ~1 kHz relative to total, over the active frames.
  const rc = 1 / (2 * Math.PI * 1000);
  const alpha = rc / (rc + 1 / sr);
  let hp = 0;
  let prev = 0;
  let total = 0;
  let high = 0;
  let k = 0;
  const activeStarts = new Set(active.map((f) => f.start));
  for (let i = 0; i < n; i++) {
    hp = alpha * (hp + x[i] - prev);
    prev = x[i];
    const frameStart = Math.floor(i / hop) * hop;
    if (activeStarts.has(frameStart)) {
      total += x[i] * x[i];
      high += hp * hp;
      k++;
    }
  }

  return {
    medianHz: +medianHz.toFixed(1),
    sdSt: +sdSt.toFixed(2),
    rangeSt: +(percentile(sortedSt, 0.9) - percentile(sortedSt, 0.1)).toFixed(2),
    voiced: +(voicedHz.length / Math.max(1, active.length)).toFixed(2),
    effortDb: k ? +(10 * Math.log10(high / Math.max(total, 1e-12))).toFixed(1) : -99,
  };
}
