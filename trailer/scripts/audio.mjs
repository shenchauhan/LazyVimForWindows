// Renders the music, sound-effect, and narration stems in headless Edge, balances them so the
// music sits well under the voice, and masters the mix to streaming loudness.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser, startServer } from './lib/browser.mjs';
import { run } from './lib/ffmpeg.mjs';
import { activeRegions, regionLoudness } from './lib/loudness.mjs';
import { BUILD } from './lib/paths.mjs';
import { loadTimeline } from './lib/timeline.mjs';
import { writeWavFloat } from './lib/wav.mjs';

// Loudness targets (LUFS). Music is measured only while the narrator is speaking.
export const MIX = { voice: -16, musicUnderVoice: -16, sfx: -27, master: -14, ceiling: 0.79 };

async function renderStems(timeline) {
  const { server, url } = await startServer();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(`${url}/web/audio.html`);
    const info = await page.evaluate(([tl, voiceUrl]) => window.SCORE.render(tl, voiceUrl), [timeline, `${url}/assets/voice`]);
    const stems = {};
    for (const [name, { channels, length, sampleRate }] of Object.entries(info)) {
      const data = [];
      for (let c = 0; c < channels; c++) {
        const samples = new Float32Array(length);
        const step = 1 << 20;
        for (let start = 0; start < length; start += step) {
          const b64 = await page.evaluate(([n, ch, s, l]) => window.SCORE.chunk(n, ch, s, l), [name, c, start, Math.min(step, length - start)]);
          const bytes = Buffer.from(b64, 'base64');
          const chunk = new Float32Array(bytes.byteLength / 4);
          new Uint8Array(chunk.buffer).set(bytes);
          samples.set(chunk, start);
        }
        data.push(samples);
      }
      stems[name] = { sampleRate, channels: data };
      writeWavFloat(join(BUILD, `${name}.wav`), data, sampleRate);
    }
    return stems;
  } finally {
    await browser.close();
    server.close();
  }
}

function balance(timeline, { voice, music, sfx }) {
  const sr = voice.sampleRate;
  const speech = timeline.lines.map((l) => [l.start, l.end]);
  const gain = (target, measured) => 10 ** ((target - measured) / 20);
  const g = {
    voice: gain(MIX.voice, regionLoudness(voice.channels, sr, speech)),
    music: gain(MIX.voice + MIX.musicUnderVoice, regionLoudness(music.channels, sr, speech)),
    sfx: gain(MIX.sfx, regionLoudness(sfx.channels, sr, activeRegions(sfx.channels, sr, -45))),
  };
  const length = Math.max(voice.channels[0].length, music.channels[0].length, sfx.channels[0].length);
  const mixed = [0, 1].map((c) => {
    const out = new Float32Array(length);
    for (const [name, stem] of Object.entries({ voice, music, sfx })) {
      const ch = stem.channels[Math.min(c, stem.channels.length - 1)];
      for (let i = 0; i < ch.length; i++) out[i] += g[name] * ch[i];
    }
    return out;
  });

  // Report how far the bed sits under each line so the narration stays front and center.
  const bed = [0, 1].map((c) => {
    const out = new Float32Array(length);
    for (const [name, stem] of Object.entries({ music, sfx })) {
      const ch = stem.channels[c];
      for (let i = 0; i < ch.length; i++) out[i] += g[name] * ch[i];
    }
    return out;
  });
  const scaledVoice = voice.channels.map((ch) => ch.map((v) => v * g.voice));
  const report = timeline.lines.map((l) => ({
    id: l.id,
    voice: regionLoudness(scaledVoice, sr, [[l.start, l.end]]),
    bed: regionLoudness(bed, sr, [[l.start, l.end]]),
  }));
  const gaps = [];
  for (let i = 1; i < timeline.lines.length; i++) {
    const a = timeline.lines[i - 1].end + 0.5;
    const b = timeline.lines[i].start - 0.2;
    if (b - a > 0.4) gaps.push([a, b]);
  }
  return { mixed, gains: g, report, bedInGaps: regionLoudness(bed, sr, gaps), sampleRate: sr };
}

async function measure(file) {
  const log = await run(['-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-']);
  const m = JSON.parse(log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1));
  return { i: Number(m.input_i), tp: Number(m.input_tp), lra: Number(m.input_lra) };
}

// Gain to the target loudness, then a lookahead limiter keeps peaks below the ceiling
// (about -1.5 dBTP). A second pass corrects the small loudness loss from limiting.
async function master(input, output) {
  let gain = MIX.master - (await measure(input)).i;
  let result;
  for (let pass = 0; pass < 2; pass++) {
    const filter = `volume=${gain.toFixed(2)}dB,alimiter=limit=${MIX.ceiling}:attack=4:release=60:level=false`;
    await run(['-i', input, '-af', filter, '-ar', '48000', '-c:a', 'pcm_s24le', output]);
    result = await measure(output);
    if (Math.abs(result.i - MIX.master) < 0.2) break;
    gain += MIX.master - result.i;
  }
  return result;
}

export async function buildSoundtrack(timeline) {
  mkdirSync(BUILD, { recursive: true });
  const stems = await renderStems(timeline);
  const { mixed, gains, report, bedInGaps, sampleRate } = balance(timeline, stems);
  const mixFile = join(BUILD, 'mix.wav');
  writeWavFloat(mixFile, mixed, sampleRate);
  const result = await master(mixFile, join(BUILD, 'soundtrack.wav'));
  return { gains, report, bedInGaps, result };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { gains, report, bedInGaps, result } = await buildSoundtrack(loadTimeline());
  const db = (g) => `${(20 * Math.log10(g)).toFixed(1)} dB`;
  console.log(`stem gains: voice ${db(gains.voice)}, music ${db(gains.music)}, sfx ${db(gains.sfx)}`);
  for (const r of report) console.log(`  ${r.id.padEnd(11)} voice ${r.voice.toFixed(1)} LUFS, bed ${r.bed.toFixed(1)} LUFS (${(r.voice - r.bed).toFixed(1)} dB under)`);
  console.log(`bed between lines: ${bedInGaps.toFixed(1)} LUFS`);
  console.log(`master: ${result.i} LUFS integrated, true peak ${result.tp} dBTP, loudness range ${result.lra} LU`);
}
