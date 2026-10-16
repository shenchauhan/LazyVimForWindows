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
    const lastWordEnd = (id) => line(id).words.at(-1).end;

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
      keys: typeTimes(0.3, 'nvim', 9, 0.3, 7),
      enter: 0.82,
      error: 0.9,
      compiler: word('struggle-2', 'compil') - 0.06,
      path: word('struggle-2', 'path') - 0.06,
      browserIn: wordEnd('struggle-2', 'variables') - 0.2,
      tabsFrom: wordEnd('struggle-2', 'variables') - 0.05,
      tabs47: word('struggle-2', '47'),
      calendarIn: line('struggle-3').start - 0.15,
      sat: word('struggle-3', 'weekend'),
      sun: word('struggle-3', 'weekend') + 0.3,
      gloom: word('struggle-3', 'goes'),
      fadeStart: E.introEnd - 0.9,
      fadeEnd: E.introEnd,
    };

    // 2. The hook: the line fades before the wordmark rises into place, finishing just after "LazyVim".
    const lineOut = lastWordEnd('hook-1') + 0.15;
    c.hook = {
      lineIn: line('hook-1').start - 0.15,
      lineOut,
      gather: lineOut + 0.25,
      assembled: E.title + 0.35,
      title: E.title,
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
      keys: typeTimes(word('command', 'script') + 0.02, command, 20, 0.5, 3),
      enter: word('command', 'that'),
    };

    // 4. WinGet installs everything
    const chipWords = [
      ['neovim', word('winget', 'neovim')],
      ['git', word('winget', 'git')],
      ['compiler', word('winget', 'c')],
      ['treesitter', word('winget', 'tree')],
      ['fd', word('winget', 'search')],
      ['fzf', word('winget', 'tools')],
      ['ripgrep', word('winget', 'relies')],
    ];
    const allDone = lastWordEnd('winget') + 0.1;
    c.winget = {
      badge: word('winget', 'uses') - 0.1,
      chips: Object.fromEntries(chipWords),
      allDone,
      done: allDone + 0.5,
      logStart: c.command.enter + 0.2,
      logEnd: allDone + 0.3,
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
      keys: typeTimes(word('launch-1', 'neovim') - 0.1, 'nvim', 8, 0.3, 11),
      enter: lastWordEnd('launch-1') + 0.15,
      reveal: E.reveal,
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
      github: word('cta', 'you') - 0.05,
      command: word('cta', 'github') + 0.35,
      finalChord: E.finalChord,
      fadeOut: E.end - 1.2,
    };

    // Music arrangement shared with the score; `energy` scales the gentle beat-reactive motion.
    c.sections = [
      { id: 'intro', from: 0, to: E.introEnd, kick: false, energy: 0 },
      { id: 'gap', from: E.introEnd, to: E.title, kick: false, energy: 0 },
      { id: 'main', from: E.title, to: S.safe.start, kick: true, energy: 0.35 },
      { id: 'breakdown', from: S.safe.start, to: S.launch.start, kick: false, energy: 0 },
      { id: 'build', from: S.launch.start, to: E.reveal, kick: true, energy: 0.2 },
      { id: 'main2', from: E.reveal, to: E.finalChord, kick: true, energy: 0.45 },
      { id: 'end', from: E.finalChord, to: E.end + 2, kick: false, energy: 0 },
    ];
    c.section = (t) => c.sections.find((s) => t >= s.from && t < s.to) ?? c.sections.at(-1);
    c.gridOrigin = (t) => tl.grids.filter((g) => g.from <= t + 1e-6).at(-1).origin;

    // Sound effects, all derived from the cues above and kept deliberately soft.
    const sfx = [];
    const add = (t, type, gain = 1, pan = 0) => sfx.push({ t, type, gain, pan });
    c.struggle.keys.forEach((t, i) => add(t, 'key', 0.6, -0.1 + i * 0.05));
    add(c.struggle.enter, 'enter', 0.7);
    add(c.struggle.error, 'error', 0.45);
    add(c.struggle.compiler, 'error', 0.4, 0.3);
    add(c.struggle.path, 'error', 0.4, -0.3);
    add(c.struggle.browserIn, 'whoosh', 0.25, 0.2);
    for (let i = 0; i < 10; i++) add(c.struggle.tabsFrom + i * ((c.struggle.tabs47 - c.struggle.tabsFrom) / 10), 'tick', 0.3, 0.4 - i * 0.07);
    add(c.struggle.tabs47, 'pop', 0.5, 0.2);
    add(c.struggle.calendarIn, 'whoosh', 0.2, -0.2);
    add(c.struggle.sat, 'flip', 0.45, -0.2);
    add(c.struggle.sun, 'flip', 0.45, 0.2);

    add(c.hook.lineIn + 0.1, 'shimmer', 0.3);

    add(c.command.termIn, 'whoosh', 0.25);
    c.command.keys.forEach((t, i) => add(t, 'key', 0.25, 0.15 + (i % 5) * 0.02));
    add(c.command.enter, 'enter', 0.6);
    add(c.command.enter + 0.05, 'sparkle', 0.35);

    add(c.winget.badge, 'pop', 0.35, -0.3);
    Object.values(c.winget.chips).forEach((t, i) => add(t, 'pop', 0.45, -0.5 + i * 0.08));
    for (let i = 0; i < 7; i++) add(c.winget.allDone + i * 0.09, 'ding', 0.2, -0.5 + i * 0.08);

    c.arch.cards.forEach((t, i) => add(t, 'flip', 0.4, -0.4 + i * 0.4));
    add(c.arch.scan, 'scan', 0.3);
    add(c.arch.detected, 'lock', 0.5, 0.4);
    add(c.arch.compiler, 'pop', 0.35);

    add(c.safe.folder + 0.05, 'pop', 0.35);
    add(c.safe.relax, 'shimmer', 0.25);
    add(c.safe.backup, 'whoosh', 0.25, 0.4);
    add(c.safe.shield, 'chime', 0.4);

    add(c.launch.termIn, 'whoosh', 0.25);
    c.launch.keys.forEach((t) => add(t, 'key', 0.5));
    add(c.launch.enter, 'enter', 0.6);
    add(c.launch.lazy, 'whoosh', 0.25, 0.3);
    add(c.launch.editor, 'whoosh', 0.25, -0.3);
    add(c.launch.editor + 0.75, 'pop', 0.2, 0.2);

    add(S.cta.start - 0.1, 'whoosh', 0.25);
    add(c.cta.subtitle, 'shimmer', 0.3);
    add(c.cta.github, 'pop', 0.4, -0.2);
    add(c.cta.command, 'pop', 0.35, 0.2);
    c.sfx = sfx.sort((a, b) => a.t - b.t);
    return c;
  }

  global.buildCues = buildCues;
})(typeof window !== 'undefined' ? window : globalThis);
