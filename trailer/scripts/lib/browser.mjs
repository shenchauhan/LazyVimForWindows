import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT } from './paths.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** Serves the trailer folder over HTTP so pages can fetch timelines and audio. */
export function startServer(port = 0) {
  const server = createServer((req, res) => {
    const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (!path.startsWith(ROOT + sep)) {
      res.writeHead(403).end();
      return;
    }
    let size;
    try {
      const stat = statSync(path);
      if (!stat.isFile()) throw new Error('not a file');
      size = stat.size;
    } catch {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
      'Content-Length': size,
      'Cache-Control': 'no-store',
    });
    createReadStream(path).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

/** Launches headless Chromium: Microsoft Edge by default, or CHROMIUM_PATH if set. */
export function launchBrowser() {
  const options = {
    headless: true,
    args: [
      '--force-color-profile=srgb', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars',
      '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    ],
  };
  if (process.env.CHROMIUM_PATH) options.executablePath = process.env.CHROMIUM_PATH;
  else options.channel = 'msedge';
  return chromium.launch(options);
}

/** Opens the trailer page at 1920x1080 and initializes it with a timeline. */
export async function openTrailerPage(browser, url, timeline, scale = 1) {
  const page = await browser.newPage({ viewport: { width: 1920 * scale, height: 1080 * scale }, deviceScaleFactor: 1 });
  page.on('pageerror', (err) => console.error('page error:', err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') console.error('console:', msg.text()); });
  await page.goto(`${url}/web/trailer.html?render&scale=${scale}`);
  await page.evaluate(async (tl) => {
    await document.fonts.ready;
    await window.TRAILER.init(tl);
  }, timeline);
  return page;
}
