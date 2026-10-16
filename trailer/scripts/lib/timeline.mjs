import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadScript, selectVoice } from './config.mjs';
import { regionLoudness } from './loudness.mjs';
import { ROOT } from './paths.mjs';
import { readWav } from './wav.mjs';

const letters = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Finds the audible onset of a word, refining the recognizer's timestamp against the waveform. */
function wordOnset(file, word) {
  const { sampleRate, channels } = readWav(file);
  const x = channels[0];
  const win = Math.round(sampleRate * 0.005);
  const from = Math.max(0, Math.round((word.start - 0.12) * sampleRate));
  const to = Math.min(x.length - win, Math.round((word.start + 0.12) * sampleRate));
  for (let i = from; i < to; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += x[j] * x[j];
    if (10 * Math.log10(sum / win + 1e-12) > -35) return i / sampleRate;
  }
  return word.start;
}

/**
 * Lays the narration out scene by scene. Scene ends snap to the music grid, and anchored words
 * restart the grid so musical entrances land exactly on key words. Narration files are read from
 * assets/voice/<voiceId>/.
 */
export function buildTimeline(script, manifest, { fps = 60, voiceId } = {}) {
  const voicePath = (file) => join(ROOT, 'assets', 'voice', voiceId, file);
  const beat = 60 / script.music.bpm;
  let origin = 0;
  const snapUp = (t, beats) => origin + Math.ceil((t - origin) / (beat * beats) - 1e-6) * beat * beats;
  const round = (t) => +t.toFixed(4);
  const scenes = [];
  const lines = [];
  const anchors = {};
  const grids = [{ from: 0, origin: 0 }];
  let t = 0;

  for (const scene of script.scenes) {
    const start = t;
    let cursor = start + (scene.leadIn ?? 0);
    for (const [i, ref] of scene.lines.entries()) {
      const entry = manifest[ref.id];
      if (!entry) throw new Error(`No '${voiceId}' narration for '${ref.id}'. Run npm run voice -- --voice=${voiceId} first.`);
      if (i > 0) cursor += ref.gap ?? 0.25;
      let lineStart = cursor;
      if (ref.anchor) {
        const word = entry.words.find((w) => letters(w.text).startsWith(letters(ref.anchor.word)));
        if (!word) throw new Error(`Anchor word '${ref.anchor.word}' not found in '${ref.id}'.`);
        const onset = wordOnset(voicePath(entry.file), word);
        // A reset anchor restarts the beat grid on the word (used after musical breaks);
        // otherwise the word waits for the next grid line.
        const hit = ref.anchor.reset ? cursor + onset : snapUp(cursor + onset, ref.anchor.beats ?? 4);
        if (ref.anchor.reset) {
          origin = hit;
          grids.push({ from: round(hit), origin: round(hit) });
        }
        lineStart = hit - onset;
        anchors[ref.id] = round(hit);
      }
      lines.push({
        id: ref.id,
        scene: scene.id,
        // Relative to assets/voice/, which is where the soundtrack renderer fetches narration from.
        file: `${voiceId}/${entry.file}`,
        start: round(lineStart),
        end: round(lineStart + entry.duration),
        words: entry.words.map((w) => ({ text: w.text, start: round(lineStart + w.start), end: round(lineStart + w.end) })),
      });
      cursor = lineStart + entry.duration;
    }
    if (scene.endBars) {
      // Land a closing chord right after the last word, then let it ring for `endBars` bars.
      anchors.finalChord = round(snapUp(cursor + 0.15, 4));
      t = anchors.finalChord + scene.endBars * 4 * beat;
    } else {
      t = snapUp(cursor + (scene.tail ?? 0), scene.snap ?? 1);
    }
    scenes.push({ id: scene.id, start: round(start), end: round(t) });
  }

  const sceneById = Object.fromEntries(scenes.map((s) => [s.id, s]));

  // Level the narration: pull each line 60% of the way toward the average loudness so the
  // delivery stays expressive but no line jumps out or gets buried.
  for (const line of lines) {
    const { sampleRate, channels } = readWav(join(ROOT, 'assets', 'voice', line.file));
    line.loudness = +regionLoudness(channels, sampleRate, [[0, channels[0].length / sampleRate]]).toFixed(2);
  }
  const mean = lines.reduce((s, l) => s + l.loudness, 0) / lines.length;
  for (const line of lines) line.gainDb = +(0.6 * (mean - line.loudness)).toFixed(2);

  return {
    fps,
    width: 1920,
    height: 1080,
    voice: voiceId,
    // 0 = calm, 1 = full-on; scales motion, beat-reactive effects, and transitions in the visuals.
    energy: script.energy ?? 0.5,
    bpm: script.music.bpm,
    beat: round(beat),
    duration: round(t),
    grids,
    scenes,
    lines,
    events: {
      // The intro music winds down here, before the hook.
      introEnd: sceneById.struggle.end,
      // The band comes in on "LazyVim".
      title: anchors['hook-2'],
      buildStart: sceneById.launch.start,
      // The dashboard appears on "there it is".
      reveal: anchors['launch-2'],
      outro: sceneById.cta.start,
      finalChord: anchors.finalChord ?? round(t),
      end: round(t),
    },
  };
}

/** Builds the timeline for one narrator (default: the first voice in script.json). */
export function loadTimeline({ fps, voice } = {}) {
  const script = loadScript();
  const voiceId = voice ?? selectVoice(script, []).id;
  const manifest = JSON.parse(readFileSync(join(ROOT, 'assets', 'voice', voiceId, 'manifest.json'), 'utf8'));
  return buildTimeline(script, manifest, { fps, voiceId });
}
