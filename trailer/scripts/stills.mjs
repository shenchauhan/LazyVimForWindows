// Renders still frames for reviewing the design without encoding a video.
// Usage: node scripts/stills.mjs 1.5 12.4 30 [--out=build/stills]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, openTrailerPage, startServer } from './lib/browser.mjs';
import { BUILD } from './lib/paths.mjs';
import { loadTimeline } from './lib/timeline.mjs';

const args = process.argv.slice(2);
const out = args.find((a) => a.startsWith('--out='))?.slice(6) ?? join(BUILD, 'stills');
const times = args.filter((a) => !a.startsWith('--')).map(Number);
mkdirSync(out, { recursive: true });

const timeline = loadTimeline();
const { server, url } = await startServer();
const browser = await launchBrowser();
try {
  const page = await openTrailerPage(browser, url, timeline);
  for (const t of times) {
    await page.evaluate((time) => window.TRAILER.seek(time), t);
    const file = join(out, `still-${t.toFixed(2).padStart(6, '0')}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
} finally {
  await browser.close();
  server.close();
}
