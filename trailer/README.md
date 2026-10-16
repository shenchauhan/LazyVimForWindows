# 🎬 LazyVim for Windows — Trailer

A ~71-second trailer for this project with a relaxed, friendly tone, plus the fully reproducible pipeline that makes it.

- **Video:** [`dist/LazyVim-for-Windows-trailer.mp4`](dist/LazyVim-for-Windows-trailer.mp4) (1920×1080, 60 fps, H.264 + AAC)
- **Poster frame:** [`dist/poster.png`](dist/poster.png)

Everything in it is generated: the narration comes from **MAI-Voice-2.1-Flash** on Azure Speech, the music and sound effects are synthesized from code, and every frame is rendered in a headless browser. No stock footage, samples, or third-party music are used.

## 🧩 How it works

```mermaid
flowchart LR
  S[script.json] --> V[voice.mjs<br/>MAI-Voice-2.1-Flash]
  V -->|takes checked with<br/>speech to text| A[assets/voice/*.wav<br/>+ word timings]
  A --> T[timeline<br/>beat-aligned scenes]
  T --> C[web/cues.js<br/>shared cue sheet]
  C --> M[web/audio.js<br/>score + SFX]
  C --> G[web/trailer.js<br/>animated scenes]
  M --> MX[audio.mjs<br/>balance + master]
  G --> R[render.mjs<br/>frames → x264]
  MX --> F[dist/*.mp4]
  R --> F
```

1. **Narration** — `scripts/voice.mjs` sends each line of `script.json` to Azure Speech using the `en-US-Ethan:MAI-Voice-2.1-Flash` voice with gentle per-line emotion styles (confused, disgusted, regretful, hopeful, happy, relieved). Every take is transcribed with Azure fast transcription, and takes with missing, extra, or stuttered words are re-recorded automatically. Each line is recorded three times and the take closest to the delivery target is kept: a relaxed pitch (median at or below 135 Hz, so nothing sounds hyped) that still moves (a pitch spread of 2.5–5 semitones, so nothing sounds monotone). Long pauses are tightened, and the word timestamps are kept so visuals can land on specific words.
2. **Timeline** — `scripts/lib/timeline.mjs` lays the lines out scene by scene on a 100 BPM grid. Musical entrances are anchored to words: the band comes in on “**Lazy**Vim”, and the groove returns on “And **there** it is” as the dashboard appears.
3. **Cue sheet** — `web/cues.js` turns the timeline into the moments everything else keys off (tool chips appearing as they are named, sound effects, the music arrangement). Visuals and audio share it, so they cannot drift apart.
4. **Music and sound** — `web/audio.js` composes an original, laid-back electric-piano groove (I–vi–IV–V in D major with sevenths) and all sound effects with the Web Audio API in an `OfflineAudioContext`. The arrangement grows and relaxes with the story: a light pizzicato intro, a warm pad under the hook, keys with soft kick and finger snaps, an arpeggio and bells for the feature tour (the bells only play in the narrator's pauses), a drum-free breakdown for “Relax”, and a gentle build back in for the reveal. The music is ducked and EQ-carved under the voice. `scripts/audio.mjs` measures the stems (ITU-R BS.1770) so the bed sits roughly 11–18 dB under the narrator, then masters the mix to -14 LUFS with a -1.5 dBTP ceiling.
5. **Visuals** — `web/trailer.html` and `web/trailer.js` draw every frame as a pure function of time, using eased fades and drifts rather than whips, flashes, or camera shake. `scripts/render.mjs` screenshots frames in parallel headless Edge workers and encodes them with x264.

## 🛠️ Rebuilding

Requirements: Windows with Microsoft Edge, Node.js 20+, and (only to re-record narration) the Azure CLI.

```powershell
cd trailer
npm install
npm run build            # full 1080p60 render → dist/
npm run build:preview    # quick 540p30 render → build/
```

The recorded narration is checked in under `assets/voice/`, so rebuilding the video or tweaking visuals and music does **not** need Azure.

### Re-recording the narration

Edit `script.json`, then run:

```powershell
az login
npm run voice                       # only re-records lines whose text or style changed
npm run voice -- --only=cta --force # re-record one line
```

The script finds credentials in this order:

1. `SPEECH_KEY` and `SPEECH_REGION`
2. `SPEECH_RESOURCE` and `SPEECH_RESOURCE_GROUP` (key fetched with the Azure CLI)
3. A Speech resource tagged `purpose=lazyvim-trailer` in the current subscription

Line options in `script.json`: `style` (an `mstts:express-as` style), `rate` (SSML prosody, for example `+8%`), `takes` (how many clean takes to compare), `delivery` (`maxPitchHz` and `pitchSd` targets used to pick the take; defaults come from `voice`), and `maxPause`/`keepPause` (pause tightening). Each line's measured pitch and speaking rate are saved in `assets/voice/manifest.json`.

### Other handy commands

```powershell
npm run stills -- 12.4 49.2   # render specific moments (seconds) to build/stills/
npm run preview               # live in-browser preview with sound (after a build)
npm run qa                    # transcribe the finished mix and report loudness
```

## 📄 Credits

- Voice: MAI-Voice-2.1-Flash (`en-US-Ethan`) via Azure Speech.
- The LAZYVIM block wordmark and dashboard recreation pay homage to [LazyVim](https://github.com/LazyVim/LazyVim) and its Tokyo Night look.
- Music, sound effects, and visuals are original and generated by the code in this folder.
