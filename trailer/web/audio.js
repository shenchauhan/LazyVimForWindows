// Procedural soundtrack for the trailer: an upbeat but warm electric-piano groove, soft sound
// effects, and the narration bed, all rendered offline with the Web Audio API so the result is
// deterministic.
(function (global) {
  'use strict';

  const SR = 48000;
  const PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const hz = (name) => {
    const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
    const midi = (Number(m[3]) + 1) * 12 + PITCH[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return 440 * 2 ** ((midi - 69) / 12);
  };
  const octaveUp = (note) => note.replace(/-?\d$/, (d) => String(Number(d) + 1));
  function mulberry32(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // I–vi–IV–V in D major with sevenths and ninths, voiced for a soft electric piano.
  const PROGRESSION = [
    { bass: 'D2', fifth: 'A2', keys: ['F#3', 'A3', 'C#4', 'E4'], arp: ['A4', 'C#5', 'E5', 'F#5'] },
    { bass: 'B1', fifth: 'F#2', keys: ['F#3', 'A3', 'B3', 'D4'], arp: ['F#4', 'B4', 'D5', 'F#5'] },
    { bass: 'G1', fifth: 'D2', keys: ['G3', 'B3', 'D4', 'F#4'], arp: ['B4', 'D5', 'F#5', 'A5'] },
    { bass: 'A1', fifth: 'E2', keys: ['G3', 'A3', 'D4', 'E4'], arp: ['A4', 'D5', 'E5', 'G5'] },
  ];
  // Rhythms in beats within a bar: [offset, length] or [offset, length, chord tone]. The keys
  // push ahead of the beat and the bass skips up an octave to keep things moving.
  const KEYS_RHYTHM = [[0, 1.3], [1.5, 0.45], [2.5, 0.9], [3.5, 0.4]];
  const BASS_LINE = [[0, 0.9, 'bass'], [1.5, 0.4, 'bass'], [2.5, 0.4, 'fifth'], [3, 0.4, 'bass'], [3.5, 0.4, 'octave']];
  const ARP_PATTERN = [0, 2, 1, 3, 2, 1, 0, 2];
  // A short phrase the bells play between the narrator's lines: [beat offset, arp index].
  const BELL_PHRASE = [[0.5, 3], [1.5, 2], [2, 1]];
  // Intro: a light, slightly wry pizzicato figure in D minor, in eighth notes.
  const INTRO_RIFF = ['D4', null, 'F4', 'A4', null, 'G4', 'F4', null, 'E4', null, 'C4', 'D4', null, null, 'A3', null];

  /** Shared synthesis helpers bound to one OfflineAudioContext. */
  function studio(ctx, seed = 1) {
    const rand = mulberry32(seed);
    const noise = ctx.createBuffer(1, SR * 4, SR);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = rand() * 2 - 1;

    const ir = ctx.createBuffer(2, SR * 3, SR);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      const r = mulberry32(seed * 7 + c);
      for (let i = 0; i < d.length; i++) {
        const t = i / SR;
        d[i] = (r() * 2 - 1) * Math.exp(-t * 2.2) * Math.min(1, t / 0.01);
      }
    }

    function reverb(dest, wet = 1) {
      const conv = ctx.createConvolver();
      conv.buffer = ir;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 5500;
      const g = ctx.createGain();
      g.gain.value = wet;
      conv.connect(lp).connect(g).connect(dest);
      return conv;
    }

    // Every voice passes through a release gate so notes fade out instead of clicking off.
    function releaseGate(end, tau) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(1, end);
      g.gain.setTargetAtTime(0, end, tau);
      return g;
    }

    function finish(node, dest, { pan = 0, send, sendGain = 0.2 }) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node.connect(p).connect(dest);
      if (send) {
        const s = ctx.createGain();
        s.gain.value = sendGain;
        p.connect(s).connect(send);
      }
    }

    function noiseHit(dest, t, { type = 'highpass', freq = 7000, q = 0.7, gain = 0.3, attack = 0.001, decay = 0.05, length = 1, rel = 0.03, ...rest }) {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      // Start silent: until its first event a gain holds its default of 1, and a source that
      // starts a sample early (sub-sample rounding) would leak one full-scale noise sample.
      g.gain.value = 0;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + attack);
      g.gain.setTargetAtTime(0, t + attack, decay);
      finish(src.connect(f).connect(g).connect(releaseGate(t + length, rel)), dest, rest);
      src.start(t, rand() * 3);
      src.stop(t + length + rel * 8);
      return { src, filter: f, gain: g };
    }

    /**
     * One oscillator voice: attack, decay toward `sustain` (time constant `decay`), held until
     * `length`, then released. `fm` adds a modulator for bell and electric-piano timbres.
     */
    function tone(dest, t, { type = 'sine', freq, to, glide = 0.1, gain = 0.3, attack = 0.002, decay = 0.1, sustain = 0, length = 0.6, rel = 0.04, detune = 0, filter, fm, ...rest }) {
      const end = t + length + rel * 8;
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = detune;
      o.frequency.setValueAtTime(freq, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + glide);
      if (fm) {
        const m = ctx.createOscillator();
        m.frequency.value = freq * fm.ratio;
        const depth = ctx.createGain();
        depth.gain.setValueAtTime(freq * fm.index, t);
        depth.gain.setTargetAtTime(freq * (fm.floor ?? 0), t, fm.decay);
        m.connect(depth).connect(o.frequency);
        m.start(t);
        m.stop(end);
      }
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + attack);
      g.gain.setTargetAtTime(gain * sustain, t + attack, decay);
      let node = o;
      if (filter) {
        const f = ctx.createBiquadFilter();
        f.type = filter.type ?? 'lowpass';
        f.Q.value = filter.q ?? 0.7;
        f.frequency.setValueAtTime(filter.from, t);
        if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, t + (filter.time ?? 0.15));
        node = node.connect(f);
      }
      finish(node.connect(g).connect(releaseGate(t + length, rel)), dest, rest);
      o.start(t);
      o.stop(end);
      return o;
    }

    return { rand, reverb, noiseHit, tone };
  }

  /** The band: warm keys and bass over a light, clean kit. Nothing has a hard click. */
  function instruments(ctx, s, bus) {
    return {
      kick(t, vel = 1) {
        // A round thump with just a hint of beater so it reads on small speakers.
        s.tone(bus.drums, t, { freq: 130, to: 45, glide: 0.11, gain: 0.7 * vel, attack: 0.004, decay: 0.13, length: 0.55, rel: 0.05 });
        s.noiseHit(bus.drums, t, { type: 'bandpass', freq: 3000, q: 0.9, gain: 0.06 * vel, decay: 0.005, length: 0.05 });
      },
      snap(t, vel = 1) {
        s.noiseHit(bus.drums, t, { type: 'bandpass', freq: 2600, q: 1.1, gain: 0.42 * vel, decay: 0.025, length: 0.2, pan: -0.1, send: bus.verb, sendGain: 0.45 });
        s.tone(bus.drums, t, { type: 'triangle', freq: 1150, gain: 0.04 * vel, decay: 0.012, length: 0.08 });
      },
      clap(t, vel = 1) {
        for (let k = 0; k < 3; k++) {
          s.noiseHit(bus.drums, t + k * 0.011, { type: 'bandpass', freq: 1150, q: 1.4, gain: 0.3 * vel, decay: 0.006, length: 0.08 });
        }
        s.noiseHit(bus.drums, t + 0.022, { type: 'bandpass', freq: 1350, q: 1.1, gain: 0.26 * vel, decay: 0.05, length: 0.45, send: bus.verb, sendGain: 0.35 });
      },
      hat(t, vel = 1, open = false) {
        s.noiseHit(bus.drums, t, { type: 'highpass', freq: 7600, q: 0.6, gain: (open ? 0.17 : 0.15) * vel, decay: open ? 0.07 : 0.012, length: open ? 0.5 : 0.1, pan: open ? 0.25 : -0.15 });
      },
      snare(t, vel = 1) {
        s.noiseHit(bus.drums, t, { type: 'bandpass', freq: 1900, q: 0.6, gain: 0.26 * vel, decay: 0.045, length: 0.3, send: bus.verb, sendGain: 0.2 });
        s.tone(bus.drums, t, { type: 'triangle', freq: 210, to: 150, glide: 0.05, gain: 0.15 * vel, decay: 0.035, length: 0.2 });
      },
      crash(t, vel = 1) {
        s.noiseHit(bus.fx, t, { type: 'highpass', freq: 3800, q: 0.5, gain: 0.2 * vel, decay: 0.6, length: 3.2, rel: 0.3, send: bus.verb, sendGain: 0.3 });
        s.noiseHit(bus.fx, t, { type: 'bandpass', freq: 9000, q: 1.5, gain: 0.09 * vel, decay: 0.9, length: 3.5, rel: 0.3, pan: 0.3 });
      },
      /** A filtered noise sweep with a rising tone underneath, easing out just as it lands. */
      riser(t0, t1, vel = 1) {
        const n = s.noiseHit(bus.fx, t0, { type: 'bandpass', freq: 300, q: 2.2, gain: 0, decay: 10, length: t1 - t0 + 0.3, rel: 0.05 });
        n.filter.frequency.setValueAtTime(300, t0);
        n.filter.frequency.exponentialRampToValueAtTime(8000, t1);
        n.gain.gain.cancelScheduledValues(t0);
        n.gain.gain.setValueAtTime(0.0001, t0);
        n.gain.gain.exponentialRampToValueAtTime(0.28 * vel, t1);
        n.gain.gain.setTargetAtTime(0, t1, 0.03);
        s.tone(bus.fx, t0, { type: 'sawtooth', freq: 140, to: 1100, glide: t1 - t0, gain: 0.03 * vel, attack: t1 - t0, decay: 0.03, length: t1 - t0, filter: { from: 900, to: 5000, time: t1 - t0 } });
      },
      cymbalSwell(t0, t1, vel = 1) {
        const n = s.noiseHit(bus.fx, t0, { type: 'highpass', freq: 5200, q: 0.4, gain: 0, decay: 10, length: t1 - t0 + 0.6, rel: 0.2 });
        n.gain.gain.cancelScheduledValues(t0);
        n.gain.gain.setValueAtTime(0.0001, t0);
        n.gain.gain.exponentialRampToValueAtTime(0.05 * vel, t1);
        n.gain.gain.setTargetAtTime(0, t1, 0.18);
      },
      /** A soft, deep landing for the big moments: more "whump" than "boom". */
      impact(t, vel = 1) {
        s.tone(bus.fx, t, { freq: 70, to: 32, glide: 1.1, gain: 0.5 * vel, attack: 0.006, decay: 0.5, length: 2, rel: 0.2 });
        s.noiseHit(bus.fx, t, { type: 'lowpass', freq: 450, q: 0.7, gain: 0.25 * vel, attack: 0.003, decay: 0.15, length: 1, rel: 0.1, send: bus.verb, sendGain: 0.4 });
      },
      bass(t, len, note, vel = 1) {
        const f = hz(note);
        s.tone(bus.bass, t, { freq: f, gain: 0.24 * vel, attack: 0.012, decay: 1.2, sustain: 0.6, length: len, rel: 0.06 });
        s.tone(bus.bass, t, { type: 'triangle', freq: f, gain: 0.08 * vel, attack: 0.012, decay: 0.3, sustain: 0.3, length: len, rel: 0.06, filter: { from: 900, q: 0.5 } });
      },
      /** Two-operator FM electric piano, lightly strummed. `bright` scales the bark of the attack. */
      keys(t, len, notes, vel = 1, { bright = 1 } = {}) {
        notes.forEach((n, i) => {
          const f = hz(n);
          const at = t + i * 0.014;
          const pan = (i - (notes.length - 1) / 2) * 0.22;
          s.tone(bus.keys, at, {
            freq: f, gain: 0.1 * vel, attack: 0.004, decay: 1.4, sustain: 0.3, length: len, rel: 0.22, pan,
            fm: { ratio: 1, index: 2.2 * bright, floor: 0.6 * bright, decay: 0.3 }, send: bus.verb, sendGain: 0.22,
          });
          // The bell-like "tine" of an electric piano: a quick, high partial on each note.
          s.tone(bus.keys, at, { freq: f * 4, gain: 0.016 * vel * bright, decay: 0.06, length: 0.3, pan });
          s.tone(bus.keys, at, { freq: f * 14, gain: 0.012 * vel * bright, decay: 0.04, length: 0.2, pan: -pan });
        });
      },
      pad(t, len, notes, vel = 1, { bright = 1400, attack = 0.8 } = {}) {
        const rise = Math.max(0.05, Math.min(attack, len * 0.9));
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = bright;
        const g = ctx.createGain();
        g.gain.value = 0;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.05 * vel, t + rise);
        g.gain.setValueAtTime(0.05 * vel, t + len);
        g.gain.setTargetAtTime(0, t + len, 0.35);
        lp.connect(g).connect(bus.pad);
        g.connect(bus.verbIn(0.35));
        for (const n of notes) {
          [-7, 7].forEach((cents, i) => {
            const o = ctx.createOscillator();
            o.type = 'triangle';
            o.frequency.value = hz(n);
            o.detune.value = cents;
            const p = ctx.createStereoPanner();
            p.pan.value = i ? 0.35 : -0.35;
            o.connect(p).connect(lp);
            o.start(t);
            o.stop(t + len + 3);
          });
        }
      },
      pluck(t, note, vel = 1, pan = 0) {
        s.tone(bus.arp, t, { type: 'sawtooth', freq: hz(note), gain: 0.05 * vel, attack: 0.003, decay: 0.13, length: 0.45, rel: 0.05, pan, filter: { from: 6500, to: 2200, time: 0.15 }, send: bus.verb, sendGain: 0.3 });
      },
      bell(t, note, vel = 1, pan = 0) {
        s.tone(bus.bell, t, { freq: hz(note), gain: 0.045 * vel, decay: 0.65, length: 2.2, rel: 0.3, pan, fm: { ratio: 3.5, index: 1.2, floor: 0.04, decay: 0.2 }, send: bus.verb, sendGain: 0.5 });
      },
      pizz(t, note, vel = 1, pan = 0) {
        s.tone(bus.intro, t, { type: 'triangle', freq: hz(note), gain: 0.2 * vel, attack: 0.003, decay: 0.085, length: 0.4, rel: 0.05, pan, filter: { from: 2600, to: 800, time: 0.12, q: 1 }, send: bus.verb, sendGain: 0.22 });
      },
    };
  }

  /** Beat times on a grid between `from` and `to`. */
  function beats(from, to, origin, beat, step = 1) {
    const out = [];
    const k0 = Math.ceil((from - origin) / (beat * step) - 1e-6);
    for (let k = k0; ; k++) {
      const t = origin + k * beat * step;
      if (t >= to - 1e-6) break;
      out.push({ t, k });
    }
    return out;
  }

  /** Bars overlapping [from, to) with their chord; `start`/`end` are clipped to the range. */
  function bars(from, to, origin, beat) {
    const out = [];
    const len = beat * 4;
    for (let k = Math.floor((from - origin) / len + 1e-6); ; k++) {
      const barStart = origin + k * len;
      const start = Math.max(from, barStart);
      const end = Math.min(to, barStart + len);
      if (start >= to - 1e-6) break;
      if (end - start > 0.05) out.push({ barStart, start, end, chord: PROGRESSION[((k % 4) + 4) % 4] });
    }
    return out;
  }

  function busses(ctx, s, out) {
    const verb = s.reverb(out, 0.8);
    const make = (gain) => {
      const g = ctx.createGain();
      g.gain.value = gain;
      g.connect(out);
      return g;
    };
    const verbIn = (amount) => {
      const g = ctx.createGain();
      g.gain.value = amount;
      g.connect(verb);
      return g;
    };
    return { verb, verbIn, drums: make(0.9), bass: make(1), keys: make(1), pad: make(1), arp: make(0.8), bell: make(0.9), fx: make(1), intro: make(1) };
  }

  /**
   * The intro, rendered on its own so it can be "tape-stopped": a light, wry pizzicato figure over
   * a soft four-on-the-floor that picks up a clap and bass as the frustrations pile on.
   */
  async function renderIntro(c) {
    const E = c.E;
    const beat = c.beat;
    const ctx = new OfflineAudioContext(2, Math.ceil((E.introEnd + 1) * SR), SR);
    const s = studio(ctx, 3);
    const out = ctx.createGain();
    out.connect(ctx.destination);
    const ins = instruments(ctx, s, busses(ctx, s, out));
    for (const { t, k } of beats(beat, E.introEnd + 0.5, 0, beat, 0.5)) {
      const note = INTRO_RIFF[k % INTRO_RIFF.length];
      if (note) ins.pizz(t, note, 0.85, ((k % 4) - 1.5) * 0.12);
      ins.hat(t, k % 2 ? 0.5 : 0.2);
      if (k % 2 === 0) ins.kick(t, k % 4 === 0 ? 0.5 : 0.38);
      if (t >= c.struggle.compiler - 0.3 && k % 4 === 2) ins.clap(t, 0.4);
      if (t >= c.struggle.path - 0.1 && k % 2 === 1) ins.bass(t, beat * 0.4, k % 16 < 8 ? 'D2' : 'A1', 0.6);
    }
    // A comic, slightly sour stab when the tab count hits 47.
    ins.keys(c.struggle.tabs47, 0.45, ['D4', 'Eb4', 'Ab4'], 1.3, { bright: 1.4 });
    return ctx.startRendering();
  }

  /** Renders the music stem: an upbeat arrangement that builds, breathes, and lands with the story. */
  async function renderMusic(c, tl) {
    const E = c.E;
    const S = c.S;
    const beat = c.beat;
    const intro = await renderIntro(c);
    const ctx = new OfflineAudioContext(2, Math.ceil((E.end + 0.5) * SR), SR);
    const s = studio(ctx, 9);

    // Master chain: duck EQ -> air shelf -> duck gain -> gentle glue compressor -> out.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 2.5;
    comp.attack.value = 0.015;
    comp.release.value = 0.25;
    comp.knee.value = 10;
    comp.connect(ctx.destination);
    const duck = ctx.createGain();
    duck.connect(comp);
    // A gentle lift above 3.5 kHz keeps the warm keys from sounding veiled between lines.
    const air = ctx.createBiquadFilter();
    air.type = 'highshelf';
    air.frequency.value = 3500;
    air.gain.value = 3;
    air.connect(duck);
    const eq = ctx.createBiquadFilter();
    eq.type = 'peaking';
    eq.frequency.value = 2600;
    eq.Q.value = 0.9;
    eq.connect(air);
    const fade = ctx.createGain();
    fade.connect(eq);
    // The landing hits skip the ducking so the big moments still land under the narration.
    const hitOut = ctx.createGain();
    hitOut.gain.value = 0.7;
    hitOut.connect(comp);
    const bus = busses(ctx, s, fade);
    const ins = instruments(ctx, s, bus);
    const hits = instruments(ctx, s, busses(ctx, s, hitOut));
    const speaking = (t, pad) => tl.lines.some((l) => t > l.start - pad && t < l.end + 0.05);

    // 1. Intro, winding down with a gentle tape-stop as the weekend disappears.
    const tapeFrom = Math.max(c.struggle.gloom + 0.2, E.introEnd - 0.75);
    const tape = ctx.createBufferSource();
    tape.buffer = intro;
    tape.playbackRate.setValueAtTime(1, tapeFrom);
    tape.playbackRate.exponentialRampToValueAtTime(0.06, E.introEnd);
    const tapeGain = ctx.createGain();
    tapeGain.gain.setValueAtTime(1, tapeFrom);
    tapeGain.gain.linearRampToValueAtTime(0.4, E.introEnd - 0.1);
    tapeGain.gain.linearRampToValueAtTime(0, E.introEnd);
    // The pitch dive drags the kick and bass into the sub range; keep that rumble in check.
    const tapeHp = ctx.createBiquadFilter();
    tapeHp.type = 'highpass';
    tapeHp.frequency.value = 30;
    tapeHp.frequency.setValueAtTime(30, tapeFrom);
    tapeHp.frequency.exponentialRampToValueAtTime(110, E.introEnd);
    tape.connect(tapeHp).connect(tapeGain).connect(fade);
    tape.start(0);
    tape.stop(E.introEnd + 0.05);

    // 2. Hook: a pad swells and a soft riser lifts "But not anymore." into the name, where the
    //    band lands with a crash, a soft impact, and a chime.
    const swellStart = E.introEnd - 0.2;
    ins.pad(swellStart, E.title - swellStart + 0.5, PROGRESSION[0].keys, 1.1, { bright: 2000, attack: E.title - swellStart - 0.2 });
    ins.riser(Math.max(E.introEnd, E.title - 2.4), E.title - 0.02, 0.5);
    ins.cymbalSwell(E.title - 1.4, E.title, 1);
    hits.crash(E.title, 0.6);
    hits.impact(E.title, 0.5);
    ['D5', 'F#5', 'A5'].forEach((n, i) => ins.bell(E.title + i * 0.11, n, 0.8, -0.3 + i * 0.3));

    // 3. The groove: kick, clap backbeat, eighth hats, pushed keys, and a bouncing bass.
    const groove = (from, to, origin, { drums = 1, hats = 1, arp = 0, bells = false, keys = 1 } = {}) => {
      for (const b of bars(from, to, origin, beat)) {
        const at = (offset) => b.barStart + offset * beat;
        const inRange = (t) => t >= from - 1e-6 && t < to - 1e-6;
        for (const [off, len] of KEYS_RHYTHM) {
          const t = at(off);
          if (keys && inRange(t)) ins.keys(t, Math.min(len * beat, to - t), b.chord.keys, keys * (off ? 0.8 : 1));
        }
        for (const [off, len, tone] of BASS_LINE) {
          const t = at(off);
          const octave = tone === 'octave';
          if (inRange(t)) ins.bass(t, Math.min(len * beat, to - t), octave ? octaveUp(b.chord.bass) : b.chord[tone], octave ? 0.7 : 1);
        }
        for (let i = 0; i < 8; i++) {
          const t = at(i / 2);
          if (!inRange(t)) continue;
          if (drums) {
            if (i === 0 || i === 3 || i === 4) ins.kick(t, (i === 3 ? 0.7 : 0.95) * drums);
            if (i === 2 || i === 6) {
              ins.clap(t, 0.55 * drums);
              ins.snap(t, 0.45 * drums);
            }
          }
          if (hats) ins.hat(t, (i % 2 ? 0.6 : 0.35) * hats, i === 7);
          if (arp) ins.pluck(t, b.chord.arp[ARP_PATTERN[i]], arp, i % 2 ? 0.3 : -0.3);
        }
        if (bells) {
          // The bells only answer in the pauses, never over the narrator.
          for (const [off, idx] of BELL_PHRASE) {
            const t = at(off);
            if (inRange(t) && !speaking(t, 0.3)) ins.bell(t, octaveUp(b.chord.arp[idx]), 0.7, 0.2);
          }
        }
      }
    };
    // A quick snare fill and a light crash carry each scene change.
    const fill = (t, vel = 1) => {
      for (let i = 0; i < 4; i++) ins.snare(t - beat + (i * beat) / 4, (0.2 + i * 0.1) * vel);
      ins.crash(t, 0.35 * vel);
    };
    groove(E.title, S.winget.start, E.title, { drums: 0.85, hats: 0.8 });
    groove(S.winget.start, S.safe.start, E.title, { drums: 0.95, arp: 0.55, bells: true });
    [S.command.start, S.winget.start, S.arch.start].forEach((t) => fill(t));

    // 4. Breakdown for "Relax": the kick and clap drop out; keys get darker; light hats keep time.
    for (const b of bars(S.safe.start, S.launch.start, E.title, beat)) {
      ins.keys(b.start, b.end - b.start, b.chord.keys, 0.8, { bright: 0.6 });
      ins.bass(b.start, (b.end - b.start) * 0.95, b.chord.bass, 0.6);
      for (let i = 0; i < 8; i++) {
        const t = b.barStart + (i * beat) / 2;
        if (t < b.start - 1e-6 || t >= b.end - 1e-6) continue;
        if (i % 2 === 0) ins.pluck(t, b.chord.arp[ARP_PATTERN[i]], 0.4, i % 4 ? 0.3 : -0.3);
        ins.hat(t, i % 2 ? 0.35 : 0.15);
      }
    }

    // 5. Build: IV then V, a kick that grows, a snare roll that tightens, and a riser, then a
    //    breath of silence before the dashboard lands on "there it is". The build has its own
    //    gate so it can stop dead without cutting anything else.
    const dropout = E.reveal - 0.15;
    const gate = ctx.createGain();
    gate.connect(fade);
    gate.gain.setValueAtTime(1, dropout - 0.03);
    gate.gain.linearRampToValueAtTime(0, dropout);
    const bld = instruments(ctx, s, busses(ctx, s, gate));
    const buildMid = Math.max(S.launch.start + 0.6, E.reveal - 4 * beat);
    bld.keys(S.launch.start, buildMid - S.launch.start, PROGRESSION[2].keys, 0.75);
    bld.bass(S.launch.start, buildMid - S.launch.start, PROGRESSION[2].bass, 0.6);
    bld.keys(buildMid, dropout - buildMid, PROGRESSION[3].keys, 0.8);
    bld.bass(buildMid, dropout - buildMid, PROGRESSION[3].bass, 0.7);
    bld.pad(buildMid, dropout - buildMid, PROGRESSION[3].keys, 1, { bright: 1800, attack: dropout - buildMid - 0.2 });
    bld.riser(S.launch.start + 0.3, dropout, 0.55);
    for (let t = E.reveal - beat; t > S.launch.start + 0.2; t -= beat) {
      bld.kick(t, 0.25 + 0.5 * (1 - (E.reveal - t) / (E.reveal - S.launch.start)));
    }
    const rollFrom = Math.max(S.launch.start + 0.2, E.reveal - 4 * beat);
    for (let t = rollFrom; t < dropout - 0.02;) {
      const left = E.reveal - t;
      bld.snare(t, 0.15 + 0.45 * (1 - left / (E.reveal - rollFrom)));
      t += left <= 2 * beat + 1e-6 ? beat / 4 : beat / 2;
    }
    hits.crash(E.reveal, 0.7);
    hits.impact(E.reveal, 0.55);

    // 6. Back in, a little fuller, through the call to action.
    groove(E.reveal, E.finalChord, E.reveal, { drums: 1, arp: 0.6, bells: true });
    fill(S.cta.start, 0.8);

    // 7. Final chord: a last kick and crash, warm keys, the low D, and a chime, left to ring.
    ins.cymbalSwell(E.finalChord - 1.2, E.finalChord, 0.6);
    ins.kick(E.finalChord, 0.9);
    hits.crash(E.finalChord, 0.5);
    hits.impact(E.finalChord, 0.35);
    ins.keys(E.finalChord, 2.4, ['D3', 'A3', 'C#4', 'E4', 'F#4', 'A4'], 0.75);
    ins.bass(E.finalChord, 2.6, 'D2', 0.75);
    ins.pad(E.finalChord - 0.2, 2.6, ['D4', 'F#4', 'A4', 'C#5'], 0.6, { bright: 2200, attack: 0.4 });
    ['A5', 'D6'].forEach((n, i) => ins.bell(E.finalChord + 0.15 + i * 0.18, n, 0.6, i ? 0.25 : -0.25));

    // Duck the music under the narration; nearby lines share one dip to avoid pumping. After the
    // last line the music only partly recovers, so the ending settles instead of swelling.
    const segments = [];
    for (const l of tl.lines) {
      const level = l.id === 'hook-2' ? 0.5 : 0.4;
      const last = segments.at(-1);
      if (last && l.start - last.end < 0.9) {
        last.end = l.end;
        last.level = Math.min(last.level, level);
      } else {
        segments.push({ start: l.start, end: l.end, level });
      }
    }
    duck.gain.setValueAtTime(1, 0);
    eq.gain.setValueAtTime(0, 0);
    segments.forEach((seg, i) => {
      const after = i === segments.length - 1 ? 0.75 : 1;
      duck.gain.setValueAtTime(1, seg.start - 0.25);
      duck.gain.linearRampToValueAtTime(seg.level, seg.start);
      duck.gain.setValueAtTime(seg.level, seg.end + 0.08);
      duck.gain.linearRampToValueAtTime(after, seg.end + 0.6);
      eq.gain.setValueAtTime(0, seg.start - 0.25);
      eq.gain.linearRampToValueAtTime(-4, seg.start);
      eq.gain.setValueAtTime(-4, seg.end + 0.08);
      eq.gain.linearRampToValueAtTime(0, seg.end + 0.6);
    });
    for (const g of [fade.gain, hitOut.gain]) {
      g.setValueAtTime(g.value, E.end - 1.6);
      g.linearRampToValueAtTime(0, E.end);
    }
    return ctx.startRendering();
  }

  /** Renders the soft UI sound effects listed in the cue sheet. */
  async function renderSfx(c) {
    const ctx = new OfflineAudioContext(2, Math.ceil((c.E.end + 0.5) * SR), SR);
    const s = studio(ctx, 21);
    const out = ctx.createGain();
    out.connect(ctx.destination);
    const verb = s.reverb(out, 0.6);
    const chord = (t, notes, g, { gap = 0.06, gain = 0.06, decay = 0.3, spread = 0.6 } = {}) => notes.forEach((n, i) => s.tone(out, t + i * gap, {
      freq: hz(n), gain: gain * g, decay, length: 1.4, rel: 0.2, pan: (i / Math.max(1, notes.length - 1) - 0.5) * spread,
      fm: { ratio: 3.5, index: 0.8, floor: 0.02, decay: 0.15 }, send: verb, sendGain: 0.5,
    }));
    const fx = {
      key: (t, g, pan) => {
        s.noiseHit(out, t, { type: 'bandpass', freq: 3800 + s.rand() * 1500, q: 1.2, gain: 0.22 * g, decay: 0.004, length: 0.05, pan });
        s.tone(out, t, { freq: 190 + s.rand() * 40, gain: 0.15 * g, decay: 0.012, length: 0.08, pan });
      },
      enter: (t, g) => {
        s.noiseHit(out, t, { type: 'bandpass', freq: 2600, q: 1, gain: 0.3 * g, decay: 0.006, length: 0.08 });
        s.tone(out, t, { freq: 140, to: 90, glide: 0.05, gain: 0.32 * g, decay: 0.03, length: 0.2 });
      },
      error: (t, g, pan) => {
        s.tone(out, t, { freq: 392, gain: 0.16 * g, decay: 0.06, length: 0.25, pan, send: verb, sendGain: 0.15 });
        s.tone(out, t + 0.1, { freq: 311, gain: 0.16 * g, decay: 0.1, length: 0.35, pan, send: verb, sendGain: 0.15 });
      },
      whoosh: (t, g, pan) => {
        const n = s.noiseHit(out, t - 0.25, { type: 'bandpass', freq: 400, q: 0.9, gain: 0, decay: 10, length: 0.8, rel: 0.05, pan });
        n.filter.frequency.setValueAtTime(400, t - 0.25);
        n.filter.frequency.exponentialRampToValueAtTime(2600, t);
        n.filter.frequency.exponentialRampToValueAtTime(700, t + 0.4);
        n.gain.gain.cancelScheduledValues(t - 0.25);
        n.gain.gain.setValueAtTime(0.0001, t - 0.25);
        n.gain.gain.exponentialRampToValueAtTime(0.25 * g, t);
        n.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      },
      tick: (t, g, pan) => s.noiseHit(out, t, { type: 'highpass', freq: 5000, gain: 0.15 * g, decay: 0.003, length: 0.03, pan }),
      pop: (t, g, pan) => s.tone(out, t, { freq: 620, to: 300, glide: 0.06, gain: 0.22 * g, attack: 0.003, decay: 0.04, length: 0.18, pan, send: verb, sendGain: 0.12 }),
      flip: (t, g, pan) => {
        s.noiseHit(out, t, { type: 'bandpass', freq: 2000, q: 0.8, gain: 0.25 * g, attack: 0.004, decay: 0.035, length: 0.2, pan });
        s.tone(out, t, { freq: 360, to: 170, glide: 0.08, gain: 0.1 * g, decay: 0.04, length: 0.15, pan });
      },
      shimmer: (t, g) => chord(t, ['D6', 'F#6', 'A6', 'D7'], g, { gap: 0.06, gain: 0.05, decay: 0.3, spread: 0.8 }),
      sparkle: (t, g) => chord(t, ['E6', 'B6', 'E7'], g, { gap: 0.04, gain: 0.05, decay: 0.2 }),
      chime: (t, g) => chord(t, ['D6', 'F#6', 'A6'], g, { gap: 0.08, gain: 0.06, decay: 0.4 }),
      ding: (t, g, pan) => s.tone(out, t, { freq: hz('A6'), gain: 0.07 * g, decay: 0.16, length: 0.8, rel: 0.1, pan, send: verb, sendGain: 0.4 }),
      scan: (t, g) => s.tone(out, t, { type: 'triangle', freq: 300, to: 1200, glide: 0.8, gain: 0.06 * g, attack: 0.25, decay: 0.3, length: 1, rel: 0.1, filter: { from: 1800 } }),
      lock: (t, g, pan) => {
        s.tone(out, t, { freq: hz('E6'), gain: 0.08 * g, decay: 0.08, length: 0.4, pan, send: verb, sendGain: 0.3 });
        s.tone(out, t + 0.1, { freq: hz('B6'), gain: 0.08 * g, decay: 0.15, length: 0.6, rel: 0.1, pan, send: verb, sendGain: 0.3 });
      },
    };
    for (const e of c.sfx) {
      if (!fx[e.type]) throw new Error(`Unknown sound effect '${e.type}'.`);
      fx[e.type](e.t, e.gain, e.pan);
    }
    return ctx.startRendering();
  }

  /** Places the narration lines on the timeline with gentle cleanup. */
  async function renderVoice(tl, baseUrl) {
    const ctx = new OfflineAudioContext(2, Math.ceil((tl.duration + 0.5) * SR), SR);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 75;
    const presence = ctx.createBiquadFilter();
    presence.type = 'highshelf';
    presence.frequency.value = 4500;
    presence.gain.value = 2;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 2.5;
    comp.attack.value = 0.005;
    comp.release.value = 0.15;
    comp.knee.value = 8;
    hp.connect(presence).connect(comp).connect(ctx.destination);
    for (const line of tl.lines) {
      const data = await (await fetch(`${baseUrl}/${line.file}`)).arrayBuffer();
      const buf = await ctx.decodeAudioData(data);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const level = ctx.createGain();
      level.gain.value = 10 ** ((line.gainDb ?? 0) / 20);
      src.connect(level).connect(hp);
      src.start(line.start);
    }
    return ctx.startRendering();
  }

  const stems = {};

  async function render(tl, voiceUrl) {
    const c = global.buildCues(tl);
    stems.music = await renderMusic(c, tl);
    stems.sfx = await renderSfx(c);
    stems.voice = await renderVoice(tl, voiceUrl);
    return Object.fromEntries(Object.entries(stems).map(([k, b]) => [k, { channels: b.numberOfChannels, length: b.length, sampleRate: b.sampleRate }]));
  }

  /** Returns a slice of a rendered stem channel as base64 Float32 data. */
  function chunk(name, channel, start, length) {
    const data = stems[name].getChannelData(channel).subarray(start, start + length);
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  global.SCORE = { render, chunk };
})(window);
