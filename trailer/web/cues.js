// Shared cue sheet: turns the narration timeline into the moments that visuals, sound effects,
// and music all key off, so everything stays in sync when the voiceover changes.
(function (global) {
  'use strict';

  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

  function buildCues(tl) {
    const S = Object.fromEntries(tl.scenes.map((s) => [s.id, s]));
    const E = tl.events;
    const line = (id) => {
      const l = tl.lines.find((x) => x.id === id);
      if (!l) throw new Error(`Timeline has no line '${id}'.`);
      return l;
    };
    const findWord = (id, prefix, nth = 0) => {
      const l = line(id);
      const hits = l.words.filter((w) => norm(w.text).startsWith(norm(prefix)));
      if (!hits.length) throw new Error(`Line '${id}' has no word starting with '${prefix}'.`);
      return hits[Math.min(nth, hits.length - 1)];
    };
    const word = (id, prefix, nth) => findWord(id, prefix, nth).start;
    const wordEnd = (id, prefix, nth) => findWord(id, prefix, nth).end;

    const c = { S, E, beat: tl.beat, duration: tl.duration };

    const typeTimes = (start, text, cps, jitter = 0.35, seed = 1) => {
      let s = seed;
      const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      const times = [];
      let t = start;
      for (let i = 0; i < text.length; i++) {
        times.push(t);
        t += (1 / cps) * (1 - jitter / 2 + rand() * jitter);
      }
      return times;
    };

    // 1. The struggle
    c.struggle = {
      termIn: 0.1,
      cmd: 'nvim',
      keys: typeTimes(0.3, 'nvim', 11, 0.3, 7),
      enter: 0.78,
      error: 0.84,
      compiler: word('struggle-2', 'compil') - 0.06,
      path: word('struggle-2', 'path') - 0.06,
      browserIn: wordEnd('struggle-2', 'variables') - 0.2,
      tabsFrom: wordEnd('struggle-2', 'variables') - 0.05,
      tabs47: word('struggle-2', '47'),
      calendarIn: line('struggle-3').start - 0.15,
      sat: word('struggle-3', 'weekend'),
      sun: word('struggle-3', 'weekend') + 0.22,
      gloom: word('struggle-3', 'goes'),
      crtStart: E.tapeStop - 0.42,
      crtEnd: E.tapeStop,
    };

    // 2. The hook
    c.hook = {
      notIn: word('hook-1', 'not') - 0.05,
      notOut: word('hook-2', 'meet') - 0.2,
      gather: word('hook-1', 'anymore') + 0.35,
      drop: E.drop,
      subtitle: word('hook-2', 'for') - 0.05,
      zzz: word('hook-2', 'windows'),
      out: S.hook.end,
    };

    // 3. One command
    const command = '.\\Install-LazyVim.ps1';
    c.command = {
      termIn: S.command.start - 0.05,
      k1: word('command', 'one') - 0.04,
      k2: word('command', 'one', 1) - 0.04,
      k3: word('command', 'that') - 0.04,
      cmd: command,
      keys: typeTimes(word('command', 'script') + 0.02, command, 26, 0.5, 3),
      enter: word('command', 'that'),
    };

    // 4. WinGet installs everything
    const chipWords = [
      ['neovim', word('winget', 'neovim')],
      ['git', word('winget', 'git')],
      ['compiler', word('winget', 'c')],
      ['treesitter', word('winget', 'tree')],
      ['fd', word('winget', 'lightning')],
      ['fzf', word('winget', 'lightning') + 0.28],
      ['ripgrep', word('winget', 'search')],
    ];
    c.winget = {
      badge: word('winget', 'powered') - 0.05,
      chips: Object.fromEntries(chipWords),
      allDone: word('winget', 'all'),
      own: word('winget', 'own'),
      logStart: c.command.enter + 0.2,
      logEnd: word('winget', 'own') + 0.3,
      out: S.winget.end,
    };

    // 5. Architecture detection
    c.arch = {
      cards: [word('arch', 'x64'), word('arch', 'x86'), word('arch', 'arm')],
      scan: word('arch', 'detects') - 0.1,
      detected: word('arch', 'machine'),
      compiler: word('arch', 'picks'),
      out: S.arch.end,
    };

    // 6. Safe by default
    c.safe = {
      folder: S.safe.start + 0.05,
      config: word('safe', 'config'),
      relax: word('safe', 'relax'),
      backup: word('safe', 'backed') - 0.05,
      shield: word('safe', 'safe') - 0.04,
      out: S.safe.end,
    };

    // 7. Launch
    c.launch = {
      termIn: S.launch.start - 0.05,
      keys: typeTimes(word('launch-1', 'neovim') - 0.12, 'nvim', 10, 0.3, 11),
      enter: word('launch-1', 'and') - 0.05,
      boom: E.boom,
      gorgeous: word('launch-3', 'gorgeous'),
      lazy: word('launch-3', 'batteries') - 0.05,
      editor: word('launch-3', 'editor') - 0.1,
      ready: word('launch-3', 'ready'),
      out: S.launch.end,
    };

    // 8. Call to action
    c.cta = {
      logo: S.cta.start,
      logoLand: word('cta', 'lazy'),
      subtitle: word('cta', 'for') - 0.05,
      less: word('cta', 'less') - 0.04,
      more: word('cta', 'more') - 0.04,
      github: word('cta', 'grab') - 0.05,
      command: word('cta', 'github') + 0.35,
      finalHit: E.finalHit,
      fadeOut: E.end - 0.9,
    };

    // Music arrangement shared with the score so beat-reactive visuals match the drums.
    c.sections = [
      { id: 'intro', from: 0, to: E.tapeStop, kick: true, energy: 0.35 },
      { id: 'gap', from: E.tapeStop, to: E.drop, kick: false, energy: 0 },
      { id: 'main', from: E.drop, to: S.safe.start, kick: true, energy: 1 },
      { id: 'breakdown', from: S.safe.start, to: S.launch.start, kick: false, energy: 0.45 },
      { id: 'build', from: S.launch.start, to: E.boom, kick: false, energy: 0.6 },
      { id: 'main2', from: E.boom, to: E.finalHit, kick: true, energy: 1 },
      { id: 'end', from: E.finalHit, to: E.end + 2, kick: false, energy: 0 },
    ];
    c.section = (t) => c.sections.find((s) => t >= s.from && t < s.to) ?? c.sections.at(-1);
    c.gridOrigin = (t) => tl.grids.filter((g) => g.from <= t + 1e-6).at(-1).origin;

    // Sound effects, all derived from the cues above.
    const sfx = [];
    const add = (t, type, gain = 1, pan = 0) => sfx.push({ t, type, gain, pan });
    c.struggle.keys.forEach((t, i) => add(t, 'key', 0.8, -0.1 + i * 0.05));
    add(c.struggle.enter, 'enter', 0.9);
    add(c.struggle.error, 'error', 0.7);
    add(c.struggle.compiler, 'error', 0.6, 0.3);
    add(c.struggle.path, 'error', 0.6, -0.3);
    add(c.struggle.browserIn, 'whoosh', 0.45, 0.2);
    for (let i = 0; i < 14; i++) add(c.struggle.tabsFrom + i * ((c.struggle.tabs47 - c.struggle.tabsFrom) / 14), 'tick', 0.5, 0.4 - i * 0.05);
    add(c.struggle.tabs47, 'pop', 0.8, 0.2);
    add(c.struggle.calendarIn, 'whoosh', 0.35, -0.2);
    add(c.struggle.sat, 'flip', 0.6, -0.2);
    add(c.struggle.sun, 'flip', 0.6, 0.2);
    add(c.struggle.crtStart + 0.1, 'crt', 0.7);

    add(c.hook.notIn, 'slam', 0.5);
    add(c.hook.subtitle, 'shimmer', 0.55);

    add(c.command.termIn, 'whoosh', 0.55);
    c.command.keys.forEach((t, i) => add(t, 'key', 0.35, 0.15 + (i % 5) * 0.02));
    add(c.command.enter, 'enter', 1);
    add(c.command.enter + 0.05, 'sparkle', 0.6);

    add(S.winget.start - 0.1, 'whoosh', 0.5);
    add(c.winget.badge, 'pop', 0.6, -0.3);
    Object.values(c.winget.chips).forEach((t, i) => add(t, 'pop', 0.75, -0.5 + i * 0.08));
    for (let i = 0; i < 7; i++) add(c.winget.allDone + i * 0.07, 'ding', 0.32, -0.5 + i * 0.08);

    add(S.arch.start - 0.1, 'whoosh', 0.5);
    c.arch.cards.forEach((t, i) => add(t, 'flip', 0.7, -0.4 + i * 0.4));
    add(c.arch.scan, 'scan', 0.55);
    add(c.arch.detected, 'lock', 0.8, 0.4);
    add(c.arch.compiler, 'pop', 0.6);

    add(S.safe.start - 0.1, 'whoosh', 0.5);
    add(c.safe.folder + 0.05, 'pop', 0.6);
    add(c.safe.relax, 'shimmer', 0.4);
    add(c.safe.backup, 'whoosh', 0.45, 0.4);
    add(c.safe.shield, 'slam', 0.7);

    add(c.launch.termIn, 'whoosh', 0.5);
    c.launch.keys.forEach((t) => add(t, 'key', 0.7));
    add(c.launch.enter, 'enter', 1);
    add(c.launch.lazy, 'whoosh', 0.5, 0.3);
    add(c.launch.editor, 'whoosh', 0.5, -0.3);
    add(c.launch.editor + 0.75, 'pop', 0.35, 0.2);

    add(S.cta.start - 0.1, 'whoosh', 0.5);
    add(c.cta.subtitle, 'shimmer', 0.5);
    add(c.cta.github, 'pop', 0.65, -0.2);
    add(c.cta.command, 'pop', 0.55, 0.2);
    c.sfx = sfx.sort((a, b) => a.t - b.t);
    return c;
  }

  global.buildCues = buildCues;
})(typeof window !== 'undefined' ? window : globalThis);
