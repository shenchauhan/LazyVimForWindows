// Renders the trailer visuals frame by frame in headless Edge and encodes them with x264.
// Workers each render a contiguous range of frames into their own segment, which are then
// concatenated without re-encoding.
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, openTrailerPage, startServer } from './lib/browser.mjs';
import { ffmpeg, run } from './lib/ffmpeg.mjs';
import { BUILD } from './lib/paths.mjs';

export async function renderVideo(timeline, { fps = 60, scale = 1, workers = 8, crf = 18, preset = 'slow', out = join(BUILD, 'video.mp4') } = {}) {
  const total = Math.ceil(timeline.duration * fps);
  const per = Math.ceil(total / workers);
  const { server, url } = await startServer();
  // One browser per worker: screenshots are encoded in the browser process, which would
  // otherwise serialize every worker.
  const browsers = [];
  const started = Date.now();
  let rendered = 0;
  const tick = setInterval(() => {
    const rate = rendered / ((Date.now() - started) / 1000);
    process.stdout.write(`\r  frames ${rendered}/${total} (${rate.toFixed(1)} fps)   `);
  }, 2000);
  try {
    const segments = [];
    await Promise.all(Array.from({ length: workers }, async (_, w) => {
      const from = w * per;
      const to = Math.min(total, from + per);
      if (from >= to) return;
      const file = join(BUILD, `segment-${w}.mp4`);
      segments[w] = file;
      const browser = await launchBrowser();
      browsers.push(browser);
      const page = await openTrailerPage(browser, url, timeline, scale);
      const enc = ffmpeg([
        '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
        '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-tune', 'animation',
        '-pix_fmt', 'yuv420p', '-threads', '2', '-r', String(fps), file,
      ], { stdin: true });
      for (let f = from; f < to; f++) {
        await page.evaluate((t) => window.TRAILER.seek(t), f / fps);
        const png = await page.screenshot({ type: 'png' });
        if (!enc.proc.stdin.write(png)) await once(enc.proc.stdin, 'drain');
        rendered++;
      }
      enc.proc.stdin.end();
      await enc.done;
      await page.close();
    }));
    const list = join(BUILD, 'segments.txt');
    writeFileSync(list, segments.filter(Boolean).map((s) => `file '${s.replace(/\\/g, '/')}'`).join('\n'));
    await run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
  } finally {
    clearInterval(tick);
    process.stdout.write('\n');
    await Promise.all(browsers.map((b) => b.close()));
    server.close();
  }
  return { frames: total, seconds: (Date.now() - started) / 1000 };
}
