import { execSync } from 'node:child_process';

const SAFE_NAME = /^[A-Za-z0-9._()-]+$/;

function az(args) {
  // Every argument is either a constant or validated against SAFE_NAME, so joining is safe.
  return execSync(['az', ...args].join(' '), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Resolves Speech credentials from SPEECH_KEY/SPEECH_REGION, an explicit
 * SPEECH_RESOURCE/SPEECH_RESOURCE_GROUP, or a resource tagged purpose=lazyvim-trailer.
 */
export function getSpeechCredentials() {
  if (process.env.SPEECH_KEY && process.env.SPEECH_REGION) {
    return { key: process.env.SPEECH_KEY, region: process.env.SPEECH_REGION };
  }

  let name = process.env.SPEECH_RESOURCE;
  let group = process.env.SPEECH_RESOURCE_GROUP;
  if (!name || !group) {
    const found = JSON.parse(az(['resource', 'list', '--tag', 'purpose=lazyvim-trailer', '-o', 'json']) || '[]')
      .filter((r) => r.type?.toLowerCase() === 'microsoft.cognitiveservices/accounts')
      .map((r) => ({ name: r.name, group: r.resourceGroup }))[0];
    if (!found) {
      throw new Error('No Speech resource found. Set SPEECH_KEY and SPEECH_REGION, or SPEECH_RESOURCE and SPEECH_RESOURCE_GROUP.');
    }
    ({ name, group } = found);
  }
  if (!SAFE_NAME.test(name) || !SAFE_NAME.test(group)) {
    throw new Error(`Unexpected characters in Speech resource '${name}' or group '${group}'.`);
  }

  const region = az(['cognitiveservices', 'account', 'show', '-n', name, '-g', group, '--query', 'location', '-o', 'tsv']);
  const key = az(['cognitiveservices', 'account', 'keys', 'list', '-n', name, '-g', group, '--query', 'key1', '-o', 'tsv']);
  return { key, region };
}

async function withRetry(label, fn, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts || !err.retryable) throw err;
      const wait = 1000 * 2 ** (i - 1);
      console.warn(`  ${label} failed (${err.message}); retrying in ${wait} ms...`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function check(res, label) {
  if (res.ok) return res;
  const err = new Error(`${label} failed with HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  err.retryable = res.status === 429 || res.status >= 500;
  throw err;
}

/** Synthesizes SSML with Azure Speech and returns the WAV bytes. */
export function synthesize({ key, region }, ssml) {
  return withRetry('Text to speech', async () => {
    const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'riff-48khz-16bit-mono-pcm',
        'User-Agent': 'lazyvim-for-windows-trailer',
      },
      body: ssml,
    });
    return Buffer.from(await (await check(res, 'Text to speech')).arrayBuffer());
  });
}

/** Transcribes audio with Azure fast transcription and returns text plus word timings in seconds. */
export function transcribe({ key, region }, wav, locale = 'en-US') {
  return withRetry('Transcription', async () => {
    const form = new FormData();
    form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
    form.append('definition', JSON.stringify({ locales: [locale] }));
    const res = await fetch(
      `https://${region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2024-11-15`,
      { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key }, body: form },
    );
    const json = await (await check(res, 'Transcription')).json();
    return {
      text: json.combinedPhrases?.[0]?.text ?? '',
      words: (json.phrases ?? []).flatMap((p) => p.words ?? []).map((w) => ({
        text: w.text,
        start: w.offsetMilliseconds / 1000,
        end: (w.offsetMilliseconds + w.durationMilliseconds) / 1000,
      })),
    };
  });
}
