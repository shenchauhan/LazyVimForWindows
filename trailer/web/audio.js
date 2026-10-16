// Procedural soundtrack for the trailer: an original electro-pop score, sound effects, and the
// narration bed, all rendered offline with the Web Audio API so the result is deterministic.
(function (global) {
  'use strict';

  const SR = 48000;
  const PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const hz = (name) => {
    const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
    const midi = (Number(m[3]) + 1) * 12 + PITCH[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return 440 * 2 ** ((midi - 69) / 12);
  };
  function mulberry32(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // I–V–vi–IV in D major: bright and upbeat.
  const PROGRESSION = [
    { bass: 'D2', pad: ['D4', 'F#4', 'A4', 'D5'], arp: ['D5', 'F#5', 'A5', 'D6'] },
    { bass: 'A1', pad: ['C#4', 'E4', 'A4', 'C#5'], arp: ['C#5', 'E5', 'A5', 'C#6'] },
    { bass: 'B1', pad: ['D4', 'F#4', 'B4', 'D5'], arp: ['B4', 'D5', 'F#5', 'B5'] },
    { bass: 'G1', pad: ['D4', 'G4', 'B4', 'D5'], arp: ['B4', 'D5', 'G5', 'B5'] },
  ];
  const ARP_PATTERN = [0, 2, 1, 3, 2, 1, 0, 2];
  const INTRO_RIFF = ['D3', null, 'F3', 'D3', 'G3', null, 'F3', 'E3', 'D3', null, 'A2', null, 'C#3', 'D3', null, null];

  /** Shared synthesis helpers bound to one OfflineAudioContext. */
  function studio(ctx, seed = 1) {
    const rand = mulberry32(seed);
    const noise = ctx.createBuffer(1, SR * 2, SR);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = rand() * 2 - 1;

    const ir = ctx.createBuffer(2, SR * 2.6, SR);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      const r = mulberry32(seed * 7 + c);
      for (let i = 0; i < d.length; i++) {
        const t = i / SR;
        d[i] = (r() * 2 - 1) * Math.exp(-t * 2.6) * Math.min(1, t / 0.008);
      }
    }

    const env = (param, t, peak, attack, decay, base = 0) => {
      param.setValueAtTime(base, t);
      param.linearRampToValueAtTime(peak, t + attack);
      param.setTargetAtTime(base, t + attack, decay);
    };

    function reverb(dest, wet = 1) {
      const conv = ctx.createConvolver();
      conv.buffer = ir;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 6500;
      const g = ctx.createGain();
      g.gain.value = wet;
      conv.connect(lp).connect(g).connect(dest);
      return conv;
    }

    function noiseHit(dest, t, { type = 'highpass', freq = 7000, q = 0.7, gain = 0.3, attack = 0.001, decay = 0.05, length = 1, pan = 0, send, sendGain = 0.2 }) {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      env(g.gain, t, gain, attack, decay);
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      src.connect(f).connect(g).connect(p).connect(dest);
      if (send) {
        const s = ctx.createGain();
        s.gain.value = sendGain;
        p.connect(s).connect(send);
      }
      src.start(t, rand() * 1.2);
      src.stop(t + length);
      return { src, filter: f, gain: g };
    }

    function tone(dest, t, { type = 'sine', freq, to, glide = 0.1, gain = 0.3, attack = 0.002, decay = 0.1, length = 0.6, pan = 0, detune = 0, send, sendGain = 0.2, filter }) {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = detune;
      o.frequency.setValueAtTime(freq, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + glide);
      const g = ctx.createGain();
      env(g.gain, t, gain, attack, decay);
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      let node = o;
      if (filter) {
        const f = ctx.createBiquadFilter();
        f.type = filter.type ?? 'lowpass';
        f.Q.value = filter.q ?? 0.7;
        f.frequency.setValueAtTime(filter.from, t);
        if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, t + (filter.time ?? 0.15));
        node = node.connect(f);
      }
      node.connect(g).connect(p).connect(dest);
      if (send) {
        const s = ctx.createGain();
        s.gain.value = sendGain;
        p.connect(s).connect(send);
      }
      o.start(t);
      o.stop(t + length);
      return o;
    }

    return { rand, noise, env, reverb, noiseHit, tone };
  }

  /** Builds the drum kit and synths on top of a studio. */
  function instruments(ctx, s, bus) {
    return {
      kick(t, vel = 1) {
        s.tone(bus.drums, t, { freq: 155, to: 46, glide: 0.11, gain: 0.95 * vel, attack: 0.003, decay: 0.11, length: 0.7 });
        s.noiseHit(bus.drums, t, { type: 'bandpass', freq: 3200, q: 0.9, gain: 0.22 * vel, decay: 0.006, length: 0.06 });
      },
      clap(t, vel = 1) {
        for (let k = 0; k < 3; k++) {
          s.noiseHit(bus.drums, t + k * 0.011, { type: 'bandpass', freq: 1150, q: 1.4, gain: 0.5 * vel, decay: 0.006, length: 0.08 });
        }
        s.noiseHit(bus.drums, t + 0.022, { type: 'bandpass', freq: 1350, q: 1.1, gain: 0.42 * vel, decay: 0.055, length: 0.5, send: bus.verb, sendGain: 0.35 });
      },
      hat(t, vel = 1, open = false) {
        s.noiseHit(bus.drums, t, { type: 'highpass', freq: 7600, q: 0.6, gain: (open ? 0.32 : 0.26) * vel, decay: open ? 0.075 : 0.012, length: open ? 0.6 : 0.12, pan: open ? 0.25 : -0.2 });
      },
      snare(t, vel = 1) {
        s.noiseHit(bus.drums, t, { type: 'bandpass', freq: 1900, q: 0.6, gain: 0.34 * vel, decay: 0.045, length: 0.3, send: bus.verb, sendGain: 0.2 });
        s.tone(bus.drums, t, { type: 'triangle', freq: 210, to: 150, glide: 0.05, gain: 0.25 * vel, decay: 0.035, length: 0.2 });
      },
      crash(t, vel = 1) {
        s.noiseHit(bus.drums, t, { type: 'highpass', freq: 3800, q: 0.5, gain: 0.26 * vel, decay: 0.6, length: 3.2, send: bus.verb, sendGain: 0.3 });
        s.noiseHit(bus.drums, t, { type: 'bandpass', freq: 9000, q: 1.5, gain: 0.12 * vel, decay: 0.9, length: 3.5, pan: 0.3 });
      },
      bass(t, len, note, vel = 1, dest = bus.bass) {
        const f = hz(note);
        const filter = { from: 1500, to: 320, time: 0.16, q: 5 };
        s.tone(dest, t, { type: 'sawtooth', freq: f, gain: 0.26 * vel, attack: 0.004, decay: len * 0.9, length: len + 0.3, filter });
        s.tone(dest, t, { type: 'sine', freq: f, gain: 0.34 * vel, attack: 0.004, decay: len * 0.9, length: len + 0.3 });
      },
      chord(t, len, notes, vel = 1, dest = bus.pad, bright = 2600) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = bright;
        lp.Q.value = 0.6;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.055 * vel, t + 0.03);
        g.gain.setValueAtTime(0.055 * vel, t + len);
        g.gain.setTargetAtTime(0, t + len, 0.12);
        lp.connect(g).connect(dest);
        g.connect(bus.verbIn(0.25));
        for (const n of notes) {
          [-14, 0, 14].forEach((cents, i) => {
            const o = ctx.createOscillator();
            o.type = 'sawtooth';
            o.frequency.value = hz(n);
            o.detune.value = cents + (s.rand() - 0.5) * 4;
            const p = ctx.createStereoPanner();
            p.pan.value = (i - 1) * 0.6;
            o.connect(p).connect(lp);
            o.start(t);
            o.stop(t + len + 1);
          });
        }
      },
      pluck(t, note, vel = 1, dest = bus.arp) {
        s.tone(dest, t, { type: 'square', freq: hz(note), gain: 0.09 * vel, attack: 0.002, decay: 0.07, length: 0.45, filter: { from: 6000, to: 1000, time: 0.12, q: 2 } });
        s.tone(dest, t, { type: 'triangle', freq: hz(note) * 2, gain: 0.04 * vel, attack: 0.002, decay: 0.05, length: 0.3 });
      },
      pizz(t, note, vel = 1, dest = bus.intro) {
        s.tone(dest, t, { type: 'triangle', freq: hz(note), gain: 0.36 * vel, attack: 0.002, decay: 0.09, length: 0.5, filter: { from: 2600, to: 700, time: 0.1, q: 1.5 } });
        s.tone(dest, t, { type: 'sine', freq: hz(note) * 2, gain: 0.08 * vel, attack: 0.002, decay: 0.05, length: 0.3 });
      },
      riser(t0, t1, vel = 1) {
        const n = s.noiseHit(bus.fx, t0, { type: 'bandpass', freq: 300, q: 2.2, gain: 0, decay: 10, length: t1 - t0 + 0.05 });
        n.filter.frequency.setValueAtTime(300, t0);
        n.filter.frequency.exponentialRampToValueAtTime(9000, t1);
        n.gain.gain.cancelScheduledValues(t0);
        n.gain.gain.setValueAtTime(0.0001, t0);
        n.gain.gain.exponentialRampToValueAtTime(0.32 * vel, t1);
        n.gain.gain.setValueAtTime(0, t1);
        const o = s.tone(bus.fx, t0, { type: 'sawtooth', freq: 140, to: 1100, glide: t1 - t0, gain: 0.035 * vel, attack: t1 - t0, decay: 0.01, length: t1 - t0, filter: { from: 900, to: 5000, time: t1 - t0 } });
        return o;
      },
      reverseCymbal(t0, t1, vel = 1) {
        const n = s.noiseHit(bus.fx, t0, { type: 'highpass', freq: 4200, q: 0.5, gain: 0, decay: 10, length: t1 - t0 + 0.02 });
        n.gain.gain.cancelScheduledValues(t0);
        n.gain.gain.setValueAtTime(0.0001, t0);
        n.gain.gain.exponentialRampToValueAtTime(0.3 * vel, t1);
        n.gain.gain.setValueAtTime(0, t1);
      },
      impact(t, vel = 1) {
        s.tone(bus.fx, t, { freq: 72, to: 27, glide: 1.3, gain: 0.85 * vel, attack: 0.004, decay: 0.55, length: 2.4 });
        s.noiseHit(bus.fx, t, { type: 'lowpass', freq: 500, q: 0.7, gain: 0.5 * vel, decay: 0.18, length: 1.2, send: bus.verb, sendGain: 0.4 });
      },
    };
  }

  /** Iterates beat times on a grid between `from` and `to`. */
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

  /** Bars overlapping [from, to), clipped to that range, with their progression chord. */
  function bars(from, to, origin, beat) {
    const out = [];
    const len = beat * 4;
    for (let k = Math.floor((from - origin) / len + 1e-6); ; k++) {
      const start = Math.max(from, origin + k * len);
      const end = Math.min(to, origin + (k + 1) * len);
      if (start >= to - 1e-6) break;
      if (end - start > 0.05) out.push({ start, end, chord: PROGRESSION[((k % 4) + 4) % 4] });
    }
    return out;
  }
  const chordAt = (t, origin, beat) => PROGRESSION[((Math.floor((t - origin) / (beat * 4) + 1e-6) % 4) + 4) % 4];

  function busses(ctx, s, out) {
    const verb = s.reverb(out, 0.9);
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
    return { verb, verbIn, drums: make(1), bass: make(1), pad: make(1), arp: make(1), fx: make(1), intro: make(1) };
  }

  /** Short sidechain-style dips on a gain param at every beat. */
  function pump(param, times, depth = 0.4) {
    for (const t of times) {
      param.setTargetAtTime(depth, t, 0.004);
      param.setTargetAtTime(1, t + 0.03, 0.075);
    }
  }

  async function renderIntro(c, tl) {
    const len = c.E.tapeStop + 1;
    const ctx = new OfflineAudioContext(2, Math.ceil(len * SR), SR);
    const s = studio(ctx, 3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(900, 0);
    lp.frequency.exponentialRampToValueAtTime(2600, c.struggle.tabs47);
    lp.frequency.setValueAtTime(2600, c.struggle.gloom);
    lp.frequency.exponentialRampToValueAtTime(500, c.E.tapeStop);
    lp.connect(ctx.destination);
    const bus = busses(ctx, s, lp);
    const ins = instruments(ctx, s, bus);
    const beat = c.beat;
    for (const { t, k } of beats(0, c.E.tapeStop, 0, beat)) {
      ins.kick(t, 0.55);
      if (t >= c.struggle.compiler - 0.3 && k % 2 === 1) ins.clap(t, 0.45);
    }
    for (const { t, k } of beats(0, c.E.tapeStop, 0, beat, 0.5)) {
      if (k % 2 === 1) ins.hat(t, 0.55);
      const note = INTRO_RIFF[k % INTRO_RIFF.length];
      if (note) ins.pizz(t, note, 0.9);
      if (t >= c.struggle.path && k % 2 === 1) ins.bass(t, beat * 0.4, 'D2', 0.55);
    }
    // A comic dissonant "dun!" when the 47 tabs land.
    ins.chord(c.struggle.tabs47, 0.35, ['D4', 'Eb4', 'Ab4'], 1.4, bus.pad, 3000);
    return ctx.startRendering();
  }

  /** Renders the music stem with arrangement, drops, and ducking under the narration. */
  async function renderMusic(c, tl) {
    const E = c.E;
    const S = c.S;
    const beat = c.beat;
    const intro = await renderIntro(c, tl);
    const ctx = new OfflineAudioContext(2, Math.ceil((E.end + 0.5) * SR), SR);
    const s = studio(ctx, 9);

    // Master chain: duck EQ -> duck gain -> glue compressor -> out.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.2;
    comp.knee.value = 6;
    comp.connect(ctx.destination);
    const duck = ctx.createGain();
    duck.connect(comp);
    const eq = ctx.createBiquadFilter();
    eq.type = 'peaking';
    eq.frequency.value = 2600;
    eq.Q.value = 0.9;
    eq.connect(duck);
    const gate = ctx.createGain();
    gate.connect(eq);
    const bus = busses(ctx, s, gate);
    const ins = instruments(ctx, s, bus);

    // Intro with a tape-stop into silence.
    const tape = ctx.createBufferSource();
    tape.buffer = intro;
    tape.playbackRate.setValueAtTime(1, E.tapeStop - 0.62);
    tape.playbackRate.exponentialRampToValueAtTime(0.05, E.tapeStop);
    const tapeGain = ctx.createGain();
    tapeGain.gain.setValueAtTime(1, E.tapeStop - 0.62);
    tapeGain.gain.linearRampToValueAtTime(0.35, E.tapeStop - 0.08);
    tapeGain.gain.linearRampToValueAtTime(0, E.tapeStop);
    // The pitch dive drags the kick and bass into the sub range; keep that rumble in check.
    const tapeHp = ctx.createBiquadFilter();
    tapeHp.type = 'highpass';
    tapeHp.frequency.setValueAtTime(30, 0);
    tapeHp.frequency.setValueAtTime(30, E.tapeStop - 0.62);
    tapeHp.frequency.exponentialRampToValueAtTime(90, E.tapeStop);
    tape.connect(tapeHp).connect(tapeGain).connect(eq);
    tape.start(0);
    tape.stop(E.tapeStop + 0.05);

    // Gap: riser and reverse cymbal into the first drop.
    ins.riser(c.hook.notIn + 0.15, E.drop - 0.02, 1.6);
    ins.reverseCymbal(E.drop - 1.1, E.drop, 1.4);
    ins.impact(E.drop, 1);
    ins.crash(E.drop, 1);

    const groove = (from, to, origin, { arp = false, energy = 1 } = {}) => {
      const beatTimes = beats(from, to, origin, beat);
      pump(bus.pad.gain, beatTimes.map((b) => b.t), 0.35);
      pump(bus.bass.gain, beatTimes.map((b) => b.t), 0.25);
      for (const { t, k } of beatTimes) {
        ins.kick(t, 1);
        if (k % 2 === 1) ins.clap(t, 0.85 * energy);
        if (t + beat / 2 < to) ins.bass(t + beat / 2, beat * 0.42, chordAt(t, origin, beat).bass, 1);
      }
      for (const { t, k } of beats(from, to, origin, beat, 0.25)) {
        const pos = ((k % 4) + 4) % 4;
        ins.hat(t, [0.35, 0.22, 0.6, 0.25][pos] * energy);
        if (pos === 2) ins.hat(t, 0.5 * energy, true);
        if (arp) ins.pluck(t, chordAt(t, origin, beat).arp[ARP_PATTERN[((k % 8) + 8) % 8]], 0.9);
      }
      for (const b of bars(from, to, origin, beat)) ins.chord(b.start, b.end - b.start - 0.02, b.chord.pad, 1);
    };

    // Main section from the drop through the feature tour; the arp joins for the WinGet tour.
    groove(E.drop, S.winget.start, E.drop);
    groove(S.winget.start, S.safe.start, E.drop, { arp: true });
    for (const t of [S.command.start, S.winget.start, S.arch.start]) {
      ins.crash(t, 0.3);
      for (let i = 0; i < 4; i++) ins.snare(t - beat + i * beat / 4, 0.25 + i * 0.12);
    }

    // Breakdown: soft pads and a lazy arp for "Relax".
    for (const b of bars(S.safe.start, S.launch.start, E.drop, beat)) {
      ins.chord(b.start, b.end - b.start, b.chord.pad, 0.9, bus.pad, 1300);
      ins.bass(b.start, (b.end - b.start) * 0.95, b.chord.bass, 0.6);
    }
    for (const { t, k } of beats(S.safe.start, S.launch.start, E.drop, beat, 0.5)) {
      ins.pluck(t, chordAt(t, E.drop, beat).arp[ARP_PATTERN[((k % 8) + 8) % 8]], 0.55);
      if (k % 2 === 1) ins.hat(t, 0.25);
    }

    // Build: pad swells, snare roll accelerates into a beat of silence before "Boom!".
    const buildEnd = E.boom - 0.2;
    const swell = ctx.createGain();
    swell.gain.setValueAtTime(0.0001, S.launch.start);
    swell.gain.exponentialRampToValueAtTime(1, buildEnd);
    swell.gain.setValueAtTime(0, buildEnd);
    swell.connect(bus.pad);
    ins.chord(S.launch.start, buildEnd - S.launch.start, PROGRESSION[3].pad, 1.1, swell, 3800);
    ins.bass(S.launch.start, buildEnd - S.launch.start, 'G1', 0.7);
    ins.riser(S.launch.start, buildEnd, 1);
    const roll = [];
    for (let t = E.boom - beat; t > S.launch.start + 0.2; t -= beat) roll.push([t, 1]);
    roll.forEach(([t]) => {
      const left = E.boom - t;
      const step = left <= beat * 1.5 ? beat / 4 : left <= beat * 3 ? beat / 2 : beat;
      for (let x = t; x < t + beat - 1e-6 && x < buildEnd; x += step) {
        ins.snare(x, 0.25 + 0.75 * (1 - (E.boom - x) / (E.boom - S.launch.start)));
      }
    });

    // Second drop on "Boom!" and the closing groove.
    ins.impact(E.boom, 1.1);
    ins.crash(E.boom, 1);
    groove(E.boom, E.finalHit, E.boom, { arp: true });
    ins.crash(S.cta.start, 0.6);

    // Final hit, then let it ring.
    ins.kick(E.finalHit, 1);
    ins.impact(E.finalHit, 0.65);
    ins.crash(E.finalHit, 0.9);
    ins.chord(E.finalHit, 0.6, ['D3', 'A3', 'D4', 'F#4', 'A4', 'D5'], 1.15, bus.pad, 4200);
    ins.bass(E.finalHit, 0.8, 'D2', 1);

    // Duck the music under the narration, deeper during speech and lighter for shouted one-liners.
    const depth = { 'hook-1': 0.5, 'hook-2': 0.45, 'launch-2': 0.7 };
    const segments = [];
    for (const l of tl.lines) {
      const level = depth[l.id] ?? 0.25;
      const last = segments.at(-1);
      if (last && l.start - last.end < 0.6) {
        last.end = l.end;
        last.level = Math.min(last.level, level);
      } else {
        segments.push({ start: l.start, end: l.end, level });
      }
    }
    duck.gain.setValueAtTime(1, 0);
    eq.gain.setValueAtTime(0, 0);
    for (const seg of segments) {
      duck.gain.setValueAtTime(1, seg.start - 0.15);
      duck.gain.linearRampToValueAtTime(seg.level, seg.start);
      duck.gain.setValueAtTime(seg.level, seg.end + 0.05);
      duck.gain.linearRampToValueAtTime(1, seg.end + 0.45);
      eq.gain.setValueAtTime(0, seg.start - 0.15);
      eq.gain.linearRampToValueAtTime(-5, seg.start);
      eq.gain.setValueAtTime(-5, seg.end + 0.05);
      eq.gain.linearRampToValueAtTime(0, seg.end + 0.45);
    }
    // Hard stop for the air-gap before "Boom!" and after the final ring-out.
    gate.gain.setValueAtTime(1, 0);
    gate.gain.setValueAtTime(1, buildEnd - 0.01);
    gate.gain.linearRampToValueAtTime(0, buildEnd);
    gate.gain.setValueAtTime(0, E.boom - 0.005);
    gate.gain.linearRampToValueAtTime(1, E.boom);
    gate.gain.setValueAtTime(1, E.end - 1.2);
    gate.gain.linearRampToValueAtTime(0, E.end);
    return ctx.startRendering();
  }

  /** Renders the UI sound effects listed in the cue sheet. */
  async function renderSfx(c) {
    const ctx = new OfflineAudioContext(2, Math.ceil((c.E.end + 0.5) * SR), SR);
    const s = studio(ctx, 21);
    const out = ctx.createGain();
    out.connect(ctx.destination);
    const verb = s.reverb(out, 0.6);
    const fx = {
      key: (t, g, pan) => {
        s.noiseHit(out, t, { type: 'bandpass', freq: 3800 + s.rand() * 1500, q: 1.2, gain: 0.25 * g, decay: 0.004, length: 0.05, pan });
        s.tone(out, t, { freq: 190 + s.rand() * 40, gain: 0.18 * g, decay: 0.012, length: 0.08, pan });
      },
      enter: (t, g) => {
        s.noiseHit(out, t, { type: 'bandpass', freq: 2600, q: 1, gain: 0.35 * g, decay: 0.006, length: 0.08 });
        s.tone(out, t, { freq: 140, to: 90, glide: 0.05, gain: 0.4 * g, decay: 0.03, length: 0.2 });
      },
      error: (t, g, pan) => {
        s.tone(out, t, { type: 'triangle', freq: 330, gain: 0.22 * g, decay: 0.07, length: 0.3, pan, send: verb, sendGain: 0.15 });
        s.tone(out, t + 0.09, { type: 'triangle', freq: 262, gain: 0.22 * g, decay: 0.12, length: 0.4, pan, send: verb, sendGain: 0.15 });
      },
      whoosh: (t, g, pan) => {
        const n = s.noiseHit(out, t - 0.18, { type: 'bandpass', freq: 400, q: 1.1, gain: 0, decay: 10, length: 0.7, pan });
        n.filter.frequency.setValueAtTime(400, t - 0.18);
        n.filter.frequency.exponentialRampToValueAtTime(3800, t);
        n.filter.frequency.exponentialRampToValueAtTime(700, t + 0.35);
        n.gain.gain.cancelScheduledValues(t - 0.18);
        n.gain.gain.setValueAtTime(0.0001, t - 0.18);
        n.gain.gain.exponentialRampToValueAtTime(0.4 * g, t);
        n.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      },
      tick: (t, g, pan) => s.noiseHit(out, t, { type: 'highpass', freq: 5000, gain: 0.18 * g, decay: 0.003, length: 0.03, pan }),
      pop: (t, g, pan) => s.tone(out, t, { freq: 950, to: 330, glide: 0.07, gain: 0.32 * g, attack: 0.002, decay: 0.04, length: 0.2, pan, send: verb, sendGain: 0.12 }),
      flip: (t, g, pan) => {
        s.noiseHit(out, t, { type: 'bandpass', freq: 2200, q: 0.8, gain: 0.3 * g, decay: 0.03, length: 0.2, pan });
        s.tone(out, t, { freq: 420, to: 180, glide: 0.08, gain: 0.12 * g, decay: 0.04, length: 0.15, pan });
      },
      crt: (t, g) => {
        s.tone(out, t, { freq: 1800, to: 60, glide: 0.4, gain: 0.12 * g, attack: 0.01, decay: 0.2, length: 0.6 });
        s.noiseHit(out, t + 0.28, { type: 'highpass', freq: 2500, gain: 0.25 * g, decay: 0.02, length: 0.2 });
      },
      slam: (t, g) => {
        s.tone(out, t, { freq: 110, to: 42, glide: 0.18, gain: 0.55 * g, decay: 0.12, length: 0.6 });
        s.noiseHit(out, t, { type: 'lowpass', freq: 1800, gain: 0.3 * g, decay: 0.05, length: 0.4, send: verb, sendGain: 0.3 });
      },
      shimmer: (t, g) => ['C6', 'E6', 'G6', 'C7'].forEach((n, i) => s.tone(out, t + i * 0.05, { freq: hz(n), gain: 0.07 * g, decay: 0.25, length: 1.2, pan: -0.4 + i * 0.27, send: verb, sendGain: 0.6 })),
      sparkle: (t, g) => ['E6', 'B6', 'E7'].forEach((n, i) => s.tone(out, t + i * 0.035, { freq: hz(n), gain: 0.06 * g, decay: 0.18, length: 0.9, pan: 0.4 - i * 0.4, send: verb, sendGain: 0.6 })),
      ding: (t, g, pan) => {
        s.tone(out, t, { freq: hz('A6'), gain: 0.08 * g, decay: 0.16, length: 0.8, pan, send: verb, sendGain: 0.4 });
        s.tone(out, t, { freq: hz('A6') * 2.76, gain: 0.025 * g, decay: 0.08, length: 0.5, pan });
      },
      scan: (t, g) => s.tone(out, t, { type: 'triangle', freq: 300, to: 1500, glide: 0.65, gain: 0.08 * g, attack: 0.2, decay: 0.3, length: 1, filter: { from: 2000 } }),
      lock: (t, g, pan) => {
        s.tone(out, t, { freq: hz('E6'), gain: 0.1 * g, decay: 0.08, length: 0.4, pan, send: verb, sendGain: 0.3 });
        s.tone(out, t + 0.09, { freq: hz('B6'), gain: 0.1 * g, decay: 0.15, length: 0.6, pan, send: verb, sendGain: 0.3 });
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
