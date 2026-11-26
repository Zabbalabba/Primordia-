// Opening cinematic: how life may have begun, ending with the birth of your
// first cell. About 50 seconds, drawn live on a canvas in the Deep Glow style,
// with captions and sound cues. It can be skipped at any moment.
//
// The story follows one widely discussed scientific account (there are
// others): a young, violent Earth; comets bringing water; lightning over a
// warm ocean; hot vents on the sea floor whose mineral pores concentrated
// simple molecules; chains of RNA-like molecules that could copy themselves;
// fatty molecules that fold into bubbles on their own and trapped such a
// chain; and protocells that grew, split and competed, until the first cell.

import { drawCell, glowSprite } from './cellDraw.js';
import { RNG, clamp, TAU } from './util.js';

const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const lerp = (a, b, k) => a + (b - a) * k;

// Scene windows in seconds; neighbours overlap to cross-fade.
const SCENES = [
  ['space', 0, 8.2],
  ['storm', 7.6, 14.2],
  ['descent', 13.6, 21.2],
  ['pore', 20.6, 30.2],
  ['bubble', 29.6, 37.2],
  ['divide', 36.6, 45.2],
  ['birth', 44.6, 54],
];
export const INTRO_LENGTH = 54;

const CAPTIONS = [
  [0.8, 3.6, 'Four billion years ago.'],
  [3.9, 7.6, 'A young Earth, still glowing from its birth. Comets rain down, bringing water.'],
  [8.6, 13.4, 'Lightning flickers over a warm, dark ocean.'],
  [14.6, 20.2, 'Far below, hot water seeps up through cracks in the sea floor.'],
  [21.8, 25.4, 'In tiny pores in the rock, simple molecules join into chains.'],
  [25.9, 29.6, 'One chain can copy itself.'],
  [30.6, 36.4, 'Oily molecules fold into bubbles on their own. One closes around the chain.'],
  [37.6, 41.0, 'It grows, then splits in two. Each half carries a copy.'],
  [41.4, 44.8, 'The ones that copy best spread through the water.'],
];

const CUES = [
  [2.0, 'meteor'],
  [2.8, 'meteor'],
  [3.9, 'meteor'],
  [5.1, 'meteor'],
  [8.9, 'thunder'],
  [10.7, 'thunder'],
  [12.4, 'thunder'],
  [14.2, 'swell'],
  [23.0, 'gene'],
  [28.6, 'chime'],
  [34.0, 'bubble'],
  [38.7, 'divide'],
  [46.7, 'milestone'],
];

// Four "letters" of the chain, and which letter pairs with which.
const NUC = ['255, 107, 125', '255, 209, 102', '77, 214, 255', '141, 255, 107'];
const PAIR = [1, 0, 3, 2];

function boltPath(rng) {
  const pts = [[0, 0]];
  let x = 0;
  for (let i = 1; i <= 14; i++) {
    x += rng.float(-0.05, 0.05);
    pts.push([x, i / 14]);
  }
  const branch = [pts[5]];
  let bx = pts[5][0];
  for (let i = 1; i <= 5; i++) {
    bx += rng.float(0.01, 0.05);
    branch.push([bx, pts[5][1] + i * 0.05]);
  }
  return { x0: rng.float(0.2, 0.8), pts, branch };
}

export class Intro {
  /**
   * els: { canvas, caption, title, name, sub }. opts: { genome, speciesName,
   * startLine, audio, onDone }.
   */
  constructor(els, opts) {
    Object.assign(this, els, opts);
    this.ctx = this.canvas.getContext('2d');
    const rng = new RNG(4000000000);
    this.stars = Array.from({ length: 240 }, () => ({ x: rng.float(0, 1), y: rng.float(0, 1), s: rng.float(0.5, 1.7), p: rng.float(0, TAU) }));
    this.cracks = Array.from({ length: 11 }, () => {
      let x = rng.float(-0.7, 0.7);
      let y = rng.float(-0.7, 0.7);
      let a = rng.float(0, TAU);
      const pts = [[x, y]];
      for (let i = 0; i < 14; i++) {
        a += rng.float(-0.7, 0.7);
        x += Math.cos(a) * 0.07;
        y += Math.sin(a) * 0.07;
        pts.push([x, y]);
      }
      return pts;
    });
    this.seas = Array.from({ length: 8 }, () => ({ x: rng.float(-0.6, 0.6), y: rng.float(-0.6, 0.6), r: rng.float(0.15, 0.35) }));
    this.meteors = [2.0, 2.8, 3.9, 5.1, 5.8, 6.5].map((t0) => ({ t0, sy: rng.float(-0.15, 0.25), a: rng.float(-1.5, -0.35) }));
    this.rain = Array.from({ length: 140 }, () => ({ x: rng.float(0, 1), y: rng.float(0, 1), s: rng.float(0.6, 1.2) }));
    this.bolts = [8.8, 10.6, 12.3, 13.4].map((t0) => ({ t0, ...boltPath(rng) }));
    this.peaks = Array.from({ length: 7 }, (_, i) => ({ x: i / 6 + rng.float(-0.05, 0.05), h: rng.float(0.02, 0.06), w: rng.float(0.08, 0.16), glow: rng.chance(0.5) }));
    this.snow = Array.from({ length: 170 }, () => ({ x: rng.float(0, 1), y: rng.float(0, 1), s: rng.float(0.6, 2.2), v: rng.float(0.7, 1.3) }));
    this.chimney = Array.from({ length: 9 }, () => ({ w: rng.float(0.85, 1.15), dx: rng.float(-0.08, 0.08) }));
    this.pores = [[0, 0]];
    for (let k = 0; k < 6; k++) this.pores.push([Math.cos((k * TAU) / 6) * 2.1, Math.sin((k * TAU) / 6) * 2.1]);
    for (let k = 0; k < 12; k++) this.pores.push([Math.cos((k * TAU) / 12 + 0.26) * 4.1, Math.sin((k * TAU) / 12 + 0.26) * 4.1]);
    this.beads = Array.from({ length: 70 }, () => ({ x: rng.float(-1, 1), y: rng.float(-1, 1), c: rng.int(0, 3), p: rng.float(0, TAU) }));
    this.lipids = Array.from({ length: 72 }, () => ({ x: rng.float(-1.3, 1.3), y: rng.float(-1.3, 1.3), a: rng.float(0, TAU), d: rng.float(0, 0.35) }));
    this.cells = Array.from({ length: 36 }, () => ({
      x: rng.float(-1, 1),
      y: rng.float(-1, 1),
      r: rng.float(0.55, 1.1),
      p: rng.float(0, TAU),
      pop: rng.chance(0.3) ? rng.float(0.55, 0.95) : 9,
      born: rng.float(0, 0.45),
    }));
    this.sparks = Array.from({ length: 48 }, () => ({ a: rng.float(0, TAU), v: rng.float(0.15, 0.6), s: rng.float(1, 2.6) }));
    this.cued = new Set();
    this.cap = -2;
    this.done = false;
  }

  start() {
    this.t0 = performance.now();
    this.canvas.parentElement.classList.remove('leaving');
    const loop = (now) => {
      if (this.done) return;
      const t = (now - this.t0) / 1000;
      this.frame(t);
      if (t >= INTRO_LENGTH) return this.finish();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  skip() {
    this.finish();
  }

  finish() {
    if (this.done) return;
    this.done = true;
    cancelAnimationFrame(this.raf);
    this.caption.classList.remove('show');
    this.title.classList.remove('show');
    this.onDone();
  }

  // ------------------------------------------------------------ frame

  frame(t) {
    const cv = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth || window.innerWidth;
    const H = cv.clientHeight || window.innerHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    for (const [name, a, b] of SCENES) {
      if (t < a || t > b) continue;
      const fadeIn = a === 0 ? ease(seg(t, 0, 1.4)) : ease(seg(t, a, a + 0.8));
      this.alpha = fadeIn * (1 - ease(seg(t, b - 0.8, b)));
      if (this.alpha <= 0.001) continue;
      ctx.save();
      ctx.globalAlpha = this.alpha;
      this[name](ctx, W, H, t, t - a, seg(t, a, b));
      ctx.restore();
    }
    this.captions(t);
    for (const [at, name] of CUES) {
      if (t >= at && !this.cued.has(at)) {
        this.cued.add(at);
        if (t - at < 0.5) this.audio.sfx(name);
      }
    }
  }

  captions(t) {
    let idx = -1;
    CAPTIONS.forEach(([a, b], i) => {
      if (t >= a && t < b) idx = i;
    });
    if (idx !== this.cap) {
      this.cap = idx;
      if (idx >= 0) {
        this.caption.textContent = CAPTIONS[idx][2];
        this.caption.classList.add('show');
      } else this.caption.classList.remove('show');
    }
    const showTitle = t >= 47.6;
    if (showTitle && !this.titleShown) {
      this.titleShown = true;
      this.name.textContent = this.speciesName;
      this.sub.textContent = this.startLine;
      this.title.classList.add('show');
    }
  }

  /** A soft glow at (x, y), `a` times the scene's own fade. */
  glow(ctx, hue, x, y, size, a = 1, sat = 100) {
    if (a <= 0.003 || size <= 0) return;
    ctx.globalAlpha = this.alpha * Math.min(1, a);
    ctx.drawImage(glowSprite(hue, sat), x - size / 2, y - size / 2, size, size);
    ctx.globalAlpha = this.alpha;
  }

  // ------------------------------------------------------------ scenes

  space(ctx, W, H, t) {
    const m = Math.min(W, H);
    for (const s of this.stars) {
      const tw = 0.5 + 0.5 * Math.sin(t * 2 + s.p);
      ctx.fillStyle = `rgba(220, 230, 255, ${0.2 + 0.6 * tw})`;
      ctx.fillRect(s.x * W, s.y * H, s.s, s.s);
    }
    // The camera drifts in, then dives toward the surface at the end.
    const z = 1 + 0.3 * ease(seg(t, 0, 6.5)) + 3 * ease(seg(t, 6.6, 8.2));
    const cx = W / 2;
    const cy = H * 0.56 + H * 0.25 * ease(seg(t, 6.6, 8.2));
    const R = m * 0.27 * z;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();
    const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.1, cx, cy, R);
    g.addColorStop(0, '#6e3a20');
    g.addColorStop(0.6, '#3a190e');
    g.addColorStop(1, '#120604');
    ctx.fillStyle = g;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    // Seas spread as the comets deliver water.
    const water = ease(seg(t, 2.6, 7.4));
    for (const s of this.seas) {
      const gx = cx + s.x * R;
      const gy = cy + s.y * R;
      const rr = s.r * R;
      const sg = ctx.createRadialGradient(gx, gy, 0, gx, gy, rr);
      sg.addColorStop(0, `rgba(18, 62, 118, ${0.9 * water})`);
      sg.addColorStop(1, 'rgba(18, 62, 118, 0)');
      ctx.fillStyle = sg;
      ctx.fillRect(gx - rr, gy - rr, 2 * rr, 2 * rr);
    }
    // Glowing cracks of molten rock.
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.cracks.forEach((c, i) => {
      const p = new Path2D();
      c.forEach(([x, y], k) => (k ? p.lineTo(cx + x * R, cy + y * R) : p.moveTo(cx + x * R, cy + y * R)));
      const glow = (0.55 + 0.3 * Math.sin(t * 1.7 + i)) * (1 - 0.55 * water);
      ctx.strokeStyle = `rgba(255, 110, 40, ${0.2 * glow})`;
      ctx.lineWidth = R * 0.05;
      ctx.stroke(p);
      ctx.strokeStyle = `rgba(255, 175, 95, ${0.75 * glow})`;
      ctx.lineWidth = Math.max(1, R * 0.012);
      ctx.stroke(p);
    });
    ctx.globalCompositeOperation = 'source-over';
    // The night side.
    const ng = ctx.createLinearGradient(cx - R * 0.7, cy - R * 0.7, cx + R, cy + R);
    ng.addColorStop(0, 'rgba(0, 0, 0, 0)');
    ng.addColorStop(0.55, 'rgba(0, 0, 0, 0.35)');
    ng.addColorStop(1, 'rgba(0, 0, 0, 0.92)');
    ctx.fillStyle = ng;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    ctx.restore();

    // A thin, hazy atmosphere.
    ctx.globalCompositeOperation = 'lighter';
    const ag = ctx.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.13);
    ag.addColorStop(0, 'rgba(130, 175, 255, 0.35)');
    ag.addColorStop(1, 'rgba(130, 175, 255, 0)');
    ctx.fillStyle = ag;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.13, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // The Moon, much closer than today.
    const mx = cx - R * 1.3;
    const my = cy - R * 0.95;
    const mr = R * 0.2;
    const mg = ctx.createRadialGradient(mx - mr * 0.4, my - mr * 0.4, mr * 0.1, mx, my, mr);
    mg.addColorStop(0, '#8d8a86');
    mg.addColorStop(1, '#25231f');
    ctx.fillStyle = mg;
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, TAU);
    ctx.fill();

    // Comets and meteors streaking in.
    ctx.globalCompositeOperation = 'lighter';
    for (const me of this.meteors) {
      const k = (t - me.t0) / 0.9;
      if (k < 0 || k > 1.6) continue;
      const ix = cx + Math.cos(me.a) * R * 0.97;
      const iy = cy + Math.sin(me.a) * R * 0.97;
      const sx = W * 1.08;
      const sy = H * me.sy;
      if (k <= 1) {
        const e = k * k;
        const x = lerp(sx, ix, e);
        const y = lerp(sy, iy, e);
        const dx = ix - sx;
        const dy = iy - sy;
        const L = Math.hypot(dx, dy) || 1;
        const tl = m * 0.16 * (0.4 + k);
        const tg = ctx.createLinearGradient(x, y, x - (dx / L) * tl, y - (dy / L) * tl);
        tg.addColorStop(0, 'rgba(255, 240, 210, 0.95)');
        tg.addColorStop(1, 'rgba(255, 140, 60, 0)');
        ctx.strokeStyle = tg;
        ctx.lineWidth = Math.max(1.4, m * 0.006);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - (dx / L) * tl, y - (dy / L) * tl);
        ctx.stroke();
        this.glow(ctx, 35, x, y, m * 0.06, 0.9);
      } else {
        const f = 1 - (k - 1) / 0.6;
        this.glow(ctx, 30, ix, iy, R * (0.7 - 0.4 * f), f);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  storm(ctx, W, H, t, tl, u) {
    const hz = H * lerp(0.46, 0.18, ease(seg(u, 0.55, 1)));
    const sky = ctx.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, '#06051a');
    sky.addColorStop(1, '#221a3c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, hz);
    // Volcanic islands on the horizon.
    for (const p of this.peaks) {
      const x = p.x * W;
      ctx.fillStyle = '#040309';
      ctx.beginPath();
      ctx.moveTo(x - p.w * W, hz + 1);
      ctx.lineTo(x, hz - p.h * H);
      ctx.lineTo(x + p.w * W, hz + 1);
      ctx.fill();
      if (p.glow) {
        ctx.globalCompositeOperation = 'lighter';
        this.glow(ctx, 18, x, hz - p.h * H, H * 0.06, 0.5 + 0.2 * Math.sin(t * 3 + x));
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    const sea = ctx.createLinearGradient(0, hz, 0, H);
    sea.addColorStop(0, '#0c2233');
    sea.addColorStop(1, '#020509');
    ctx.fillStyle = sea;
    ctx.fillRect(0, hz, W, H - hz);
    // Swell lines, nearer ones bigger.
    ctx.lineWidth = 1;
    for (let k = 1; k <= 16; k++) {
      const f = k / 16;
      const y = hz + Math.pow(f, 1.8) * (H - hz);
      ctx.strokeStyle = `rgba(120, 170, 220, ${0.05 + 0.1 * f})`;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 12) {
        const yy = y + Math.sin(x * 0.02 / (0.3 + f) + t * (0.8 + f) + k) * 4 * f;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    // Rain.
    ctx.strokeStyle = 'rgba(170, 190, 230, 0.13)';
    ctx.beginPath();
    for (const r of this.rain) {
      const x = (((r.x * W + t * 90 * r.s) % W) + W) % W;
      const y = (((r.y * H + t * 800 * r.s) % H) + H) % H;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 4, y + 16);
    }
    ctx.stroke();
    // Lightning.
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.bolts) {
      const k = (t - b.t0) / 0.38;
      if (k < 0 || k > 1) continue;
      const flick = k < 0.15 || (k > 0.3 && k < 0.45) ? 1 : 0.45;
      ctx.fillStyle = `rgba(190, 200, 255, ${0.22 * (1 - k) * flick})`;
      ctx.fillRect(0, 0, W, H);
      const map = ([x, y]) => [W * (b.x0 + x), y * hz * 1.02];
      for (const pts of [b.pts, b.branch]) {
        const p = new Path2D();
        pts.forEach((q, i) => {
          const [x, y] = map(q);
          if (i) p.lineTo(x, y);
          else p.moveTo(x, y);
        });
        ctx.strokeStyle = `rgba(170, 190, 255, ${0.4 * (1 - k)})`;
        ctx.lineWidth = 7;
        ctx.stroke(p);
        ctx.strokeStyle = `rgba(255, 255, 255, ${(1 - k) * flick})`;
        ctx.lineWidth = 2;
        ctx.stroke(p);
      }
      this.glow(ctx, 230, W * (b.x0 + b.pts[14][0]), hz, H * 0.3, 0.6 * (1 - k), 60);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  descent(ctx, W, H, t, tl, u) {
    const m = Math.min(W, H);
    const deep = ease(u);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    const top = [lerp(11, 3, deep), lerp(58, 8, deep), lerp(85, 15, deep)].map(Math.round);
    bg.addColorStop(0, `rgb(${top})`);
    bg.addColorStop(1, '#010306');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // Sunbeams fade as we sink.
    if (u < 0.55) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 4; i++) {
        const x = W * (0.15 + i * 0.25) + Math.sin(t * 0.3 + i) * 20;
        ctx.fillStyle = `rgba(120, 200, 255, ${0.06 * (1 - u / 0.55)})`;
        ctx.beginPath();
        ctx.moveTo(x - 10, 0);
        ctx.lineTo(x + 10, 0);
        ctx.lineTo(x + 90, H);
        ctx.lineTo(x - 40, H);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    // Specks drift upward past the camera as it sinks.
    for (const s of this.snow) {
      const span = H * 1.4;
      const y = ((((s.y * span - tl * 110 * s.v * (1 - 0.6 * u)) % span) + span) % span) - H * 0.2;
      ctx.fillStyle = `rgba(190, 220, 235, ${0.25 * (0.6 + 0.4 * Math.sin(s.x * 40))})`;
      ctx.fillRect(s.x * W, y, s.s, s.s);
    }
    // A mineral chimney rises into view, venting hot water.
    const rise = ease(seg(u, 0.3, 1));
    const baseY = H * 1.04;
    const topY = lerp(H * 1.4, H * 0.38, rise);
    const cx = W * 0.52;
    const bw = m * 0.3;
    ctx.globalCompositeOperation = 'lighter';
    this.glow(ctx, 22, cx, baseY, bw * 3.2, 0.7 * rise);
    ctx.globalCompositeOperation = 'source-over';
    const n = this.chimney.length;
    for (let i = 0; i < n; i++) {
      const c = this.chimney[i];
      const y = lerp(baseY, topY, i / n);
      const h = ((baseY - topY) / n) * 1.35;
      const w = bw * (1 - i * 0.085) * c.w;
      ctx.fillStyle = '#150b07';
      ctx.beginPath();
      ctx.ellipse(cx + c.dx * bw, y - h / 2, w / 2, h * 0.7, 0, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255, 125, 60, ${0.22 * rise})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    // The shimmering plume.
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    // Warm water rises, spreads and fades: draw each strand in short pieces
    // that grow wider and fainter with height.
    const plumeH = Math.min(topY, H * 0.42);
    for (let j = 0; j < 6; j++) {
      let px = cx + (j - 2.5) * 3;
      let py = topY;
      for (let k = 1; k <= 14; k++) {
        const f = k / 14;
        const y = topY - f * plumeH;
        const x = cx + Math.sin(k * 0.5 - t * 2.2 + j * 1.3) * (3 + k * 2.2) + (j - 2.5) * (3 + k * 1.5);
        ctx.strokeStyle = `rgba(255, 190, 140, ${0.13 * rise * (1 - f)})`;
        ctx.lineWidth = 4 + f * 10;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.stroke();
        px = x;
        py = y;
      }
    }
    for (let i = 0; i < 30; i++) {
      const y = topY - ((tl * 60 + i * 37) % Math.max(40, topY + 40));
      const x = cx + Math.sin(i * 7.1 + tl) * 14 + (i % 5) * 2;
      this.glow(ctx, 30, x, y, 7, 0.7 * rise);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Warm, dim water inside a pore of the vent rock. */
  poreWater(ctx, W, H, glow = 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, `rgb(${Math.round(14 + 20 * glow)}, ${Math.round(24 + 30 * glow)}, ${Math.round(30 + 30 * glow)})`);
    g.addColorStop(1, '#020406');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  pore(ctx, W, H, t, tl) {
    const m = Math.min(W, H);
    const cx = W / 2;
    const cy = H / 2;
    // A honeycomb of mineral pores; the camera dives into the middle one.
    const zoom = ease(seg(tl, 0, 2.4));
    const P = m * lerp(0.1, 0.46, zoom);
    const rock = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H));
    rock.addColorStop(0, '#24120a');
    rock.addColorStop(1, '#070302');
    ctx.fillStyle = rock;
    ctx.fillRect(0, 0, W, H);
    for (const [px, py] of this.pores) {
      const x = cx + px * P;
      const y = cy + py * P;
      if (x < -P * 2 || y < -P * 2 || x > W + P * 2 || y > H + P * 2) continue;
      const pg = ctx.createRadialGradient(x, y, 0, x, y, P * 0.95);
      pg.addColorStop(0, '#0d1c24');
      pg.addColorStop(1, '#03080b');
      ctx.fillStyle = pg;
      ctx.beginPath();
      for (let i = 0; i <= 28; i++) {
        const a = (i / 28) * TAU;
        const k = 0.93 + 0.05 * Math.sin(a * 5 + px * 3 + py);
        const xx = x + Math.cos(a) * P * k;
        const yy = y + Math.sin(a) * P * k;
        if (i === 0) ctx.moveTo(xx, yy);
        else ctx.lineTo(xx, yy);
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255, 135, 70, 0.3)';
      ctx.lineWidth = Math.max(1, P * 0.025);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    // Inside the pore: molecules link into a chain, which is then copied.
    const Pc = P * 0.8;
    const show = seg(zoom, 0.4, 1);
    if (show <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, P * 0.92, 0, TAU);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    const rb = Math.max(2.2, Pc * 0.03);
    const free = (b) => [cx + b.x * Pc * 0.9 + Math.sin(t * 0.9 + b.p) * Pc * 0.05, cy + b.y * Pc * 0.9 + Math.cos(t * 0.7 + b.p * 1.3) * Pc * 0.05];
    const N = 16;
    const sep = ease(seg(tl, 7.4, 9.2));
    const chainPos = (i) => [cx + (-0.62 + (i * 1.24) / (N - 1)) * Pc, cy + Math.sin(i * 0.75 + t * 0.6) * Pc * 0.05 - Pc * 0.06];
    const copyPos = (i) => {
      const [x, y] = chainPos(i);
      return [x + sep * Pc * 0.05, y + Pc * 0.12 + sep * Pc * 0.32 + sep * (x - cx) * 0.18];
    };
    const pos = [];
    for (let i = 0; i < this.beads.length; i++) {
      const b = this.beads[i];
      let [x, y] = free(b);
      let c = b.c;
      let k = 0;
      if (i < N) {
        k = ease(seg(tl, 2.2 + i * 0.15, 2.9 + i * 0.15));
        const [tx, ty] = chainPos(i);
        x = lerp(x, tx, k);
        y = lerp(y, ty, k);
      } else if (i < 2 * N) {
        const j = i - N;
        c = PAIR[this.beads[j].c];
        k = ease(seg(tl, 5.0 + j * 0.13, 5.6 + j * 0.13));
        const [tx, ty] = copyPos(j);
        x = lerp(x, tx, k);
        y = lerp(y, ty, k);
      }
      pos.push([x, y, c, k]);
    }
    // Backbones and the rungs between paired letters.
    ctx.lineWidth = Math.max(1, rb * 0.45);
    for (const [from, to] of [[0, N], [N, 2 * N]]) {
      ctx.strokeStyle = `rgba(220, 240, 255, ${0.4 * show})`;
      ctx.beginPath();
      let started = false;
      for (let i = from; i < to; i++) {
        const [x, y, , k] = pos[i];
        if (k < 0.98) {
          started = false;
          continue;
        }
        if (!started) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        started = true;
      }
      ctx.stroke();
    }
    if (sep < 0.9) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.22 * (1 - sep) * show})`;
      ctx.beginPath();
      for (let j = 0; j < N; j++) {
        if (pos[N + j][3] < 0.98) continue;
        ctx.moveTo(pos[j][0], pos[j][1]);
        ctx.lineTo(pos[N + j][0], pos[N + j][1]);
      }
      ctx.stroke();
    }
    for (const [x, y, c] of pos) {
      ctx.fillStyle = `rgba(${NUC[c]}, ${0.25 * show})`;
      ctx.beginPath();
      ctx.arc(x, y, rb * 2.4, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(${NUC[c]}, ${0.95 * show})`;
      ctx.beginPath();
      ctx.arc(x, y, rb, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /** The chain, coiled up small, at (x, y). */
  strand(ctx, x, y, size, t, alpha = 1) {
    ctx.lineWidth = Math.max(1, size * 0.03);
    ctx.strokeStyle = `rgba(220, 240, 255, ${0.45 * alpha})`;
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const px = x + (-0.5 + i / 11) * size;
      const py = y + Math.sin(i * 0.9 + t * 1.2) * size * 0.14;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const px = x + (-0.5 + i / 11) * size;
      const py = y + Math.sin(i * 0.9 + t * 1.2) * size * 0.14;
      ctx.fillStyle = `rgba(${NUC[this.beads[i].c]}, ${0.95 * alpha})`;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(1.4, size * 0.045), 0, TAU);
      ctx.fill();
    }
  }

  /** A protocell: a fatty bubble with a chain inside. */
  protocell(ctx, x, y, r, t, phase, glow = 0.6) {
    const p = new Path2D();
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * TAU;
      const k = 1 + 0.04 * Math.sin(a * 3 + t * 2 + phase) + 0.025 * Math.sin(a * 5 - t * 2.7 + phase);
      if (i === 0) p.moveTo(x + Math.cos(a) * r * k, y + Math.sin(a) * r * k);
      else p.lineTo(x + Math.cos(a) * r * k, y + Math.sin(a) * r * k);
    }
    p.closePath();
    this.glow(ctx, 172, x, y, r * 4, glow);
    ctx.fillStyle = 'rgba(10, 40, 45, 0.55)';
    ctx.fill(p);
    ctx.strokeStyle = `rgba(110, 255, 230, ${0.85 * Math.min(1, glow + 0.3)})`;
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.stroke(p);
    this.strand(ctx, x, y, r * 0.9, t + phase, Math.min(1, glow + 0.3));
  }

  bubble(ctx, W, H, t, tl) {
    const m = Math.min(W, H);
    const cx = W / 2;
    const cy = H / 2;
    const rB = m * 0.17;
    this.poreWater(ctx, W, H);
    ctx.globalCompositeOperation = 'lighter';
    this.strand(ctx, cx, cy, rB * 1.1, t);
    // Fatty molecules: a water-loving head and two oily tails. They gather
    // into a double layer, tails tucked inside, heads facing the water.
    const mk = ease(seg(tl, 4.6, 6.2));
    const head = Math.max(1.6, rB * 0.035);
    const tail = rB * 0.075;
    for (let i = 0; i < this.lipids.length; i++) {
      const l = this.lipids[i];
      const outer = i % 2 === 0;
      const ang = (Math.floor(i / 2) / (this.lipids.length / 2)) * TAU + (outer ? 0 : 0.04);
      const ring = rB * (outer ? 1.08 : 0.92);
      const k = ease(seg(tl, 0.5 + l.d * 4, 2.6 + l.d * 4));
      const wob = (1 - k) * 0.08;
      const x = lerp(cx + l.x * rB * 2.4 + Math.sin(t + i) * rB * wob, cx + Math.cos(ang) * ring, k);
      const y = lerp(cy + l.y * rB * 2.4 + Math.cos(t * 0.8 + i) * rB * wob, cy + Math.sin(ang) * ring, k);
      const dir = lerp(l.a + t * 0.3, outer ? ang : ang + Math.PI, k);
      const a = 1 - 0.7 * mk;
      ctx.strokeStyle = `rgba(255, 214, 150, ${0.5 * a})`;
      ctx.lineWidth = Math.max(0.8, head * 0.4);
      ctx.beginPath();
      for (const off of [-0.25, 0.25]) {
        ctx.moveTo(x, y);
        ctx.lineTo(x - Math.cos(dir + off * 0.4) * tail, y - Math.sin(dir + off * 0.4) * tail);
      }
      ctx.stroke();
      ctx.fillStyle = `rgba(255, 220, 160, ${0.95 * a})`;
      ctx.beginPath();
      ctx.arc(x, y, head, 0, TAU);
      ctx.fill();
    }
    // The closed bubble becomes a glowing membrane.
    if (mk > 0) {
      ctx.globalAlpha = this.alpha * mk;
      this.protocell(ctx, cx, cy, rB, t, 0, 0.7);
      ctx.globalAlpha = this.alpha;
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  divide(ctx, W, H, t, tl) {
    const m = Math.min(W, H);
    const cx = W / 2;
    const cy = H / 2;
    this.poreWater(ctx, W, H, 0.2);
    ctx.globalCompositeOperation = 'lighter';
    const pull = ease(seg(tl, 4.6, 8));
    const sc = lerp(1, 0.32, pull);
    const r0 = m * 0.17 * sc * lerp(1, 1.3, ease(seg(tl, 0, 2)));
    const split = ease(seg(tl, 2.0, 4.0));
    const r = r0 * (1 - 0.2 * split);
    const d = split * r0 * 1.15;
    if (split <= 0) this.protocell(ctx, cx, cy, r0, t, 0, 0.7);
    else {
      // Two bubbles pinching apart: draw each outline without the shared part.
      const phi = d < r ? Math.acos(d / r) : 0;
      this.glow(ctx, 172, cx, cy, r0 * 4.5, 0.6);
      for (const [x, from, to] of [
        [cx - d, phi, TAU - phi],
        [cx + d, -(Math.PI - phi), Math.PI - phi],
      ]) {
        ctx.fillStyle = 'rgba(10, 40, 45, 0.45)';
        ctx.beginPath();
        ctx.arc(x, cy, r, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(110, 255, 230, 0.9)';
        ctx.lineWidth = Math.max(1, r * 0.05);
        ctx.beginPath();
        ctx.arc(x, cy, r * (1 + 0.03 * Math.sin(t * 2 + x)), from, to);
        ctx.stroke();
        this.strand(ctx, x, cy, r * 0.85, t + x * 0.01);
      }
    }
    // Pulling back: the water fills with protocells. Some burst, some thrive.
    if (pull > 0) {
      for (const c of this.cells) {
        if (Math.abs(c.x) < 0.2 && Math.abs(c.y) < 0.22) continue;
        const a = ease(seg(pull, c.born, c.born + 0.3));
        if (a <= 0) continue;
        const x = cx + c.x * W * 0.5;
        const y = cy + c.y * H * 0.45;
        const rr = m * 0.17 * 0.32 * c.r;
        if (pull > c.pop) {
          const k = (pull - c.pop) / 0.1;
          if (k < 1) {
            ctx.strokeStyle = `rgba(110, 255, 230, ${0.6 * (1 - k)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(x, y, rr * (1 + k), 0, TAU);
            ctx.stroke();
          }
          continue;
        }
        ctx.globalAlpha = this.alpha * a;
        this.protocell(ctx, x, y, rr * (1 + 0.06 * Math.sin(t * 1.5 + c.p)), t, c.p, 0.45);
        ctx.globalAlpha = this.alpha;
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  birth(ctx, W, H, t, tl) {
    const m = Math.min(W, H);
    const cx = W / 2;
    const cy = H * 0.44;
    this.poreWater(ctx, W, H, 0.35);
    ctx.globalCompositeOperation = 'lighter';
    // The camera settles on one protocell. It brightens...
    const pr = m * lerp(0.055, 0.11, ease(seg(tl, 0, 2)));
    const fade = 1 - ease(seg(tl, 1.8, 2.8));
    if (fade > 0) {
      ctx.globalAlpha = this.alpha * fade;
      this.protocell(ctx, cx, cy, pr, t, 1, 0.6 + 0.4 * seg(tl, 0.5, 2));
      ctx.globalAlpha = this.alpha;
    }
    // ...and in a flash, the first true cell: yours.
    const flash = Math.exp(-Math.pow((tl - 2.15) / 0.45, 2));
    this.glow(ctx, 172, cx, cy, m * (0.5 + 1.2 * flash), 0.5 + flash, 40);
    const k = ease(seg(tl, 2.0, 3.6));
    if (k > 0) {
      for (const s of this.sparks) {
        const age = tl - 2.15;
        if (age < 0) continue;
        const d = age * s.v * m;
        const a = Math.max(0, 1 - age / 2.5);
        this.glow(ctx, 172, cx + Math.cos(s.a) * d, cy + Math.sin(s.a) * d, s.s * 6, a);
      }
      const r = m * 0.13 * lerp(0.6, 1, k);
      ctx.globalAlpha = this.alpha * k;
      drawCell(ctx, this.genome, r, { x: cx, y: cy, heading: -Math.PI / 2 + Math.sin(t * 0.5) * 0.12, thrustLevel: 0.45, phase: 1, twitch: t * 1.7, look: -Math.PI / 2 }, t, { detail: true });
      ctx.globalAlpha = this.alpha;
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255, 255, 255, ${0.35 * flash})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }
}
