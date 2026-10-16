// Draws the LazyVim dashboard wordmark (ANSI Shadow block letters) on a canvas, cell by cell,
// so the blocks can fly together and the double-line shadows can fade in.
(function (global) {
  'use strict';

  const ROWS = [
    '██╗      █████╗ ███████╗██╗   ██╗██╗   ██╗██╗███╗   ███╗',
    '██║     ██╔══██╗╚══███╔╝╚██╗ ██╔╝██║   ██║██║████╗ ████║',
    '██║     ███████║  ███╔╝  ╚████╔╝ ██║   ██║██║██╔████╔██║',
    '██║     ██╔══██║ ███╔╝    ╚██╔╝  ╚██╗ ██╔╝██║██║╚██╔╝██║',
    '███████╗██║  ██║███████╗   ██║    ╚████╔╝ ██║██║ ╚═╝ ██║',
    '╚══════╝╚═╝  ╚═╝╚══════╝   ╚═╝     ╚═══╝  ╚═╝╚═╝     ╚═╝',
  ];
  const COLS = Math.max(...ROWS.map((r) => [...r].length));

  function mulberry32(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

  class BlockLogo {
    constructor(seed = 7) {
      const rand = mulberry32(seed);
      this.cols = COLS;
      this.rows = ROWS.length;
      this.blocks = [];
      this.strokes = [];
      ROWS.forEach((row, r) => [...row].forEach((ch, c) => {
        if (ch === '█') {
          this.blocks.push({
            c, r,
            angle: rand() * Math.PI * 2,
            dist: 0.55 + rand() * 0.9,
            spin: (rand() - 0.5) * 6,
            scale: 0.2 + rand() * 2.4,
            delay: (c / COLS) * 0.55 + rand() * 0.45,
            // A mostly left-to-right order for the gentle "rise" assembly.
            wave: (c / COLS) * 0.8 + rand() * 0.2,
          });
        } else if (ch !== ' ') {
          this.strokes.push({ c, r, ch, delay: (c / COLS) * 0.7 + rand() * 0.3 });
        }
      }));
      this.glow = document.createElement('canvas');
    }

    /**
     * o: { x, y, cw, ch, assemble (0..1), shadow (0..1), glow (0..1), alpha, top, bottom, line, spread, blur,
     *      turbulence (0..1, scales block spin and size jitter), from ('center' | 'below') }
     * (x, y) is the top-left of the wordmark. With from: 'below', blocks rise gently into place in a
     * left-to-right wave instead of flying in from the middle.
     */
    draw(ctx, o) {
      if ((o.blur ?? 0) > 0.05) {
        // Blur the finished wordmark as one image; blurring cell by cell leaves visible seams.
        this.layer ??= document.createElement('canvas');
        const lc = this.layer;
        if (lc.width !== ctx.canvas.width || lc.height !== ctx.canvas.height) {
          lc.width = ctx.canvas.width;
          lc.height = ctx.canvas.height;
        }
        const g = lc.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, lc.width, lc.height);
        g.setTransform(ctx.getTransform());
        this.draw(g, { ...o, blur: 0 });
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.filter = `blur(${o.blur.toFixed(1)}px)`;
        ctx.drawImage(lc, 0, 0);
        ctx.restore();
        return;
      }
      const { x, y, cw, ch } = o;
      const assemble = o.assemble ?? 1;
      const alpha = o.alpha ?? 1;
      const spread = o.spread ?? 1100;
      const turbulence = o.turbulence ?? 1;
      const rise = o.from === 'below';
      const ease = o.ease ?? ((p) => p * p * p);
      const w = this.cols * cw;
      const h = this.rows * ch;
      const cx = x + w / 2;
      const cy = y + h / 2;

      const paint = (g) => {
        const grad = g.createLinearGradient(0, y, 0, y + h);
        grad.addColorStop(0, o.top ?? '#a9c1ff');
        grad.addColorStop(1, o.bottom ?? '#6d8ef5');
        g.fillStyle = grad;
        for (const b of this.blocks) {
          const p = clamp((assemble - (rise ? b.wave : b.delay) * 0.5) / 0.5);
          if (p <= 0) continue;
          const e = ease(p);
          const tx = x + b.c * cw;
          const ty = y + b.r * ch;
          if (e >= 0.999) {
            g.globalAlpha = alpha;
            g.fillRect(tx, ty, cw + 0.6, ch + 0.6);
            continue;
          }
          const sx = rise ? tx + Math.cos(b.angle) * spread * 0.12 : cx + Math.cos(b.angle) * b.dist * spread;
          const sy = rise ? ty + spread * (0.35 + 0.5 * (b.dist - 0.55)) : cy + Math.sin(b.angle) * b.dist * spread * 0.62;
          const px = sx + (tx - sx) * e;
          const py = sy + (ty - sy) * e;
          const s0 = 1 + (b.scale - 1) * turbulence;
          const s = s0 + (1 - s0) * e;
          g.save();
          g.globalAlpha = alpha * clamp(p * (rise ? 1.6 : 4));
          g.translate(px + cw / 2, py + ch / 2);
          g.rotate(b.spin * turbulence * (1 - e));
          g.scale(s, s);
          g.fillRect(-cw / 2, -ch / 2, cw + 0.6, ch + 0.6);
          g.restore();
        }
        g.globalAlpha = 1;
      };

      if ((o.glow ?? 0) > 0) {
        const gc = this.glow;
        if (gc.width !== ctx.canvas.width || gc.height !== ctx.canvas.height) {
          gc.width = ctx.canvas.width;
          gc.height = ctx.canvas.height;
        }
        const g = gc.getContext('2d');
        g.clearRect(0, 0, gc.width, gc.height);
        paint(g);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = o.glow;
        ctx.filter = `blur(${Math.round(cw * 0.9)}px)`;
        ctx.drawImage(gc, 0, 0);
        ctx.restore();
      }

      paint(ctx);

      const shadow = o.shadow ?? 1;
      if (shadow > 0) {
        const gap = cw * 0.17;
        ctx.save();
        ctx.strokeStyle = o.line ?? '#8fb0ff';
        ctx.lineWidth = Math.max(1.2, cw * 0.075);
        ctx.lineCap = 'butt';
        for (const s of this.strokes) {
          const p = clamp((shadow - s.delay * 0.5) / 0.5);
          if (p <= 0) continue;
          ctx.globalAlpha = alpha * p;
          const x0 = x + s.c * cw;
          const x1 = x0 + cw;
          const y0 = y + s.r * ch;
          const y1 = y0 + ch;
          const mx = x0 + cw / 2;
          const my = y0 + ch / 2;
          ctx.beginPath();
          const path = (pts) => {
            ctx.moveTo(pts[0], pts[1]);
            for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
          };
          switch (s.ch) {
            case '═': path([x0, my - gap, x1, my - gap]); path([x0, my + gap, x1, my + gap]); break;
            case '║': path([mx - gap, y0, mx - gap, y1]); path([mx + gap, y0, mx + gap, y1]); break;
            case '╗': path([x0, my - gap, mx + gap, my - gap, mx + gap, y1]); path([x0, my + gap, mx - gap, my + gap, mx - gap, y1]); break;
            case '╔': path([x1, my - gap, mx - gap, my - gap, mx - gap, y1]); path([x1, my + gap, mx + gap, my + gap, mx + gap, y1]); break;
            case '╝': path([x0, my + gap, mx + gap, my + gap, mx + gap, y0]); path([x0, my - gap, mx - gap, my - gap, mx - gap, y0]); break;
            case '╚': path([x1, my + gap, mx - gap, my + gap, mx - gap, y0]); path([x1, my - gap, mx + gap, my - gap, mx + gap, y0]); break;
            default: break;
          }
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    /** Draws the sleepy "z z Z Z" that floats beside the wordmark on the LazyVim dashboard. */
    drawZzz(ctx, { x, y, size, t, alpha = 1, color = '#8fb0ff' }) {
      const letters = [['z', 0.62], ['z', 0.75], ['Z', 0.9], ['Z', 1.05]];
      ctx.save();
      ctx.fillStyle = color;
      ctx.textBaseline = 'alphabetic';
      letters.forEach(([letter, scale], i) => {
        const a = alpha * clamp((t - i * 0.18) * 3);
        if (a <= 0) return;
        const bob = Math.sin(t * 2.4 + i * 1.3) * size * 0.12;
        ctx.globalAlpha = a;
        ctx.font = `600 ${Math.round(size * scale)}px "Cascadia Mono", monospace`;
        ctx.fillText(letter, x + i * size * 0.95, y - i * size * 0.72 + bob);
      });
      ctx.restore();
    }
  }

  global.BlockLogo = BlockLogo;
})(window);
