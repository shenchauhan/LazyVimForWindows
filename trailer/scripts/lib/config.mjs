import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILD, ROOT } from './paths.mjs';

export function loadScript() {
  return JSON.parse(readFileSync(join(ROOT, 'script.json'), 'utf8'));
}

/**
 * Picks the narrator from `--voice=<id>` (default: the first voice in script.json) and returns
 * its settings plus where its narration, build files, and finished video live.
 */
export function selectVoice(script = loadScript(), argv = process.argv.slice(2)) {
  const ids = Object.keys(script.voices);
  const id = argv.find((a) => a.startsWith('--voice='))?.slice(8) ?? ids[0];
  if (!script.voices[id]) throw new Error(`Unknown voice '${id}'. Choose one of: ${ids.join(', ')}.`);
  const isDefault = id === ids[0];
  return {
    id,
    voice: script.voices[id],
    isDefault,
    voiceDir: join(ROOT, 'assets', 'voice', id),
    buildDir: join(BUILD, id),
    videoName: isDefault ? 'LazyVim-for-Windows-trailer.mp4' : `LazyVim-for-Windows-trailer-${id}.mp4`,
  };
}

/** A script line merged with the narrator's per-line settings (style, rate, delivery, takes). */
export function lineForVoice(line, voice) {
  const own = voice.lines?.[line.id] ?? {};
  return {
    ...line,
    ...own,
    takes: own.takes ?? line.takes ?? voice.takes ?? 1,
    delivery: { ...voice.delivery, ...line.delivery, ...own.delivery },
  };
}
