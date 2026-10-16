// LazyVim for Windows trailer: every visual is a pure function of time so frames can be rendered
// in any order. TRAILER.init(timeline) builds the scenes; TRAILER.seek(t) draws the frame at t seconds.
(() => {
  'use strict';

  const W = 1920;
  const H = 1080;
  const $ = (id) => document.getElementById(id);
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, p) => a + (b - a) * p;
  const prog = (t, a, d) => clamp((t - a) / d);
  const ease = {
    outCubic: (p) => 1 - (1 - p) ** 3,
    inCubic: (p) => p ** 3,
    inQuart: (p) => p ** 4,
    inOutCubic: (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
    outQuint: (p) => 1 - (1 - p) ** 5,
    outExpo: (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p)),
    inExpo: (p) => (p <= 0 ? 0 : 2 ** (10 * p - 10)),
    outBack: (p, s = 1.70158) => 1 + (s + 1) * (p - 1) ** 3 + s * (p - 1) ** 2,
    inBack: (p, s = 1.70158) => (s + 1) * p ** 3 - s * p ** 2,
  };
  /** Damped spring from 0 to 1, `t` seconds after it starts. */
  function spring(t, freq = 2.4, damp = 0.42) {
    if (t <= 0) return 0;
    const w = 2 * Math.PI * freq;
    const wd = w * Math.sqrt(1 - damp * damp);
    return 1 - Math.exp(-damp * w * t) * (Math.cos(wd * t) + ((damp * w) / wd) * Math.sin(wd * t));
  }
  function mulberry32(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  /** Sets transform/opacity/filter in one go. */
  function put(el, o = {}) {
    const s = o.s ?? 1;
    const sx = o.sx ?? s;
    const sy = o.sy ?? s;
    let tr = '';
    if (o.rx || o.ry) tr += 'perspective(1600px) ';
    tr += `translate(${(o.x ?? 0).toFixed(2)}px, ${(o.y ?? 0).toFixed(2)}px)`;
    if (o.rx) tr += ` rotateX(${o.rx.toFixed(3)}deg)`;
    if (o.ry) tr += ` rotateY(${o.ry.toFixed(3)}deg)`;
    if (o.r) tr += ` rotate(${o.r.toFixed(3)}deg)`;
    if (sx !== 1 || sy !== 1) tr += ` scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
    el.style.transform = tr;
    el.style.opacity = clamp(o.o ?? 1).toFixed(3);
    const f = [];
    if (o.blur > 0.05) f.push(`blur(${o.blur.toFixed(1)}px)`);
    if (o.filter) f.push(o.filter);
    el.style.filter = f.join(' ');
  }
  const setHtml = (el, s) => {
    if (el._h !== s) {
      el.innerHTML = s;
      el._h = s;
    }
  };
  const show = (el, on) => {
    const v = on ? 'visible' : 'hidden';
    if (el.style.visibility !== v) el.style.visibility = v;
  };

  /** Whip transition for scene containers: in from the right, out to the left. */
  function whip(t, start, end, { inDur = 0.32, outDur = 0.26, dist = 360 } = {}) {
    const pin = ease.outCubic(prog(t, start - 0.06, inDur));
    const pout = ease.inCubic(prog(t, end - outDur * 0.7, outDur));
    return {
      x: (1 - pin) * dist - pout * dist,
      o: pin * (1 - pout),
      blur: (1 - pin) * 18 + pout * 18,
    };
  }

  let TL;
  let C;
  let fxc;
  let pc;
  let logo;
  let dashLogo;
  let particles;
  let sparks;
  const els = {};

  // ---------------------------------------------------------------- background
  function setupParticles() {
    const r = mulberry32(99);
    particles = Array.from({ length: 140 }, () => ({
      x: r() * (W + 120),
      y: r() * (H + 120),
      z: 0.3 + r() * 0.7,
      size: 0.8 + r() * 2.6,
      phase: r() * Math.PI * 2,
      hue: ['#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5', '#9ece6a'][Math.floor(r() * 5)],
    }));
    const r2 = mulberry32(5);
    sparks = Array.from({ length: 90 }, () => ({
      angle: r2() * Math.PI * 2,
      speed: 500 + r2() * 1500,
      size: 2 + r2() * 4,
      life: 0.4 + r2() * 0.6,
      hue: ['#ffffff', '#7dcfff', '#7aa2f7', '#bb9af7', '#9ece6a'][Math.floor(r2() * 5)],
    }));
  }

  function beatPulse(t, decay = 7) {
    const sec = C.section(t);
    if (!sec.kick) return 0;
    const b = (t - C.gridOrigin(t)) / C.beat;
    if (b < 0) return 0;
    return Math.exp(-(b - Math.floor(b)) * decay) * sec.energy;
  }

  function sceneMood(t) {
    const E = C.E;
    // 0 = gloomy struggle, 1 = bright LazyVim world.
    if (t < E.tapeStop) return { bright: 0.4 - 0.25 * prog(t, C.struggle.gloom, 1.2), warm: 1, floor: 0 };
    if (t < E.drop) return { bright: 0.12 * prog(t, C.hook.notIn, 0.4), warm: 0, floor: 0 };
    return { bright: 1, warm: 0, floor: 1 };
  }

  function renderBackground(t) {
    const mood = sceneMood(t);
    const pulse = beatPulse(t);
    const hue = mood.warm ? 'hue-rotate(125deg) saturate(.8)' : '';
    const crt = t < C.E.tapeStop ? 1 - prog(t, C.struggle.crtStart, C.struggle.crtEnd - C.struggle.crtStart) : 1;
    const base = mood.bright * crt;
    put(els.blob1, { x: 120 + 320 * Math.sin(t * 0.21), y: -420 + 200 * Math.cos(t * 0.17), o: base * (0.75 + 0.25 * pulse), filter: hue });
    put(els.blob2, { x: 820 + 260 * Math.cos(t * 0.19), y: -120 + 200 * Math.sin(t * 0.23), o: base * (0.7 + 0.3 * pulse), filter: hue });
    put(els.blob3, { x: 260 + 420 * Math.sin(t * 0.13 + 2), y: 180 + 220 * Math.cos(t * 0.27), o: base * 0.8, filter: hue });
    els.floor.style.opacity = (mood.floor * (0.16 + 0.12 * pulse)).toFixed(3);
    els.floor.style.backgroundPosition = `0 ${((t * 170) % 120).toFixed(1)}px`;

    pc.clearRect(0, 0, W, H);
    const speed = t < C.E.drop ? 18 : 70;
    for (const p of particles) {
      const y = (((p.y - t * speed * p.z) % (H + 120)) + H + 120) % (H + 120) - 60;
      const x = p.x + Math.sin(t * 0.6 + p.phase) * 18 * p.z - 60;
      const tw = 0.55 + 0.45 * Math.sin(t * 3 + p.phase);
      pc.globalAlpha = clamp(base * tw * p.z * (0.55 + pulse * 0.6));
      pc.fillStyle = mood.warm ? '#b9a7a7' : p.hue;
      pc.beginPath();
      pc.arc(x, y, p.size * p.z * (1 + pulse * 0.4), 0, Math.PI * 2);
      pc.fill();
    }
    pc.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- fx helpers (canvas)
  function shockwave(t, t0, cx, cy, color = '#7dcfff', maxR = 1100) {
    const p = prog(t, t0, 0.7);
    if (p <= 0 || p >= 1) return;
    const e = ease.outCubic(p);
    fxc.save();
    fxc.strokeStyle = color;
    fxc.globalAlpha = (1 - p) * 0.8;
    fxc.lineWidth = 30 * (1 - p) + 2;
    fxc.beginPath();
    fxc.arc(cx, cy, 40 + e * maxR, 0, Math.PI * 2);
    fxc.stroke();
    fxc.restore();
  }

  function burst(t, t0, cx, cy) {
    const d = t - t0;
    if (d < 0 || d > 1.2) return;
    fxc.save();
    for (const s of sparks) {
      const p = d / s.life;
      if (p >= 1) continue;
      const dist = s.speed * (1 - (1 - p) ** 3) * 0.75;
      const x = cx + Math.cos(s.angle) * dist;
      const y = cy + Math.sin(s.angle) * dist * 0.7;
      fxc.globalAlpha = (1 - p) * 0.9;
      fxc.fillStyle = s.hue;
      fxc.beginPath();
      fxc.arc(x, y, s.size * (1 - p * 0.5), 0, Math.PI * 2);
      fxc.fill();
    }
    fxc.restore();
  }

  function speedLines(t, from, to, cx, cy) {
    const p = prog(t, from, to - from);
    if (p <= 0 || p >= 1) return;
    const r = mulberry32(31);
    fxc.save();
    fxc.lineCap = 'round';
    for (let i = 0; i < 48; i++) {
      const a = r() * Math.PI * 2;
      const phase = (r() + t * (1.2 + r() * 1.5)) % 1;
      const r0 = lerp(1300, 120, phase);
      const len = 80 + 200 * phase;
      fxc.globalAlpha = ease.inCubic(p) * 0.55 * phase;
      fxc.strokeStyle = i % 3 ? '#7aa2f7' : '#ffffff';
      fxc.lineWidth = 1.5 + 2.5 * phase;
      fxc.beginPath();
      fxc.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.6);
      fxc.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len) * 0.6);
      fxc.stroke();
    }
    fxc.restore();
  }

  // ---------------------------------------------------------------- 1. struggle
  const TAB_TITLES = [
    'How to install Neovim on Windows', 'nvim not recognized PowerShell', 'Add folder to PATH Windows 11',
    'tree-sitter No C compiler found', 'MinGW vs MSVC vs Zig??', 'Install ripgrep on Windows',
    'fzf Windows setup', 'Why is my config not loading', 'Neovim Windows clipboard', 'gcc not found nvim-treesitter',
    'Scoop vs Chocolatey vs WinGet', 'LazyVim checkhealth errors', 'Set environment variable permanently',
    'Visual Studio Build Tools download', 'lua-language-server ARM64',
  ];
  const TAB_COLORS = ['#8ab4f8', '#f28b82', '#fdd663', '#81c995', '#c58af9', '#78d9ec', '#fcad70'];

  function renderStruggle(t) {
    const c = C.struggle;
    const scene = els.sStruggle;
    // CRT power-off squeezes the whole scene to a line, then to a dot.
    const crt = prog(t, c.crtStart, c.crtEnd - c.crtStart);
    const sy = crt < 0.55 ? lerp(1, 0.004, ease.inCubic(crt / 0.55)) : 0.004;
    const sx = crt < 0.55 ? 1 : lerp(1, 0, ease.inCubic((crt - 0.55) / 0.45));
    const gloom = ease.inOutCubic(prog(t, c.gloom, 1.1));
    put(scene, {
      sx, sy,
      o: crt >= 1 ? 0 : 1,
      filter: `grayscale(${(gloom * 0.85).toFixed(2)}) brightness(${(1 - gloom * 0.25 + crt * 2.5).toFixed(2)})`,
    });
    if (crt > 0.5 && t < c.crtEnd + 0.35) {
      const a = t < c.crtEnd ? 1 : 1 - prog(t, c.crtEnd, 0.35);
      fxc.save();
      const g = fxc.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 60);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      fxc.fillStyle = g;
      fxc.fillRect(W / 2 - 60, H / 2 - 60, 120, 120);
      fxc.restore();
    }
    const sag = ease.inOutCubic(prog(t, c.gloom + 0.4, 1.4));

    // Terminal: type `nvim`, get an error.
    const termIn = spring(t - c.termIn, 2.2, 0.5);
    const kick = (t0) => (t > t0 && t < t0 + 0.4 ? Math.sin((t - t0) * 60) * 9 * (1 - (t - t0) / 0.4) : 0);
    put(els.stTerm, {
      y: (1 - termIn) * 80 + sag * 30 + kick(c.compiler) * 0.5,
      x: kick(c.path) * 0.6,
      s: lerp(0.9, 1, termIn),
      r: sag * 2.5,
      o: clamp((t - c.termIn) * 6),
    });
    const typed = c.cmd.slice(0, c.keys.filter((k) => t >= k).length);
    const cursorOn = Math.floor(t * 2.2) % 2 === 0;
    let body = `<span class="p">PS C:\\Users\\you&gt;</span> <span class="c">${typed}</span>`;
    if (t < c.enter) body += cursorOn || t < c.keys.at(-1) + 0.1 ? '<span class="cursor"></span>' : '';
    if (t >= c.error) {
      body += '\n<span class="e">nvim: The term \'nvim\' is not recognized as a name of a cmdlet, function, script file, or executable program.</span>';
      body += '\n<span class="e">Check the spelling of the name, or if a path was included, verify that the path is correct and try again.</span>';
    }
    if (t >= c.error + 0.08) body += `\n<span class="p">PS C:\\Users\\you&gt;</span> ${cursorOn ? '<span class="cursor"></span>' : ''}`;
    setHtml(els.stBody, body);

    // Compiler error toast slides in from the right.
    const tp = prog(t, c.compiler, 0.42);
    put(els.stCompiler, {
      x: (1 - ease.outBack(tp, 1.4)) * 900 + kick(c.compiler) * 0.8,
      y: sag * 60,
      r: sag * -7,
      o: tp > 0 ? 1 : 0,
    });

    // PATH dialog pops, with the selection flailing around.
    const dp = prog(t, c.path, 0.4);
    put(els.stPath, {
      s: lerp(0.5, 1, ease.outBack(dp, 2)),
      y: sag * 80,
      r: sag * 6 - (1 - dp) * 8,
      o: dp > 0 ? clamp(dp * 4) : 0,
    });
    const rows = els.stPathRows;
    const sel = t < c.path ? 2 : Math.floor((t - c.path) / 0.14) % rows.length;
    rows.forEach((row, i) => row.classList.toggle('sel', i === sel));

    // Browser tabs multiply to 47.
    const bp = prog(t, c.browserIn, 0.4);
    put(els.stBrowser, { y: (1 - ease.outCubic(bp)) * 560 + sag * 40, r: sag * -3, o: bp > 0 ? 1 : 0 });
    const n = t < c.tabsFrom ? 2 : Math.round(lerp(2, 47, ease.inCubic(prog(t, c.tabsFrom, c.tabs47 - c.tabsFrom))));
    if (els.stTabs._n !== n) {
      els.stTabs._n = n;
      const w = clamp((1170 - 16) / n - 2, 26, 236);
      let tabs = '';
      for (let i = 0; i < n; i++) {
        const title = w > 70 ? `<span>${esc(TAB_TITLES[i % TAB_TITLES.length])}</span>` : '';
        tabs += `<div class="btab" style="width:${w.toFixed(1)}px"><i style="background:${TAB_COLORS[i % TAB_COLORS.length]}"></i>${title}</div>`;
      }
      els.stTabs.innerHTML = tabs;
    }
    const cp = prog(t, c.tabs47 - 0.02, 0.45);
    els.stCount.textContent = String(n);
    put(els.stCount, { s: t < c.tabsFrom ? 0 : lerp(0.4, 1, ease.outBack(cp, 3)) * (1 + 0.08 * Math.sin(t * 20) * (1 - cp)), o: t < c.tabsFrom ? 0 : 1 });

    // Calendar: the weekend gets torn off.
    const cal = prog(t, c.calendarIn, 0.55);
    put(els.stCal, { y: (1 - ease.outBack(cal, 1.3)) * -900, r: (1 - cal) * -10, o: cal > 0 ? 1 : 0 });
    for (const [el, t0] of [[els.stSat, c.sat], [els.stSun, c.sun]]) {
      const p = prog(t, t0, 0.9);
      put(el, {
        rx: -ease.outCubic(clamp(p * 2.2)) * 75,
        y: ease.inCubic(p) * 900,
        x: ease.inCubic(p) * (el === els.stSat ? -260 : 260),
        r: ease.inCubic(p) * (el === els.stSat ? -35 : 35),
        o: 1 - clamp((p - 0.7) / 0.3),
      });
    }
  }

  // ---------------------------------------------------------------- 2. hook
  const LOGO = { cw: 26, ch: 52 };
  function logoBox(cw, ch, cy) {
    const w = logo.cols * cw;
    const h = logo.rows * ch;
    return { x: (W - w) / 2, y: cy - h / 2, w, h };
  }

  function renderHook(t) {
    const c = C.hook;
    // "Not anymore." slams in, then rushes past the camera.
    const inP = prog(t, c.notIn, 0.16);
    const outP = prog(t, c.notOut, 0.32);
    put(els.hkNot, {
      s: lerp(2.6, 1, ease.inCubic(inP)) * lerp(1, 4.5, ease.inCubic(outP)),
      o: clamp(inP * 3) * (1 - outP),
      blur: (1 - inP) * 22 + outP * 12,
      y: -20,
    });

    // The wordmark assembles out of flying blocks and locks in on the drop.
    if (t >= c.gather - 0.05 && t < c.out + 0.4) {
      const box = logoBox(LOGO.cw, LOGO.ch, 430);
      const exit = ease.inCubic(prog(t, c.out - 0.22, 0.3));
      const pulse = beatPulse(t);
      const assemble = prog(t, c.gather, c.drop - c.gather);
      const float = Math.sin((t - c.drop) * 1.6) * 5;
      const scale = (1 + 0.025 * pulse) * (1 - exit * 0.25);
      fxc.save();
      fxc.translate(W / 2 - exit * 380, box.y + box.h / 2 + float);
      fxc.scale(scale, scale);
      fxc.translate(-W / 2, -(box.y + box.h / 2));
      logo.draw(fxc, {
        ...box, ...LOGO,
        assemble,
        ease: ease.inQuart,
        shadow: prog(t, c.drop, 0.5),
        glow: t >= c.drop ? 0.35 + 0.45 * pulse + 0.6 * (1 - prog(t, c.drop, 0.6)) : 0,
        alpha: 1 - exit,
        blur: exit * 16,
      });
      logo.drawZzz(fxc, { x: box.x + box.w + 18, y: box.y + 40, size: 34, t: t - c.zzz, alpha: (t >= c.zzz ? 1 : 0) * (1 - exit) });
      fxc.restore();
      speedLines(t, c.gather + 0.2, c.drop, W / 2, box.y + box.h / 2);
      shockwave(t, c.drop, W / 2, box.y + box.h / 2);
      shockwave(t, c.drop + 0.12, W / 2, box.y + box.h / 2, '#bb9af7', 900);
      burst(t, c.drop, W / 2, box.y + box.h / 2);
    }
    const sp = prog(t, c.subtitle, 0.5);
    const exit = whip(t, -10, c.out);
    put(els.hkSub, { y: (1 - ease.outCubic(sp)) * 60, o: ease.outCubic(sp) * exit.o, x: exit.x, blur: exit.blur + (1 - sp) * 10 });
  }

  // ---------------------------------------------------------------- shared terminal
  const PROMPT = '<span class="p">PS C:\\Users\\you&gt;</span> ';
  const INSTALL_LOG = [
    ['Neovim.Neovim', '11.9 MB'],
    ['BrechtSanders.WinLibs.POSIX.UCRT', '253 MB'],
    ['Microsoft.VisualStudio.BuildTools', '4.2 MB'],
    ['tree-sitter.tree-sitter-cli', '6.1 MB'],
    ['sharkdp.fd', '1.3 MB'],
    ['junegunn.fzf', '1.7 MB'],
    ['BurntSushi.ripgrep.GNU', '2.0 MB'],
    ['Git.Git', '65.2 MB'],
  ];

  function installLines(t) {
    const w = C.winget;
    const out = [];
    const span = (w.logEnd - 1.1 - w.logStart) / INSTALL_LOG.length;
    INSTALL_LOG.forEach(([id, size], i) => {
      const t0 = w.logStart + i * span;
      if (t < t0) return;
      if (id === 'Git.Git') out.push(`<span class="g">Configured CC for X64 as '...\\WinLibs\\mingw64\\bin\\gcc.exe'.</span>`);
      out.push(`Installing <span class="y">${id}</span> from the WinGet community repository...`);
      const p = prog(t, t0 + 0.05, span * 0.7);
      const cells = 24;
      const filled = Math.round(p * cells);
      out.push(`  <span class="bar">${'█'.repeat(filled)}</span><span class="d">${'▒'.repeat(cells - filled)}</span>  ${p >= 1 ? size : '...'}`);
      if (p >= 1) out.push('<span class="g">Successfully installed</span>');
    });
    if (t >= w.logEnd - 0.9) out.push('Cloning the LazyVim starter...');
    if (t >= w.logEnd - 0.45) out.push(`<span class="g">LazyVim starter configured at 'C:\\Users\\you\\AppData\\Local\\nvim'.</span>`);
    if (t >= w.logEnd) out.push('<span class="g">Open a new terminal, run nvim to install the plugins, then run :LazyHealth in Neovim.</span>');
    return out;
  }

  function renderTerminal(t) {
    const S = C.S;
    const term = els.term;
    const cm = C.command;
    const cursorOn = Math.floor(t * 2.2) % 2 === 0;
    const layouts = {
      command: { x: 930, y: 300, w: 900, h: 400, f: 27 },
      winget: { x: 980, y: 140, w: 870, h: 840, f: 21 },
      launch: { x: 360, y: 300, w: 1200, h: 420, f: 34 },
    };
    let L;
    let o = 1;
    let extra = {};
    if (t < S.command.start - 0.4 || t > S.launch.end || (t > S.winget.end + 0.4 && t < S.launch.start - 0.4)) {
      show(term, false);
      return;
    }
    show(term, true);
    if (t < S.winget.start - 0.15) {
      L = layouts.command;
      const p = spring(t - cm.termIn, 2, 0.55);
      extra = { y: (1 - p) * 500, s: lerp(0.85, 1, p) };
      o = clamp((t - cm.termIn) * 5);
    } else if (t < S.launch.start - 0.4) {
      const p = ease.inOutCubic(prog(t, S.winget.start - 0.15, 0.6));
      const a = layouts.command;
      const b = layouts.winget;
      L = { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), w: lerp(a.w, b.w, p), h: lerp(a.h, b.h, p), f: lerp(a.f, b.f, p) };
      const exit = whip(t, -10, S.winget.end, { dist: -420 });
      extra = { x: -exit.x, blur: exit.blur };
      o = exit.o;
    } else {
      L = layouts.launch;
      const ln = C.launch;
      const p = spring(t - ln.termIn, 2.2, 0.55);
      const push = ease.inExpo(prog(t, ln.enter, ln.boom - ln.enter));
      extra = { y: (1 - p) * 400, s: lerp(0.85, 1, p) * (1 + push * 0.9), filter: `brightness(${(1 + push * 1.8).toFixed(2)})` };
      o = clamp((t - ln.termIn) * 5) * (t < ln.boom ? 1 : 0);
    }
    term.style.left = `${L.x}px`;
    term.style.top = `${L.y}px`;
    term.style.width = `${L.w}px`;
    term.style.height = `${L.h}px`;
    els.termBody.style.fontSize = `${L.f.toFixed(2)}px`;
    put(term, { ...extra, o });

    let lines;
    if (t < S.launch.start - 0.4) {
      const typed = cm.cmd.slice(0, cm.keys.filter((k) => t >= k).length);
      const typing = t >= cm.keys[0] && t < cm.keys.at(-1) + 0.1;
      lines = [`${PROMPT}<span class="c">${esc(typed)}</span>${t < cm.enter && (cursorOn || typing) ? '<span class="cursor"></span>' : ''}`];
      lines.push(...installLines(t));
      const rows = Math.floor((L.h - 50 - 48) / (L.f * 1.5));
      // Long lines wrap; estimate wrapped rows so the newest output stays visible.
      const cols = Math.floor((L.w - 60) / (L.f * 0.6));
      const plain = (s) => s.replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
      let used = 0;
      let first = lines.length;
      while (first > 0) {
        const h = Math.max(1, Math.ceil(plain(lines[first - 1]).length / cols));
        if (used + h > rows) break;
        used += h;
        first--;
      }
      lines = lines.slice(first);
    } else {
      const ln = C.launch;
      const typed = 'nvim'.slice(0, ln.keys.filter((k) => t >= k).length);
      lines = [`${PROMPT}<span class="c">${typed}</span>${t < ln.enter ? (cursorOn || t > ln.keys[0] - 0.2 ? '<span class="cursor"></span>' : '') : ''}`];
      if (t >= ln.enter) {
        const spin = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[Math.floor(t * 14) % 10];
        lines.push(`<span class="y">${spin}</span> <span class="d">starting Neovim...</span>`);
      }
    }
    setHtml(els.termBody, lines.join('\n'));
  }

  // ---------------------------------------------------------------- 3. command
  function renderCommand(t) {
    const c = C.command;
    const S = C.S.command;
    const exit = whip(t, -10, S.end, { dist: -400 });
    const kin = [[els.cmK1, c.k1, c.k2], [els.cmK2, c.k2, c.k3], [els.cmK3, c.k3, Infinity]];
    for (const [el, t0, next] of kin) {
      const p = prog(t, t0, 0.38);
      const dim = t >= next ? 0.4 : 1;
      put(el, {
        x: exit.x * -1,
        y: (1 - ease.outBack(p, 2)) * 70,
        s: lerp(0.85, 1, ease.outBack(p, 2)),
        o: clamp(p * 3) * dim * exit.o,
        blur: exit.blur,
      });
    }
    const kp = prog(t, c.enter - 0.35, 0.3);
    const press = t >= c.enter && t < c.enter + 0.14 ? 1 : 0;
    put(els.cmEnter, {
      s: lerp(0.4, 1, ease.outBack(kp, 2.5)) * (press ? 0.94 : 1),
      y: press * 12 + ease.inCubic(prog(t, c.enter + 0.6, 0.4)) * 80,
      o: clamp(kp * 3) * (1 - prog(t, c.enter + 0.6, 0.4)),
    });
    els.cmEnter.style.boxShadow = press ? '0 2px 0 #10111a, 0 10px 24px rgba(0,0,0,.55)' : '';
  }

  // ---------------------------------------------------------------- 4. winget
  const CHIP_POS = {
    neovim: [0, 0], git: [410, 0], compiler: [0, 150], treesitter: [410, 150],
    fd: [0, 300], fzf: [410, 300], ripgrep: [205, 450],
  };

  function renderWinget(t) {
    const c = C.winget;
    const S = C.S.winget;
    const exit = whip(t, -10, S.end, { dist: 420 });
    const bp = prog(t, c.badge, 0.45);
    put(els.wgBadge, { s: lerp(0.6, 1, ease.outBack(bp, 2.2)), o: clamp(bp * 3) * exit.o, x: -exit.x, blur: exit.blur });
    els.wgChips.forEach((chip, i) => {
      const k = chip.dataset.k;
      const t0 = c.chips[k];
      const p = prog(t, t0, 0.45);
      const [x, y] = CHIP_POS[k];
      const bob = Math.sin(t * 2.2 + i) * 4 * p;
      const glow = prog(t, c.allDone + i * 0.07, 0.25) * (1 - prog(t, c.own + 0.4, 0.8));
      put(chip, {
        x: x - exit.x,
        y: y + (1 - ease.outBack(p, 2.4)) * 40 + bob,
        s: lerp(0.2, 1, ease.outBack(p, 2.4)) * (1 + 0.05 * glow),
        r: (1 - p) * -10,
        o: clamp(p * 4) * exit.o,
        blur: exit.blur,
      });
      const cp = prog(t, c.allDone + i * 0.07, 0.35);
      put(chip.querySelector('.check'), { s: lerp(0, 1, ease.outBack(cp, 3)), o: cp > 0 ? 1 : 0 });
    });
  }

  // ---------------------------------------------------------------- 5. arch
  function renderArch(t) {
    const c = C.arch;
    const S = C.S.arch;
    const exit = whip(t, S.start, S.end);
    put(els.arKicker, { o: prog(t, S.start + 0.05, 0.4) * exit.o, x: exit.x, y: (1 - ease.outCubic(prog(t, S.start, 0.5))) * -30, blur: exit.blur });
    const detected = t >= c.detected;
    els.arCards.forEach((card, i) => {
      const p = prog(t, c.cards[i] - 0.05, 0.5);
      const isPick = i === 2;
      const dp = prog(t, c.detected, 0.4);
      const s = isPick ? 1 + 0.08 * ease.outBack(dp, 3) : 1 - 0.05 * dp;
      put(card, {
        ry: (1 - ease.outBack(p, 1.6)) * 90,
        y: (1 - ease.outCubic(p)) * 60,
        s,
        x: exit.x,
        o: clamp(p * 3) * exit.o * (detected && !isPick ? lerp(1, 0.4, dp) : 1),
        blur: exit.blur,
      });
      card.style.borderColor = detected && isPick ? '#9ece6a' : '';
      card.style.boxShadow = detected && isPick ? `0 0 ${(60 + 30 * beatPulse(t)).toFixed(0)}px rgba(158,206,106,.45), 0 24px 60px rgba(0,0,0,.5)` : '';
      put(card.querySelector('.tag'), { o: isPick ? prog(t, c.detected + 0.1, 0.2) : 0, s: isPick ? lerp(0.5, 1, ease.outBack(prog(t, c.detected + 0.1, 0.35), 3)) : 1 });
    });
    const sp = prog(t, c.scan, 0.7);
    put(els.arScan, { x: lerp(150, 1700, ease.inOutCubic(sp)) + exit.x, o: Math.sin(sp * Math.PI) });
    const cc = '…\\LLVM-MinGW\\bin\\aarch64-w64-mingw32-gcc.exe';
    const n = Math.floor(clamp((t - c.compiler - 0.15) / 0.65) * cc.length);
    els.arCcText.textContent = cc.slice(0, n);
    put(els.arCc, { o: prog(t, c.compiler, 0.25) * exit.o, x: exit.x, y: (1 - ease.outCubic(prog(t, c.compiler, 0.4))) * 30, blur: exit.blur });
  }

  // ---------------------------------------------------------------- 6. safe
  function renderSafe(t) {
    const c = C.safe;
    const S = C.S.safe;
    const exit = whip(t, S.start, S.end);
    const fp = prog(t, c.folder, 0.5);
    const shieldP = ease.outCubic(prog(t, c.shield - 0.05, 0.5));
    const split = ease.inOutCubic(prog(t, c.backup, 0.6));
    const wiggle = t > c.config && t < c.config + 0.5 ? Math.sin((t - c.config) * 40) * 4 * (1 - (t - c.config) / 0.5) : 0;
    const down = shieldP * 330;
    put(els.sfOrig, {
      x: -split * 330 + exit.x,
      y: (1 - ease.outBack(fp, 2)) * 60 + down,
      s: lerp(0.5, 1, ease.outBack(fp, 2)) * lerp(1, 0.78, shieldP),
      r: wiggle,
      o: clamp(fp * 3) * exit.o,
      blur: exit.blur,
    });
    // The old config flies into the backup folder; a fresh LazyVim starter rises in its place.
    els.sfPapers.forEach((paper, i) => {
      if (paper.classList.contains('fresh')) {
        const p = prog(t, c.backup + 0.5, 0.45);
        put(paper, { x: 20, y: lerp(100, -16, ease.outBack(p, 2)), r: -4, o: p > 0 ? 1 : 0 });
        return;
      }
      const p = prog(t, c.config + i * 0.08, 0.4);
      const fly = ease.inOutCubic(prog(t, c.backup + 0.05 + i * 0.06, 0.55));
      const arc = Math.sin(fly * Math.PI) * -160;
      put(paper, {
        x: i * 60 - 10 + fly * 660,
        y: lerp(90, -10 - i * 6, ease.outBack(p, 2)) + arc + fly * 8,
        r: (i - 1) * 9 + Math.sin(fly * Math.PI) * 25,
        o: p > 0 ? 1 : 0,
      });
    });
    put(els.sfCopy, {
      x: split * 330 + exit.x,
      y: down + split * -10,
      s: lerp(1, 0.78, shieldP),
      o: (split > 0 ? 1 : 0) * exit.o,
      blur: exit.blur,
    });
    put(els.sfLock, { s: ease.outBack(prog(t, c.backup + 0.45, 0.35), 3), o: prog(t, c.backup + 0.45, 0.1) });
    const rp = prog(t, c.relax - 0.05, 0.45);
    const rOut = prog(t, c.backup - 0.15, 0.3);
    put(els.sfRelax, { y: (1 - ease.outCubic(rp)) * -40 + Math.sin(t * 2) * 6, o: rp * (1 - rOut), x: exit.x });
    if (rp > 0 && rOut < 1) {
      logo.drawZzz(fxc, { x: 1250, y: 215, size: 40, t: t - c.relax, alpha: 1 - rOut, color: '#7dcfff' });
    }
    const sh = prog(t, c.shield, 0.45);
    put(els.sfShield, { s: lerp(2.2, 1, ease.outBack(sh, 1.6)), o: clamp(sh * 3) * exit.o, x: exit.x, blur: (1 - sh) * 10 + exit.blur, y: -40 });
  }

  // ---------------------------------------------------------------- 7. launch
  const LAZY_LINES = [
    ['bufferline.nvim', '6.42ms', 'VeryLazy'], ['flash.nvim', '2.43ms', 'VeryLazy'], ['lazy.nvim', '18.61ms', 'init.lua'],
    ['LazyVim', '6.6ms', 'start'], ['lualine.nvim', '28.87ms', 'VeryLazy'], ['mini.ai', '1.61ms', 'VeryLazy'],
    ['noice.nvim', '3.07ms', 'VeryLazy'], ['nvim-treesitter', '4.4ms', 'VeryLazy'], ['snacks.nvim', '2.39ms', 'start'],
    ['tokyonight.nvim', '1.14ms', 'LazyVim'], ['trouble.nvim', '3.95ms', 'lualine.nvim'], ['which-key.nvim', '1.67ms', 'VeryLazy'],
    ['blink.cmp', '0.92ms', 'InsertEnter'], ['gitsigns.nvim', '1.21ms', 'LazyFile'], ['mason.nvim', '2.08ms', 'VeryLazy'],
  ];
  const TREE = [
    ['dir', '▾ lua'], ['dir', '  ▾ config'], ['f', '      autocmds.lua'], ['f', '      keymaps.lua'], ['f', '      lazy.lua'],
    ['f', '      options.lua'], ['dir', '  ▾ plugins'], ['on', '      editor.lua'], ['f', '      ui.lua'], ['f', '  init.lua'],
    ['f', '  lazy-lock.json'], ['f', '  stylua.toml'],
  ];
  const CODE = [
    '<span class="com">-- Make LazyVim feel at home on Windows</span>',
    '<span class="kw">return</span> <span class="pun">{</span>',
    '  <span class="pun">{</span>',
    '    <span class="str">"nvim-treesitter/nvim-treesitter"</span>,',
    '    <span class="key">opts</span> = <span class="pun">{</span>',
    '      <span class="key">ensure_installed</span> = <span class="pun">{</span>',
    '        <span class="str">"lua"</span>,',
    '        <span class="str">"c_sharp"</span>,',
    '        %TYPING%',
    '      <span class="pun">}</span>,',
    '    <span class="pun">}</span>,',
    '  <span class="pun">}</span>,',
    '  <span class="pun">{</span> <span class="str">"folke/tokyonight.nvim"</span>, <span class="key">opts</span> = <span class="pun">{</span> <span class="key">style</span> = <span class="str">"moon"</span> <span class="pun">}</span> <span class="pun">}</span>,',
    '<span class="pun">}</span>',
  ];

  function setupLaunch() {
    els.lnTree.innerHTML = TREE.map(([k, s]) => `<div class="${k === 'dir' ? 'dir' : k === 'on' ? 'on' : ''}">${esc(s)}</div>`).join('');
    els.lnLzList.innerHTML = LAZY_LINES.map(([n, ms, ev]) => `<div><span class="dot">  ●</span> ${n} <span class="ms">${ms}</span> <span class="${ev === 'start' ? 'st' : 'ev'}">${ev === 'start' ? '▷' : '⚡'} ${ev}</span></div>`).join('');
  }

  function renderLaunch(t) {
    const c = C.launch;
    const S = C.S.launch;
    const frame = els.lnFrame;
    if (t < c.boom) {
      put(frame, { o: 0 });
      return;
    }
    const bp = prog(t, c.boom, 0.55);
    const ready = ease.inOutCubic(prog(t, c.ready - 0.05, 0.9));
    const exitP = ease.inCubic(prog(t, S.end - 0.35, 0.4));
    const pulse = beatPulse(t);
    put(frame, {
      s: lerp(1.25, 1, ease.outExpo(bp)) * lerp(1, 0.74, ready) * lerp(1, 0.6, exitP) * (1 + 0.006 * pulse),
      ry: ready * -9 + exitP * -20,
      rx: ready * 5,
      y: ready * -10 - exitP * 120,
      x: ready * 30,
      o: 1 - exitP,
      blur: exitP * 14,
    });
    frame.style.borderRadius = `${(ready * 22).toFixed(1)}px`;
    frame.style.overflow = 'hidden';
    frame.style.boxShadow = ready > 0 ? `0 ${(60 * ready).toFixed(0)}px 140px rgba(0,0,0,${(0.6 * ready).toFixed(2)}), 0 0 0 ${(2 * ready).toFixed(1)}px rgba(122,162,247,.35)` : '';

    // Dashboard
    const lazyP = ease.inOutCubic(prog(t, c.lazy, 0.4));
    const edP = ease.inOutCubic(prog(t, c.editor, 0.4));
    put(els.lnDash, { y: -lazyP * 1080, o: 1 });
    const lg = els.lnLogo.getContext('2d');
    lg.clearRect(0, 0, W, H);
    if (lazyP < 1) {
      const cw = 20;
      const ch = 40;
      const x = (W - dashLogo.cols * cw) / 2;
      const y = 160;
      dashLogo.draw(lg, {
        x, y, cw, ch,
        assemble: lerp(0.55, 1, ease.outCubic(prog(t, c.boom, 0.5))),
        ease: ease.outCubic,
        spread: 500,
        shadow: prog(t, c.boom + 0.1, 0.5),
        glow: 0.2 + 0.25 * pulse,
        top: '#9fb9ff',
        bottom: '#82aaff',
      });
      dashLogo.drawZzz(lg, { x: x + dashLogo.cols * cw + 14, y: y + 30, size: 26, t: t - c.boom - 0.3, color: '#82aaff' });
    }
    els.lnMenu.forEach((row, i) => {
      const p = prog(t, c.boom + 0.12 + i * 0.045, 0.3);
      put(row, { x: (1 - ease.outCubic(p)) * 60, o: p });
    });
    put(els.lnFoot, { o: prog(t, c.boom + 0.6, 0.3), y: (1 - ease.outCubic(prog(t, c.boom + 0.6, 0.4))) * 20 });

    // lazy.nvim plugin manager
    put(els.lnLazy, { y: (1 - lazyP) * 1080 - edP * 1080, o: lazyP > 0 ? 1 : 0 });
    els.lnLzRows.forEach((row, i) => {
      const p = prog(t, c.lazy + 0.15 + i * 0.045, 0.2);
      put(row, { o: p, x: (1 - p) * 30 });
    });

    // Editor with completion popping up while typing "powershell".
    put(els.lnEditor, { y: (1 - edP) * 1080, o: edP > 0 ? 1 : 0 });
    if (edP > 0) {
      const word = 'powershell';
      const typeStart = c.editor + 0.35;
      const n = Math.floor(clamp((t - typeStart) / 0.55) * 4);
      const accepted = t >= typeStart + 1.05;
      const typedWord = accepted ? word : word.slice(0, n);
      const insert = t < typeStart + 1.6;
      const typing = accepted ? `<span class="str">"${word}"</span>,` : `<span class="str">"${typedWord}</span>`;
      const curRow = 8;
      const rows = CODE.map((l, i) => {
        const content = l.replace('%TYPING%', i === curRow ? typing + (insert ? '<span class="cur-block"> </span>' : '') : '');
        return `<div class="row${i === curRow ? ' cur' : ''}"><span class="ln${i === curRow ? ' cur' : ''}">${i === curRow ? i + 1 : Math.abs(i - curRow)}</span>${content}</div>`;
      });
      setHtml(els.lnCode, rows.join(''));
      els.lnMode.textContent = insert ? 'INSERT' : 'NORMAL';
      els.lnMode.classList.toggle('insert', insert);
      els.lnPos.textContent = `9:${(10 + typedWord.length + (accepted ? 3 : 0)).toString()}`;
      const showCmp = t >= typeStart + 0.15 && !accepted;
      setHtml(els.lnCmp, showCmp ? [
        ['powershell', 'Text'], ['python', 'Text'], ['php', 'Text'], ['proto', 'Text'],
      ].filter(([w]) => w.startsWith(typedWord.slice(0, Math.max(1, n)))).map(([w, k], i) => `<div class="${i === 0 ? 'sel' : ''}"><i>abc</i>${w}<em>${k}</em></div>`).join('') : '');
      put(els.lnCmp, { x: 360 + 86 + 9 * 15.6 + 6, y: 52 + 18 + 9 * 40.3 + 4, o: showCmp ? 1 : 0, s: showCmp ? lerp(0.9, 1, ease.outCubic(prog(t, typeStart + 0.15, 0.15))) : 1 });
    }
  }

  // ---------------------------------------------------------------- 8. cta
  function renderCta(t) {
    const c = C.cta;
    const S = C.S.cta;
    const pulse = beatPulse(t);
    const hit = Math.exp(-Math.max(0, t - c.finalHit) * 6) * (t >= c.finalHit ? 1 : 0);
    if (t >= S.start - 0.3) {
      const cw = 24;
      const ch = 48;
      const box = logoBox(cw, ch, 330);
      const assemble = prog(t, c.logo - 0.1, c.logoLand - c.logo + 0.25);
      const s = 1 + 0.02 * pulse + 0.06 * hit;
      fxc.save();
      fxc.translate(W / 2, box.y + box.h / 2);
      fxc.scale(s, s);
      fxc.translate(-W / 2, -(box.y + box.h / 2));
      logo.draw(fxc, {
        ...box, cw, ch,
        assemble,
        ease: (p) => ease.outBack(p, 1.2),
        spread: 900,
        shadow: prog(t, c.logoLand - 0.1, 0.5),
        glow: 0.3 + 0.4 * pulse + 0.8 * hit,
      });
      logo.drawZzz(fxc, { x: box.x + box.w + 16, y: box.y + 36, size: 32, t: t - c.subtitle });
      fxc.restore();
      shockwave(t, c.finalHit, W / 2, box.y + box.h / 2, '#9ece6a', 1300);
      burst(t, c.finalHit, W / 2, box.y + box.h / 2);
    }

    const sp = prog(t, c.subtitle, 0.5);
    put(els.ctSub, { y: (1 - ease.outCubic(sp)) * 50, o: sp });
    const lp = prog(t, c.less, 0.4);
    const mp = prog(t, c.more, 0.4);
    put(els.ctLess, { y: (1 - ease.outBack(lp, 2)) * 60, o: clamp(lp * 3), s: lerp(0.8, 1, ease.outBack(lp, 2)) });
    put(els.ctMore, { y: (1 - ease.outBack(mp, 2)) * 60, o: clamp(mp * 3), s: lerp(0.8, 1, ease.outBack(mp, 2)) * (1 + 0.04 * hit) });
    const gp = prog(t, c.github, 0.45);
    const cp = prog(t, c.command, 0.45);
    put(els.ctGh, { s: lerp(0.5, 1, ease.outBack(gp, 2.2)) * (1 + 0.03 * hit), o: clamp(gp * 3), y: (1 - gp) * 40 });
    put(els.ctCmd, { s: lerp(0.5, 1, ease.outBack(cp, 2.2)) * (1 + 0.03 * hit), o: clamp(cp * 3), y: (1 - cp) * 40 });
  }

  // ---------------------------------------------------------------- global camera
  function renderCamera(t) {
    const E = C.E;
    const impulses = [
      [E.drop, 24], [E.boom, 28], [C.hook.notIn + 0.12, 12], [C.safe.shield + 0.1, 8], [E.finalHit, 14],
      [C.struggle.compiler + 0.05, 5], [C.struggle.tabs47, 6],
    ];
    let x = 0;
    let y = 0;
    let r = 0;
    for (const [t0, a] of impulses) {
      const d = t - t0;
      if (d < 0 || d > 0.7) continue;
      const k = a * Math.exp(-d * 8);
      x += k * Math.sin(d * 87);
      y += k * Math.cos(d * 73);
      r += k * 0.018 * Math.sin(d * 61);
    }
    els.world.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${r.toFixed(3)}deg)`;

    let flash = 0;
    for (const [t0, a] of [[E.drop, 0.85], [E.boom, 1], [E.finalHit, 0.45], [C.hook.notIn + 0.1, 0.25]]) {
      const d = t - t0;
      if (d >= 0 && d < 0.6) flash = Math.max(flash, a * Math.exp(-d * 9));
    }
    els.flash.style.opacity = flash.toFixed(3);
    const fadeIn = 1 - prog(t, 0, 0.25);
    const fadeOut = prog(t, C.cta.fadeOut, E.end - C.cta.fadeOut);
    els.fade.style.opacity = Math.max(fadeIn, fadeOut).toFixed(3);
  }

  // ---------------------------------------------------------------- engine
  const SCENES = [
    ['struggle', renderStruggle, 0, 0.5],
    ['hook', renderHook, 0.6, 0.5],
    ['command', renderCommand, 0.5, 0.5],
    ['winget', renderWinget, 0.5, 0.6],
    ['arch', renderArch, 0.5, 0.5],
    ['safe', renderSafe, 0.5, 0.5],
    ['launch', renderLaunch, 0.5, 0.5],
    ['cta', renderCta, 0.5, 2],
  ];

  async function init(timeline) {
    TL = timeline;
    C = window.buildCues(TL);
    const ids = {
      world: 'world', blob1: 'blob1', blob2: 'blob2', blob3: 'blob3', floor: 'floor', flash: 'flash', fade: 'fade',
      sStruggle: 's-struggle', stTerm: 'st-term', stBody: 'st-body', stCompiler: 'st-compiler', stPath: 'st-path',
      stBrowser: 'st-browser', stTabs: 'st-tabs', stCount: 'st-count', stCal: 'st-cal', stSat: 'st-sat', stSun: 'st-sun',
      hkNot: 'hk-not', hkSub: 'hk-sub',
      term: 'term', termBody: 'term-body', cmK1: 'cm-k1', cmK2: 'cm-k2', cmK3: 'cm-k3', cmEnter: 'cm-enter',
      wgBadge: 'wg-badge', arKicker: 'ar-kicker', arScan: 'ar-scan', arCc: 'ar-cc', arCcText: 'ar-cctext',
      sfOrig: 'sf-orig', sfCopy: 'sf-copy', sfRelax: 'sf-relax', sfShield: 'sf-shield',
      lnFrame: 'ln-frame', lnDash: 'ln-dash', lnLogo: 'ln-logo', lnFoot: 'ln-foot', lnLazy: 'ln-lazy', lnLzList: 'ln-lzlist',
      lnEditor: 'ln-editor', lnTree: 'ln-tree', lnCode: 'ln-code', lnMode: 'ln-mode', lnPos: 'ln-pos', lnCmp: 'ln-cmp',
      ctSub: 'ct-sub', ctLess: 'ct-less', ctMore: 'ct-more', ctGh: 'ct-gh', ctCmd: 'ct-cmd',
    };
    for (const [k, id] of Object.entries(ids)) {
      els[k] = $(id);
      if (!els[k]) throw new Error(`Missing #${id}`);
    }
    els.stPathRows = [...document.querySelectorAll('#st-pathlist div')];
    els.wgChips = [...document.querySelectorAll('#wg-chips .chip')];
    els.arCards = [0, 1, 2].map((i) => $(`ar-c${i}`));
    els.sfPapers = [...document.querySelectorAll('#sf-papers span')];
    els.sfLock = document.querySelector('#sf-copy .lockbadge');
    els.lnMenu = [...document.querySelectorAll('#ln-menu div')];
    els.scenes = Object.fromEntries(SCENES.map(([id]) => [id, $(`s-${id}`)]));
    fxc = $('fx').getContext('2d');
    pc = $('particles').getContext('2d');
    logo = new window.BlockLogo(11);
    dashLogo = new window.BlockLogo(23);
    setupParticles();
    setupLaunch();
    els.lnLzRows = [...document.querySelectorAll('#ln-lzlist div')];
    seek(0);
  }

  function seek(t) {
    fxc.clearRect(0, 0, W, H);
    renderBackground(t);
    for (const [id, render, pre, post] of SCENES) {
      const s = C.S[id];
      const on = t >= s.start - pre && t < s.end + post;
      show(els.scenes[id], on);
      if (on) render(t);
    }
    renderTerminal(t);
    renderCamera(t);
  }

  window.TRAILER = { init, seek, get duration() { return TL.duration; }, get fps() { return TL.fps; } };

  // Preview mode: play in real time with the mixed soundtrack.
  const params = new URLSearchParams(location.search);
  if (params.has('render')) {
    const k = Number(params.get('scale') ?? 1);
    Object.assign($('viewport').style, { display: 'block', placeItems: 'normal' });
    Object.assign($('stage').style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', transform: k === 1 ? '' : `scale(${k})` });
  } else {
    const fit = () => {
      const k = Math.min(innerWidth / 1920, innerHeight / 1080);
      Object.assign($('viewport').style, { display: 'block', position: 'relative' });
      Object.assign($('stage').style, { position: 'absolute', left: '50%', top: '50%', transformOrigin: '50% 50%', transform: `translate(-50%, -50%) scale(${k})` });
    };
    addEventListener('resize', fit);
    fit();
    (async () => {
      const tl = await (await fetch('../build/timeline.json', { cache: 'no-store' })).json();
      await document.fonts.ready;
      await init(tl);
      const audio = new Audio('../build/soundtrack.wav');
      const start = Number(params.get('t') ?? 0);
      let playing = false;
      const loop = () => {
        seek(playing ? audio.currentTime : start);
        requestAnimationFrame(loop);
      };
      loop();
      addEventListener('click', () => {
        audio.currentTime = start;
        audio.play().then(() => { playing = true; }).catch(() => {});
      });
    })();
  }
})();
