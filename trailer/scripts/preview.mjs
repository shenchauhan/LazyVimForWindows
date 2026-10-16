// Serves the trailer for live preview in a browser. Click the page to play with sound;
// add ?t=SECONDS to the URL to start (or freeze) at a specific moment.
// Usage: node scripts/preview.mjs [port]
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer } from './lib/browser.mjs';
import { BUILD } from './lib/paths.mjs';
import { loadTimeline } from './lib/timeline.mjs';

writeFileSync(join(BUILD, 'timeline.json'), JSON.stringify(loadTimeline(), null, 1));
if (!existsSync(join(BUILD, 'soundtrack.wav'))) {
  console.warn('No build/soundtrack.wav yet; run `npm run build:preview` first to hear the audio.');
}
const { url } = await startServer(Number(process.argv[2] ?? 8123));
console.log(`Preview: ${url}/web/trailer.html  (click to play, Ctrl+C to stop)`);
