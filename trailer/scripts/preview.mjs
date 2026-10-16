// Serves the trailer for live preview in a browser. Click the page to play with sound;
// add ?t=SECONDS to the URL to start (or freeze) at a specific moment, and ?voice=<id> to pick
// the narrator.
// Usage: node scripts/preview.mjs [port]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer } from './lib/browser.mjs';
import { loadScript, selectVoice } from './lib/config.mjs';
import { ROOT } from './lib/paths.mjs';
import { loadTimeline } from './lib/timeline.mjs';

const script = loadScript();
const voices = Object.keys(script.voices)
  .map((id) => selectVoice(script, [`--voice=${id}`]))
  .filter((v) => existsSync(join(ROOT, 'assets', 'voice', v.id, 'manifest.json')));
if (!voices.length) throw new Error('No narration yet. Run npm run voice first.');

const port = Number(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 8123);
const { url } = await startServer(port);
for (const { id, buildDir } of voices) {
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(join(buildDir, 'timeline.json'), JSON.stringify(loadTimeline({ voice: id }), null, 1));
  const audio = existsSync(join(buildDir, 'soundtrack.wav')) ? '' : `  (silent: run npm run build:preview -- --voice=${id} for audio)`;
  console.log(`Preview: ${url}/web/trailer.html?voice=${id}${audio}`);
}
console.log('Click the page to play. Ctrl+C to stop.');
