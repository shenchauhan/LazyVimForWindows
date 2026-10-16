// Generates the narration with MAI-Voice-2.1-Flash, checks each take with speech-to-text,
// tightens long pauses, and records word timings used to sync the visuals.
// Usage: node scripts/voice.mjs [--voice=<id>] [--force] [--only=id1,id2]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSpeechCredentials, synthesize, transcribe } from './lib/azure.mjs';
import { lineForVoice, loadScript, selectVoice } from './lib/config.mjs';
import { findUntranscribedSpeech, tightenTake, writeWav16 } from './lib/edit.mjs';
import { BUILD } from './lib/paths.mjs';
import { analyzeProsody } from './lib/prosody.mjs';
import { readWav } from './lib/wav.mjs';

const script = loadScript();
const { id: voiceId, voice, voiceDir: VOICE_DIR } = selectVoice(script);
const RAW_DIR = join(BUILD, 'voice-raw', voiceId);
const MANIFEST = join(VOICE_DIR, 'manifest.json');
const MAX_TAKES = 5;

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');

const escapeXml = (s) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const letters = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function buildSsml(voice, line) {
  let body = escapeXml(line.text);
  if (line.rate) body = `<prosody rate="${line.rate}">${body}</prosody>`;
  if (line.style) body = `<mstts:express-as style="${line.style}">${body}</mstts:express-as>`;
  return '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ' +
    `xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="${voice.locale}">` +
    `<voice name="${voice.name}:${voice.model}">${body}</voice></speak>`;
}

/** Lists problems with a take: missing, extra, or repeated words, and unexplained vocal sounds. */
function reviewTake(line, take) {
  const heard = letters(take.text);
  const missing = line.text.split(/[\s-]+/).map(letters).filter((t) => t && !heard.includes(t));
  // Walk the transcript through the script in order so stutters and ad-libs stand out.
  const target = letters(line.text);
  const extra = [];
  let p = 0;
  for (const token of take.text.split(/[\s-]+/).map(letters).filter(Boolean)) {
    const at = target.indexOf(token, p);
    if (at >= 0 && at - p <= 3) p = at + token.length;
    else extra.push(token);
  }
  const { sampleRate, channels } = take.audio;
  const sounds = findUntranscribedSpeech(channels[0], sampleRate, take.words);
  return [
    ...missing.map((m) => `missing "${m}"`),
    ...extra.map((m) => `unexpected "${m}"`),
    ...sounds.map((r) => `unexpected sound at ${r.start.toFixed(2)}-${r.end.toFixed(2)}s`),
  ];
}

async function recordTake(credentials, ssml, locale) {
  const wav = await synthesize(credentials, ssml);
  const { text, words } = await transcribe(credentials, wav, locale);
  const tmp = join(RAW_DIR, `take-${process.pid}.wav`);
  writeFileSync(tmp, wav);
  return { text, words, audio: readWav(tmp) };
}

/**
 * How far a take's prosody strays from the delivery target, in semitones: outside the pitch band
 * (too flat-sounding below it, too hyped above it) or outside the pitch-movement band (monotone,
 * or sing-song).
 */
function deliveryPenalty(p, { pitchHz, pitchSd } = {}) {
  let penalty = 0;
  if (pitchHz) {
    const [lo, hi] = pitchHz;
    if (p.medianHz < lo) penalty += 12 * Math.log2(lo / p.medianHz);
    if (p.medianHz > hi) penalty += 12 * Math.log2(p.medianHz / hi);
  }
  if (pitchSd) {
    const [lo, hi] = pitchSd;
    if (p.sdSt < lo) penalty += 2 * (lo - p.sdSt);
    if (p.sdSt > hi) penalty += p.sdSt - hi;
  }
  return penalty;
}

function describeProsody(take) {
  const p = take.prosody;
  return `${Math.round(p.medianHz)} Hz ±${p.sdSt.toFixed(1)} st`;
}

mkdirSync(VOICE_DIR, { recursive: true });
mkdirSync(RAW_DIR, { recursive: true });
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
let credentials;
console.log(`Narrator: ${voiceId} (${voice.name}:${voice.model})`);

for (const scriptLine of script.lines) {
  const line = lineForVoice(scriptLine, voice);
  const ssml = buildSsml(voice, line);
  const edit = { maxPause: line.maxPause ?? 0.4, keepPause: line.keepPause ?? 0.3 };
  const wanted = line.takes;
  const delivery = line.delivery;
  const hash = createHash('sha256').update(ssml + JSON.stringify({ wanted, delivery })).digest('hex').slice(0, 16);
  const editHash = createHash('sha256').update(JSON.stringify(edit)).digest('hex').slice(0, 8);
  const file = join(VOICE_DIR, `${line.id}.wav`);
  const rawFile = join(RAW_DIR, `${line.id}-${hash}.wav`);
  const entry = manifest[line.id];
  const selected = !only || only.includes(line.id);
  if (!selected || (!force && entry?.hash === hash && entry?.editHash === editHash && existsSync(file))) {
    if (entry) console.log(`= ${line.id.padEnd(11)} ${entry.duration.toFixed(2)}s  "${entry.transcript}"`);
    continue;
  }

  let take;
  if (!force && existsSync(rawFile) && existsSync(`${rawFile}.json`)) {
    take = { ...JSON.parse(readFileSync(`${rawFile}.json`, 'utf8')), audio: readWav(rawFile) };
  } else {
    credentials ??= getSpeechCredentials();
    // Collect `takes` clean takes and keep the one closest to the delivery target (then the
    // snappiest); anything that fails review is retaken.
    const clean = [];
    let best;
    for (let n = 1; n <= MAX_TAKES + wanted - 1 && clean.length < wanted; n++) {
      const candidate = await recordTake(credentials, ssml, voice.locale);
      candidate.problems = reviewTake(line, candidate);
      if (!best || candidate.problems.length < best.problems.length) best = candidate;
      if (!candidate.problems.length) {
        const { sampleRate, channels } = candidate.audio;
        candidate.length = tightenTake(channels[0], sampleRate, candidate.words, edit).samples.length;
        candidate.prosody = analyzeProsody(channels[0], sampleRate);
        candidate.penalty = deliveryPenalty(candidate.prosody, delivery);
        clean.push(candidate);
      } else {
        console.warn(`  ${line.id} take ${n}: "${candidate.text}" -> ${candidate.problems.join('; ')}`);
      }
    }
    if (clean.length) {
      // Closest to the target first; among equally good takes, prefer movement near the middle
      // of the band, then pitch near the middle of the band, then the snappiest.
      const mid = (band) => (band ? (band[0] + band[1]) / 2 : 0);
      const sdMid = mid(delivery.pitchSd);
      const hzMid = mid(delivery.pitchHz);
      clean.sort((a, b) => a.penalty - b.penalty
        || (sdMid ? Math.abs(a.prosody.sdSt - sdMid) - Math.abs(b.prosody.sdSt - sdMid) : 0)
        || (hzMid ? Math.abs(Math.log2(a.prosody.medianHz / hzMid)) - Math.abs(Math.log2(b.prosody.medianHz / hzMid)) : 0)
        || a.length - b.length);
      best = clean[0];
      if (clean.length > 1) console.log(`  ${line.id} takes: ${clean.map((c, i) => `${describeProsody(c)}${i ? '' : ' (kept)'}`).join(', ')}`);
    } else {
      console.warn(`! ${line.id} kept a take with issues: ${best.problems.join('; ')}`);
    }
    take = best;
    writeWav16(rawFile, take.audio.channels[0], take.audio.sampleRate);
    writeFileSync(`${rawFile}.json`, JSON.stringify({ text: take.text, words: take.words }, null, 2));
  }

  const { sampleRate, channels } = take.audio;
  const tight = tightenTake(channels[0], sampleRate, take.words, edit);
  writeWav16(file, tight.samples, sampleRate);
  const prosody = analyzeProsody(tight.samples, sampleRate);
  const spoken = tight.words.length ? tight.words.at(-1).end - tight.words[0].start : 0;
  manifest[line.id] = {
    hash,
    editHash,
    file: `${line.id}.wav`,
    duration: +(tight.samples.length / sampleRate).toFixed(3),
    rawDuration: +(channels[0].length / sampleRate).toFixed(3),
    transcript: take.text,
    prosody: { ...prosody, wordsPerSecond: spoken ? +(tight.words.length / spoken).toFixed(2) : 0 },
    words: tight.words,
  };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  const e = manifest[line.id];
  console.log(`+ ${line.id.padEnd(11)} ${e.duration.toFixed(2)}s  ${describeProsody(e)}  "${e.transcript}"`);
}

const ids = new Set(script.lines.map((l) => l.id));
for (const id of Object.keys(manifest)) if (!ids.has(id)) delete manifest[id];
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
