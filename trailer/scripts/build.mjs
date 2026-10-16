// Builds the trailer: timeline -> soundtrack -> frames -> final MP4 (plus a poster frame).
// Usage: node scripts/build.mjs [--voice=<id>] [--preview]
//   --voice    narrator from script.json (default: the first one). Each narrator gets its own
//              build folder and video: the default writes dist/LazyVim-for-Windows-trailer.mp4,
//              others write dist/LazyVim-for-Windows-trailer-<id>.mp4.
//   --preview  renders at 960x540 / 30 fps for a quick look.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSoundtrack } from './audio.mjs';
import { launchBrowser, openTrailerPage, startServer } from './lib/browser.mjs';
import { selectVoice } from './lib/config.mjs';
import { run } from './lib/ffmpeg.mjs';
import { ROOT } from './lib/paths.mjs';
import { loadTimeline } from './lib/timeline.mjs';
import { renderVideo } from './render.mjs';

const preview = process.argv.includes('--preview');
const fps = preview ? 30 : 60;
const DIST = join(ROOT, 'dist');
const { id, voice, isDefault, buildDir, videoName } = selectVoice();
mkdirSync(buildDir, { recursive: true });
mkdirSync(DIST, { recursive: true });

const timeline = loadTimeline({ fps, voice: id });
writeFileSync(join(buildDir, 'timeline.json'), JSON.stringify(timeline, null, 1));
console.log(`Narrator: ${id} (${voice.name})`);
console.log(`Timeline: ${timeline.duration.toFixed(2)}s, ${timeline.scenes.length} scenes, ${timeline.lines.length} narration lines`);

console.log('Rendering soundtrack...');
const audio = await buildSoundtrack(timeline, buildDir);
console.log(`  master ${audio.result.i} LUFS, true peak ${audio.result.tp} dBTP`);

console.log(`Rendering video (${preview ? '960x540' : '1920x1080'} @ ${fps} fps)...`);
const video = await renderVideo(timeline, preview ? { fps, scale: 0.5, crf: 23, preset: 'veryfast', dir: buildDir } : { fps, dir: buildDir });
console.log(`  ${video.frames} frames in ${video.seconds.toFixed(0)}s`);

const out = preview ? join(buildDir, videoName.replace(/\.mp4$/, '-preview.mp4')) : join(DIST, videoName);
await run([
  '-i', join(buildDir, 'video.mp4'), '-i', join(buildDir, 'soundtrack.wav'),
  '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
  '-t', timeline.duration.toFixed(3), '-movflags', '+faststart', out,
]);
console.log(`Trailer written to ${out}`);

if (!preview && isDefault) {
  // A poster frame from the end card, for thumbnails and README embeds.
  const { server, url } = await startServer();
  const browser = await launchBrowser();
  try {
    const page = await openTrailerPage(browser, url, timeline);
    await page.evaluate((t) => window.TRAILER.seek(t), timeline.events.finalChord - 0.4);
    await page.screenshot({ path: join(buildDir, 'poster.png') });
  } finally {
    await browser.close();
    server.close();
  }
  copyFileSync(join(buildDir, 'poster.png'), join(DIST, 'poster.png'));
  console.log(`Poster written to ${join(DIST, 'poster.png')}`);
}
