// Builds the trailer: timeline -> soundtrack -> frames -> final MP4 (plus a poster frame).
// Usage: node scripts/build.mjs [--preview]
//   --preview  renders at 960x540 / 30 fps for a quick look.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSoundtrack } from './audio.mjs';
import { launchBrowser, openTrailerPage, startServer } from './lib/browser.mjs';
import { run } from './lib/ffmpeg.mjs';
import { BUILD, ROOT } from './lib/paths.mjs';
import { loadTimeline } from './lib/timeline.mjs';
import { renderVideo } from './render.mjs';

const preview = process.argv.includes('--preview');
const fps = preview ? 30 : 60;
const DIST = join(ROOT, 'dist');
mkdirSync(BUILD, { recursive: true });
mkdirSync(DIST, { recursive: true });

const timeline = loadTimeline({ fps });
writeFileSync(join(BUILD, 'timeline.json'), JSON.stringify(timeline, null, 1));
console.log(`Timeline: ${timeline.duration.toFixed(2)}s, ${timeline.scenes.length} scenes, ${timeline.lines.length} narration lines`);

console.log('Rendering soundtrack...');
const audio = await buildSoundtrack(timeline);
console.log(`  master ${audio.result.i} LUFS, true peak ${audio.result.tp} dBTP`);

console.log(`Rendering video (${preview ? '960x540' : '1920x1080'} @ ${fps} fps)...`);
const video = await renderVideo(timeline, preview ? { fps, scale: 0.5, crf: 23, preset: 'veryfast' } : { fps });
console.log(`  ${video.frames} frames in ${video.seconds.toFixed(0)}s`);

const name = preview ? 'LazyVim-for-Windows-trailer-preview.mp4' : 'LazyVim-for-Windows-trailer.mp4';
const out = join(preview ? BUILD : DIST, name);
await run([
  '-i', join(BUILD, 'video.mp4'), '-i', join(BUILD, 'soundtrack.wav'),
  '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
  '-t', timeline.duration.toFixed(3), '-movflags', '+faststart', out,
]);
console.log(`Trailer written to ${out}`);

if (!preview) {
  // A poster frame from the end card, for thumbnails and README embeds.
  const { server, url } = await startServer();
  const browser = await launchBrowser();
  try {
    const page = await openTrailerPage(browser, url, timeline);
    await page.evaluate((t) => window.TRAILER.seek(t), timeline.events.finalChord - 0.4);
    await page.screenshot({ path: join(BUILD, 'poster.png') });
  } finally {
    await browser.close();
    server.close();
  }
  copyFileSync(join(BUILD, 'poster.png'), join(DIST, 'poster.png'));
  console.log(`Poster written to ${join(DIST, 'poster.png')}`);
}
