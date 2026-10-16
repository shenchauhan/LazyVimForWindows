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
    inOutCubic: (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
    outBack: (p, s = 1.70158) => 1 + (s + 1) * (p - 1) ** 3 + s * (p - 1) ** 2,
  };
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

  /** Gentle scene transition: drifts in from the right and out to the left with a soft blur. */
  function drift(t, start, end, { inDur = 0.6, outDur = 0.5, dist = 110 } = {}) {
    const pin = ease.inOutCubic(prog(t, start - 0.1, inDur));
    const pout = ease.inOutCubic(prog(t, end - outDur * 0.8, outDur));
    return {
      x: (1 - pin) * dist - pout * dist,
      o: pin * (1 - pout),
      blur: (1 - pin) * 6 + pout * 6,
    };
  }

  let TL;
  let C;
  let fxc;
  let pc;
  let logo;
  let dashLogo;
  let particles;
  const els = {};

  // ---------------------------------------------------------------- background
  function setupParticles() {
    const r = mulberry32(99);
    particles = Array.from({ length: 120 }, () => ({
      x: r() * (W + 120),
      y: r() * (H + 120),
      z: 0.3 + r() * 0.7,
      size: 0.8 + r() * 2.4,
      phase: r() * Math.PI * 2,
      hue: ['#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5', '#9ece6a'][Math.floor(r() * 5)],
    }));
  }

  function beatPulse(t, decay = 5) {
    const sec = C.section(t);
    if (!sec.kick) return 0;
    const b = (t - C.gridOrigin(t)) / C.beat;
    if (b < 0) return 0;
    return Math.exp(-(b - Math.floor(b)) * decay) * sec.energy;
  }

  function sceneMood(t) {
    const E = C.E;
    // bright: 0 = dark, 1 = the full LazyVim look. The struggle is warm-tinted and dims as it sours.
    if (t < E.introEnd) return { bright: 0.4 - 0.25 * prog(t, C.struggle.gloom, 1.2), warm: 1, floor: 0 };
    if (t < E.title - 0.4) return { bright: 0.35 * ease.inOutCubic(prog(t, C.hook.lineIn, 1.6)), warm: 0, floor: 0 };
    const p = ease.inOutCubic(prog(t, E.title - 0.4, 1.4));
    return { bright: lerp(0.35, 1, p), warm: 0, floor: p };
  }

  function renderBackground(t) {
    const mood = sceneMood(t);
    const pulse = beatPulse(t);
    const hue = mood.warm ? 'hue-rotate(125deg) saturate(.8)' : '';
    const fadeOut = t < C.E.introEnd ? 1 - ease.inOutCubic(prog(t, C.struggle.fadeStart, C.struggle.fadeEnd - C.struggle.fadeStart)) : 1;
    const base = mood.bright * fadeOut;
    put(els.blob1, { x: 120 + 320 * Math.sin(t * 0.17), y: -420 + 200 * Math.cos(t * 0.13), o: base * (0.85 + 0.15 * pulse), filter: hue });
    put(els.blob2, { x: 820 + 260 * Math.cos(t * 0.15), y: -120 + 200 * Math.sin(t * 0.19), o: base * (0.82 + 0.18 * pulse), filter: hue });
    put(els.blob3, { x: 260 + 420 * Math.sin(t * 0.11 + 2), y: 180 + 220 * Math.cos(t * 0.21), o: base * 0.8, filter: hue });
    els.floor.style.opacity = (mood.floor * (0.15 + 0.05 * pulse)).toFixed(3);
    els.floor.style.backgroundPosition = `0 ${((t * 55) % 120).toFixed(1)}px`;

    pc.clearRect(0, 0, W, H);
    // Integrate the drift speed so particles never jump when it changes.
    const E = C.E;
    const travel = t < E.title ? 14 * t : 14 * E.title + 30 * (t - E.title);
    for (const p of particles) {
      const y = (((p.y - travel * p.z) % (H + 120)) + H + 120) % (H + 120) - 60;
      const x = p.x + Math.sin(t * 0.5 + p.phase) * 18 * p.z - 60;
      const tw = 0.6 + 0.4 * Math.sin(t * 2 + p.phase);
      pc.globalAlpha = clamp(base * tw * p.z * (0.55 + pulse * 0.3));
      pc.fillStyle = mood.warm ? '#b9a7a7' : p.hue;
      pc.beginPath();
      pc.arc(x, y, p.size * p.z * (1 + pulse * 0.15), 0, Math.PI * 2);
      pc.fill();
    }
    pc.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- fx helpers (canvas)
  /** A soft radial glow that swells and fades, marking an arrival without any impact. */
  function bloom(t, t0, cx, cy, { color = '125,207,255', radius = 760, peak = 0.3, dur = 1.8 } = {}) {
    const p = prog(t, t0 - 0.2, dur);
    if (p <= 0 || p >= 1) return;
    const a = peak * Math.sin(p * Math.PI) ** 2;
    const g = fxc.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, `rgba(${color},${a.toFixed(3)})`);
    g.addColorStop(1, `rgba(${color},0)`);
    fxc.save();
    fxc.globalCompositeOperation = 'lighter';
    fxc.fillStyle = g;
    fxc.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
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
    // The whole mess sinks, blurs, and fades away as the weekend disappears.
    const fade = ease.inOutCubic(prog(t, c.fadeStart, c.fadeEnd - c.fadeStart));
    const gloom = ease.inOutCubic(prog(t, c.gloom, 1.1));
    put(scene, {
      s: lerp(1, 0.94, fade),
      y: fade * 40,
      o: 1 - fade,
      blur: fade * 10,
      filter: `grayscale(${(gloom * 0.85).toFixed(2)}) brightness(${(1 - gloom * 0.25).toFixed(2)})`,
    });
    const sag = ease.inOutCubic(prog(t, c.gloom + 0.4, 1.4));

    // Terminal: type `nvim`, get an error.
    const termIn = ease.outCubic(prog(t, c.termIn, 0.6));
    const kick = (t0) => (t > t0 && t < t0 + 0.4 ? Math.sin((t - t0) * 45) * 4 * (1 - (t - t0) / 0.4) : 0);
    put(els.stTerm, {
      y: (1 - termIn) * 50 + sag * 30 + kick(c.compiler) * 0.5,
      x: kick(c.path) * 0.6,
      s: lerp(0.96, 1, termIn),
      r: sag * 2.5,
      o: termIn,
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
    const tp = prog(t, c.compiler, 0.5);
    put(els.stCompiler, {
      x: (1 - ease.outBack(tp, 1.1)) * 700 + kick(c.compiler) * 0.8,
      y: sag * 60,
      r: sag * -7,
      o: tp > 0 ? 1 : 0,
    });

    // PATH dialog pops, with the selection flailing around.
    const dp = prog(t, c.path, 0.45);
    put(els.stPath, {
      s: lerp(0.85, 1, ease.outBack(dp, 1.3)),
      y: sag * 80,
      r: sag * 6 - (1 - dp) * 4,
      o: dp > 0 ? clamp(dp * 3) : 0,
    });
    const rows = els.stPathRows;
    const sel = t < c.path ? 2 : Math.floor((t - c.path) / 0.2) % rows.length;
    rows.forEach((row, i) => row.classList.toggle('sel', i === sel));

    // Browser tabs multiply to 47.
    const bp = prog(t, c.browserIn, 0.5);
    put(els.stBrowser, { y: (1 - ease.outCubic(bp)) * 480 + sag * 40, r: sag * -3, o: bp > 0 ? 1 : 0 });
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
    const cp = prog(t, c.tabs47 - 0.02, 0.5);
    els.stCount.textContent = String(n);
    put(els.stCount, { s: t < c.tabsFrom ? 0 : lerp(0.6, 1, ease.outBack(cp, 1.6)), o: t < c.tabsFrom ? 0 : 1 });

    // Calendar: the weekend pages drop away.
    const cal = prog(t, c.calendarIn, 0.7);
    put(els.stCal, { y: (1 - ease.outBack(cal, 1.05)) * -700, r: (1 - cal) * -6, o: cal > 0 ? 1 : 0 });
    for (const [el, t0] of [[els.stSat, c.sat], [els.stSun, c.sun]]) {
      const p = prog(t, t0, 1.1);
      put(el, {
        rx: -ease.outCubic(clamp(p * 2)) * 70,
        y: ease.inCubic(p) * 800,
        x: ease.inCubic(p) * (el === els.stSat ? -200 : 200),
        r: ease.inCubic(p) * (el === els.stSat ? -25 : 25),
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
    // "There's an easier way." fades up softly, then gives way to the wordmark.
    const inP = ease.outCubic(prog(t, c.lineIn, 0.8));
    const outP = ease.inOutCubic(prog(t, c.lineOut, 0.5));
    put(els.hkNot, {
      y: (1 - inP) * 24 - outP * 16,
      s: 1 + outP * 0.03,
      o: inP * (1 - outP),
      blur: (1 - inP) * 8 + outP * 6,
    });

    // The wordmark's blocks rise into place as the narrator says "LazyVim".
    if (t >= c.gather - 0.05 && t < c.out + 0.6) {
      const box = logoBox(LOGO.cw, LOGO.ch, 430);
      const exit = ease.inOutCubic(prog(t, c.out - 0.45, 0.55));
      const pulse = beatPulse(t);
      const assemble = prog(t, c.gather, c.assembled - c.gather);
      const float = Math.sin((t - c.title) * 1.2) * 4;
      const scale = (1 + 0.008 * pulse) * (1 - exit * 0.05);
      fxc.save();
      fxc.translate(W / 2 - exit * 110, box.y + box.h / 2 + float);
      fxc.scale(scale, scale);
      fxc.translate(-W / 2, -(box.y + box.h / 2));
      logo.draw(fxc, {
        ...box, ...LOGO,
        assemble,
        ease: ease.outCubic,
        from: 'below',
        spread: 70,
        turbulence: 0.05,
        shadow: prog(t, c.title, 0.9),
        glow: t >= c.title ? 0.22 + 0.12 * pulse + 0.2 * (1 - prog(t, c.title, 1.4)) : 0.1 * assemble,
        alpha: 1 - exit,
        blur: exit * 6,
      });
      logo.drawZzz(fxc, { x: box.x + box.w + 18, y: box.y + 40, size: 34, t: t - c.zzz, alpha: (t >= c.zzz ? 1 : 0) * (1 - exit) });
      fxc.restore();
      bloom(t, c.title, W / 2, box.y + box.h / 2, { peak: 0.22 });
    }
    const sp = prog(t, c.subtitle, 0.7);
    const exit = drift(t, -10, c.out);
    put(els.hkSub, { y: (1 - ease.outCubic(sp)) * 30, o: ease.outCubic(sp) * exit.o, x: exit.x, blur: exit.blur + (1 - sp) * 6 });
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
      const p = ease.outCubic(prog(t, cm.termIn, 0.7));
      extra = { y: (1 - p) * 90, s: lerp(0.96, 1, p) };
      o = p;
    } else if (t < S.launch.start - 0.4) {
      const p = ease.inOutCubic(prog(t, S.winget.start - 0.15, 0.8));
      const a = layouts.command;
      const b = layouts.winget;
      L = { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), w: lerp(a.w, b.w, p), h: lerp(a.h, b.h, p), f: lerp(a.f, b.f, p) };
      const exit = drift(t, -10, S.winget.end, { dist: -130 });
      extra = { x: -exit.x, blur: exit.blur };
      o = exit.o;
    } else {
      L = layouts.launch;
      const ln = C.launch;
      const p = ease.outCubic(prog(t, ln.termIn, 0.7));
      // Ease gently toward the screen while Neovim starts, then dissolve into the dashboard.
      const push = ease.inOutCubic(prog(t, ln.enter, ln.reveal - ln.enter));
      extra = { y: (1 - p) * 80, s: lerp(0.96, 1, p) * (1 + push * 0.08), blur: prog(t, ln.reveal - 0.2, 0.5) * 6 };
      o = p * (1 - ease.inOutCubic(prog(t, ln.reveal - 0.2, 0.5)));
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
    const exit = drift(t, -10, S.end, { dist: -120 });
    const kin = [[els.cmK1, c.k1, c.k2], [els.cmK2, c.k2, c.k3], [els.cmK3, c.k3, Infinity]];
    for (const [el, t0, next] of kin) {
      const p = ease.outCubic(prog(t, t0, 0.55));
      const dim = t >= next ? 0.45 : 1;
      put(el, {
        x: exit.x * -1,
        y: (1 - p) * 36,
        s: lerp(0.97, 1, p),
        o: p * dim * exit.o,
        blur: exit.blur + (1 - p) * 4,
      });
    }
    const kp = prog(t, c.enter - 0.45, 0.4);
    const press = t >= c.enter && t < c.enter + 0.16 ? 1 : 0;
    put(els.cmEnter, {
      s: lerp(0.85, 1, ease.outBack(kp, 1.3)) * (press ? 0.96 : 1),
      y: press * 8 + ease.inOutCubic(prog(t, c.enter + 0.7, 0.5)) * 50,
      o: clamp(kp * 3) * (1 - prog(t, c.enter + 0.7, 0.5)),
    });
    els.cmEnter.style.boxShadow = press ? '0 4px 0 #10111a, 0 12px 26px rgba(0,0,0,.55)' : '';
  }

  // ---------------------------------------------------------------- 4. winget
  const CHIP_POS = {
    neovim: [0, 0], git: [410, 0], compiler: [0, 150], treesitter: [410, 150],
    fd: [0, 300], fzf: [410, 300], ripgrep: [205, 450],
  };

  function renderWinget(t) {
    const c = C.winget;
    const S = C.S.winget;
    const exit = drift(t, -10, S.end, { dist: 130 });
    const bp = ease.outCubic(prog(t, c.badge, 0.6));
    put(els.wgBadge, { s: lerp(0.94, 1, bp), y: (1 - bp) * 16, o: bp * exit.o, x: -exit.x, blur: exit.blur });
    els.wgChips.forEach((chip, i) => {
      const k = chip.dataset.k;
      const t0 = c.chips[k];
      const p = prog(t, t0, 0.55);
      const [x, y] = CHIP_POS[k];
      const bob = Math.sin(t * 1.6 + i) * 2 * p;
      const glow = prog(t, c.allDone + i * 0.09, 0.4) * (1 - prog(t, c.done + 0.4, 1));
      put(chip, {
        x: x - exit.x,
        y: y + (1 - ease.outCubic(p)) * 24 + bob,
        s: lerp(0.88, 1, ease.outBack(p, 1.2)) * (1 + 0.02 * glow),
        r: (1 - p) * -3,
        o: clamp(p * 2.5) * exit.o,
        blur: exit.blur,
      });
      const cp = prog(t, c.allDone + i * 0.09, 0.45);
      put(chip.querySelector('.check'), { s: lerp(0.4, 1, ease.outBack(cp, 1.6)), o: clamp(cp * 3) });
    });
  }

  // ---------------------------------------------------------------- 5. arch
  function renderArch(t) {
    const c = C.arch;
    const S = C.S.arch;
    const exit = drift(t, S.start, S.end);
    put(els.arKicker, { o: prog(t, S.start + 0.05, 0.6) * exit.o, x: exit.x, y: (1 - ease.outCubic(prog(t, S.start, 0.7))) * -20, blur: exit.blur });
    const detected = t >= c.detected;
    els.arCards.forEach((card, i) => {
      const p = ease.outCubic(prog(t, c.cards[i] - 0.05, 0.65));
      const isPick = i === 2;
      const dp = ease.inOutCubic(prog(t, c.detected, 0.6));
      const s = isPick ? 1 + 0.04 * dp : 1 - 0.04 * dp;
      put(card, {
        ry: (1 - p) * 30,
        y: (1 - p) * 40,
        s,
        x: exit.x,
        o: p * exit.o * (detected && !isPick ? lerp(1, 0.45, dp) : 1),
        blur: exit.blur,
      });
      card.style.borderColor = detected && isPick ? '#9ece6a' : '';
      card.style.boxShadow = detected && isPick ? `0 0 ${(50 + 14 * beatPulse(t)).toFixed(0)}px rgba(158,206,106,${(0.35 * dp).toFixed(2)}), 0 24px 60px rgba(0,0,0,.5)` : '';
      put(card.querySelector('.tag'), { o: isPick ? prog(t, c.detected + 0.1, 0.35) : 0, s: isPick ? lerp(0.85, 1, ease.outBack(prog(t, c.detected + 0.1, 0.45), 1.5)) : 1 });
    });
    const sp = prog(t, c.scan, 0.9);
    put(els.arScan, { x: lerp(150, 1700, ease.inOutCubic(sp)) + exit.x, o: 0.8 * Math.sin(sp * Math.PI) });
    const cc = '…\\LLVM-MinGW\\bin\\aarch64-w64-mingw32-gcc.exe';
    const n = Math.floor(clamp((t - c.compiler - 0.15) / 0.8) * cc.length);
    els.arCcText.textContent = cc.slice(0, n);
    put(els.arCc, { o: prog(t, c.compiler, 0.35) * exit.o, x: exit.x, y: (1 - ease.outCubic(prog(t, c.compiler, 0.5))) * 20, blur: exit.blur });
  }

  // ---------------------------------------------------------------- 6. safe
  function renderSafe(t) {
    const c = C.safe;
    const S = C.S.safe;
    const exit = drift(t, S.start, S.end);
    const fp = ease.outCubic(prog(t, c.folder, 0.6));
    const shieldP = ease.inOutCubic(prog(t, c.shield - 0.1, 0.7));
    const split = ease.inOutCubic(prog(t, c.backup, 0.8));
    const wiggle = t > c.config && t < c.config + 0.6 ? Math.sin((t - c.config) * 28) * 2 * (1 - (t - c.config) / 0.6) : 0;
    const down = shieldP * 330;
    put(els.sfOrig, {
      x: -split * 330 + exit.x,
      y: (1 - fp) * 40 + down,
      s: lerp(0.94, 1, fp) * lerp(1, 0.78, shieldP),
      r: wiggle,
      o: fp * exit.o,
      blur: exit.blur,
    });
    // The old config floats into the backup folder; a fresh LazyVim starter rises in its place.
    els.sfPapers.forEach((paper, i) => {
      if (paper.classList.contains('fresh')) {
        const p = prog(t, c.backup + 0.6, 0.6);
        put(paper, { x: 20, y: lerp(100, -16, ease.outBack(p, 1.2)), r: -4, o: p > 0 ? 1 : 0 });
        return;
      }
      const p = prog(t, c.config + i * 0.1, 0.5);
      const fly = ease.inOutCubic(prog(t, c.backup + 0.05 + i * 0.08, 0.75));
      const arc = Math.sin(fly * Math.PI) * -130;
      put(paper, {
        x: i * 60 - 10 + fly * 660,
        y: lerp(90, -10 - i * 6, ease.outBack(p, 1.3)) + arc + fly * 8,
        r: (i - 1) * 9 + Math.sin(fly * Math.PI) * 14,
        o: p > 0 ? 1 : 0,
      });
    });
    put(els.sfCopy, {
      x: split * 330 + exit.x,
      y: down + split * -10,
      s: lerp(1, 0.78, shieldP),
      o: split * exit.o,
      blur: exit.blur,
    });
    put(els.sfLock, { s: lerp(0.6, 1, ease.outBack(prog(t, c.backup + 0.55, 0.45), 1.6)), o: prog(t, c.backup + 0.55, 0.2) });
    const rp = prog(t, c.relax - 0.05, 0.6);
    const rOut = prog(t, c.backup - 0.15, 0.45);
    put(els.sfRelax, { y: (1 - ease.outCubic(rp)) * -24 + Math.sin(t * 1.5) * 4, o: rp * (1 - rOut), x: exit.x });
    if (rp > 0 && rOut < 1) {
      logo.drawZzz(fxc, { x: 1250, y: 215, size: 40, t: t - c.relax, alpha: 1 - rOut, color: '#7dcfff' });
    }
    const sh = ease.outCubic(prog(t, c.shield, 0.7));
    put(els.sfShield, { s: lerp(1.08, 1, sh), o: sh * exit.o, x: exit.x, blur: (1 - sh) * 6 + exit.blur, y: -40 + (1 - sh) * 16 });
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
    if (t < c.reveal - 0.15) {
      put(frame, { o: 0 });
      return;
    }
    const bp = ease.inOutCubic(prog(t, c.reveal - 0.15, 0.9));
    const ready = ease.inOutCubic(prog(t, c.ready - 0.05, 1.1));
    const exitP = ease.inOutCubic(prog(t, S.end - 0.5, 0.6));
    const pulse = beatPulse(t);
    put(frame, {
      s: lerp(1.04, 1, bp) * lerp(1, 0.74, ready) * lerp(1, 0.86, exitP) * (1 + 0.003 * pulse),
      ry: ready * -9 - exitP * 8,
      rx: ready * 5,
      y: ready * -10 - exitP * 50,
      x: ready * 30,
      o: bp * (1 - exitP),
      blur: (1 - bp) * 6 + exitP * 8,
    });
    frame.style.borderRadius = `${(ready * 22).toFixed(1)}px`;
    frame.style.overflow = 'hidden';
    frame.style.boxShadow = ready > 0 ? `0 ${(60 * ready).toFixed(0)}px 140px rgba(0,0,0,${(0.6 * ready).toFixed(2)}), 0 0 0 ${(2 * ready).toFixed(1)}px rgba(122,162,247,.35)` : '';

    // Dashboard
    const lazyP = ease.inOutCubic(prog(t, c.lazy, 0.55));
    const edP = ease.inOutCubic(prog(t, c.editor, 0.55));
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
        assemble: lerp(0.6, 1, ease.inOutCubic(prog(t, c.reveal - 0.15, 1.1))),
        ease: ease.outCubic,
        from: 'below',
        spread: 50,
        turbulence: 0.05,
        shadow: prog(t, c.reveal + 0.3, 0.8),
        glow: 0.18 + 0.1 * pulse,
        top: '#9fb9ff',
        bottom: '#82aaff',
      });
      dashLogo.drawZzz(lg, { x: x + dashLogo.cols * cw + 14, y: y + 30, size: 26, t: t - c.reveal - 0.5, color: '#82aaff' });
    }
    els.lnMenu.forEach((row, i) => {
      const p = ease.outCubic(prog(t, c.reveal + 0.25 + i * 0.06, 0.45));
      put(row, { x: (1 - p) * 30, o: p });
    });
    put(els.lnFoot, { o: prog(t, c.reveal + 0.9, 0.5), y: (1 - ease.outCubic(prog(t, c.reveal + 0.9, 0.6))) * 12 });

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
    // A slow, soft swell of light on the closing chord instead of a hit.
    const swell = t >= c.finalChord ? Math.sin(clamp((t - c.finalChord) / 2.2) * Math.PI) : 0;
    if (t >= S.start - 0.3) {
      const cw = 24;
      const ch = 48;
      const box = logoBox(cw, ch, 330);
      const assemble = prog(t, c.logo - 0.2, c.logoLand - c.logo + 0.6);
      const s = 1 + 0.006 * pulse + 0.012 * swell;
      fxc.save();
      fxc.translate(W / 2, box.y + box.h / 2);
      fxc.scale(s, s);
      fxc.translate(-W / 2, -(box.y + box.h / 2));
      logo.draw(fxc, {
        ...box, cw, ch,
        assemble,
        ease: ease.outCubic,
        from: 'below',
        spread: 70,
        turbulence: 0.05,
        shadow: prog(t, c.logoLand, 0.9),
        glow: 0.22 + 0.12 * pulse + 0.25 * swell,
      });
      logo.drawZzz(fxc, { x: box.x + box.w + 16, y: box.y + 36, size: 32, t: t - c.subtitle });
      fxc.restore();
      bloom(t, c.finalChord, W / 2, box.y + box.h / 2, { color: '158,206,106', peak: 0.18, dur: 2.6, radius: 900 });
    }

    const rise = (t0, dist = 30) => {
      const p = ease.outCubic(prog(t, t0, 0.7));
      return { y: (1 - p) * dist, o: p, blur: (1 - p) * 5 };
    };
    put(els.ctSub, rise(c.subtitle, 30));
    put(els.ctLess, rise(c.less, 24));
    put(els.ctMore, rise(c.more, 24));
    put(els.ctGh, { ...rise(c.github, 24), s: 1 + 0.01 * swell });
    put(els.ctCmd, { ...rise(c.command, 24), s: 1 + 0.01 * swell });
  }

  // ---------------------------------------------------------------- fades
  function renderFades(t) {
    const fadeIn = 1 - ease.inOutCubic(prog(t, 0, 0.7));
    const fadeOut = ease.inOutCubic(prog(t, C.cta.fadeOut, C.E.end - C.cta.fadeOut));
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
      blob1: 'blob1', blob2: 'blob2', blob3: 'blob3', floor: 'floor', fade: 'fade',
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
    renderFades(t);
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
