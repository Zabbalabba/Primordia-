// Food particles in the Deep Glow style, and the animation of food being
// drawn into a cell.
//
// Each kind has a few hand-drawn variants, pre-rendered once into small
// sprites: algae (round cells, a golden diatom, a dividing pair, a short
// chain), bacteria (rods, paired cocci, a curved vibrio, a rod with a
// flagellum), detritus (flakes, membrane scraps, clumps) and meat (torn cell
// fragments). A particle's variant and spin come from its random `rot`.

import { TAU } from './util.js';

const PX = 6; // sprite pixels per µm
const BOX = 12; // µm covered by one sprite (shape plus glow)
const N = BOX * PX;

const KINDS = {
  algae: { hue: 112, variants: 4, spin: 0.25 },
  bacteria: { hue: 38, variants: 4, spin: 0.6 },
  detritus: { hue: 205, variants: 3, spin: 0.12 },
  meat: { hue: 345, variants: 3, spin: 0.2 },
};

const cache = {};

function canvas() {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(N, N);
  const c = document.createElement('canvas');
  c.width = c.height = N;
  return c;
}

function glow(ctx, hue, sat, a, rad = BOX / 2) {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
  g.addColorStop(0, `hsla(${hue}, ${sat}%, 60%, ${a})`);
  g.addColorStop(0.45, `hsla(${hue}, ${sat}%, 50%, ${a * 0.35})`);
  g.addColorStop(1, `hsla(${hue}, ${sat}%, 45%, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rad, 0, TAU);
  ctx.fill();
}

function cellBlob(ctx, x, y, rx, ry, hue, sat = 85) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fillStyle = `hsla(${hue}, ${sat}%, 28%, 0.9)`;
  ctx.fill();
  ctx.strokeStyle = `hsla(${hue}, 100%, 72%, 0.95)`;
  ctx.lineWidth = 0.28;
  ctx.stroke();
}

function dot(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function capsulePath(ctx, len, rad) {
  ctx.beginPath();
  ctx.arc(-len / 2, 0, rad, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.arc(len / 2, 0, rad, -Math.PI / 2, Math.PI / 2);
  ctx.closePath();
}

// Draw one variant centred at (0, 0), in µm.
const DRAW = {
  algae(ctx, v, hue) {
    if (v === 0) {
      // A round green alga with chloroplasts.
      glow(ctx, hue, 100, 0.5);
      cellBlob(ctx, 0, 0, 2.1, 2.1, hue);
      for (const [x, y] of [[-0.7, -0.5], [0.6, -0.6], [0.1, 0.8]]) dot(ctx, x, y, 0.45, `hsla(${hue + 10}, 100%, 62%, 0.95)`);
    } else if (v === 1) {
      // A golden diatom: a glass pill with fine ribs.
      const h = 52;
      glow(ctx, h, 100, 0.45);
      capsulePath(ctx, 3.2, 1.1);
      ctx.fillStyle = `hsla(${h}, 80%, 24%, 0.9)`;
      ctx.fill();
      ctx.strokeStyle = `hsla(${h}, 100%, 72%, 0.95)`;
      ctx.lineWidth = 0.25;
      ctx.stroke();
      ctx.strokeStyle = `hsla(${h}, 100%, 80%, 0.45)`;
      ctx.lineWidth = 0.12;
      for (let i = -5; i <= 5; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 0.3, -0.85);
        ctx.lineTo(i * 0.3, 0.85);
        ctx.stroke();
      }
      ctx.strokeStyle = `hsla(${h}, 100%, 85%, 0.7)`;
      ctx.lineWidth = 0.15;
      ctx.beginPath();
      ctx.moveTo(-1.8, 0);
      ctx.lineTo(1.8, 0);
      ctx.stroke();
    } else if (v === 2) {
      // A dividing pair.
      glow(ctx, hue, 100, 0.5);
      cellBlob(ctx, -0.95, 0, 1.35, 1.25, hue);
      cellBlob(ctx, 0.95, 0, 1.35, 1.25, hue);
      dot(ctx, -1, -0.2, 0.4, `hsla(${hue + 10}, 100%, 62%, 0.9)`);
      dot(ctx, 1, 0.25, 0.4, `hsla(${hue + 10}, 100%, 62%, 0.9)`);
    } else {
      // A short filament of cells.
      glow(ctx, hue - 15, 100, 0.45);
      for (const x of [-1.9, 0, 1.9]) {
        cellBlob(ctx, x, 0, 0.95, 0.85, hue - 15);
        dot(ctx, x, 0, 0.32, `hsla(${hue}, 100%, 65%, 0.9)`);
      }
    }
  },
  bacteria(ctx, v, hue) {
    const rim = `hsla(${hue}, 100%, 70%, 0.95)`;
    const fill = `hsla(${hue}, 90%, 30%, 0.9)`;
    glow(ctx, hue, 100, 0.45);
    if (v === 0 || v === 3) {
      // A rod; one variant trails a flagellum.
      if (v === 3) {
        ctx.strokeStyle = `hsla(${hue}, 100%, 75%, 0.7)`;
        ctx.lineWidth = 0.15;
        ctx.beginPath();
        for (let i = 0; i <= 20; i++) {
          const x = 1.5 + i * 0.16;
          const y = Math.sin(i * 0.9) * 0.35;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      capsulePath(ctx, 2.2, 0.75);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = rim;
      ctx.lineWidth = 0.25;
      ctx.stroke();
      dot(ctx, -0.3, 0.05, 0.28, `hsla(${hue}, 100%, 80%, 0.6)`);
      dot(ctx, 0.4, -0.1, 0.22, `hsla(${hue}, 100%, 80%, 0.5)`);
    } else if (v === 1) {
      // Paired cocci.
      for (const x of [-0.75, 0.75]) {
        ctx.beginPath();
        ctx.arc(x, 0, 0.85, 0, TAU);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = rim;
        ctx.lineWidth = 0.25;
        ctx.stroke();
      }
    } else {
      // A curved vibrio.
      ctx.strokeStyle = rim;
      ctx.lineCap = 'round';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(0, 1.6, 2.1, -Math.PI * 0.78, -Math.PI * 0.22);
      ctx.stroke();
      ctx.strokeStyle = fill;
      ctx.lineWidth = 0.85;
      ctx.stroke();
    }
  },
  detritus(ctx, v, hue) {
    glow(ctx, hue, 40, 0.22, BOX / 2.6);
    const rim = `hsla(${hue}, 35%, 70%, 0.6)`;
    if (v === 0) {
      // A jagged flake.
      const pts = [[-1.8, -0.4], [-0.6, -1.4], [0.9, -1.0], [1.7, 0.1], [0.7, 1.2], [-0.5, 0.9], [-1.4, 1.1]];
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = `hsla(${hue}, 25%, 30%, 0.55)`;
      ctx.fill();
      ctx.strokeStyle = rim;
      ctx.lineWidth = 0.2;
      ctx.stroke();
    } else if (v === 1) {
      // A scrap of old membrane.
      ctx.strokeStyle = rim;
      ctx.lineCap = 'round';
      ctx.lineWidth = 0.55;
      ctx.beginPath();
      ctx.arc(0, 1.2, 2.2, -Math.PI * 0.85, -Math.PI * 0.2);
      ctx.stroke();
      dot(ctx, -0.6, 0.6, 0.3, `hsla(${hue}, 35%, 70%, 0.5)`);
      dot(ctx, 0.8, 0.4, 0.25, `hsla(${hue}, 35%, 70%, 0.45)`);
    } else {
      // A clump of specks.
      for (const [x, y, r] of [[-0.9, -0.3, 0.55], [0.2, -0.7, 0.45], [0.8, 0.3, 0.6], [-0.2, 0.6, 0.5], [-1.3, 0.6, 0.35], [1.4, -0.5, 0.3]]) {
        dot(ctx, x, y, r, `hsla(${hue}, 25%, 45%, 0.6)`);
      }
    }
  },
  meat(ctx, v, hue) {
    glow(ctx, hue, 100, 0.5);
    if (v === 0) {
      // A torn fragment of a cell, membrane still on one side.
      ctx.beginPath();
      ctx.moveTo(-2, 0.4);
      ctx.quadraticCurveTo(-1.2, -1.9, 1.3, -1.4);
      ctx.lineTo(1.9, 0.2);
      ctx.lineTo(0.8, 0.5);
      ctx.lineTo(0.9, 1.3);
      ctx.lineTo(-0.4, 0.9);
      ctx.lineTo(-1.1, 1.4);
      ctx.closePath();
      ctx.fillStyle = `hsla(${hue}, 85%, 30%, 0.9)`;
      ctx.fill();
      ctx.strokeStyle = `hsla(${hue}, 100%, 75%, 0.95)`;
      ctx.lineWidth = 0.3;
      ctx.beginPath();
      ctx.moveTo(-2, 0.4);
      ctx.quadraticCurveTo(-1.2, -1.9, 1.3, -1.4);
      ctx.stroke();
      dot(ctx, -0.3, -0.3, 0.35, `hsla(${hue + 20}, 100%, 75%, 0.8)`);
      dot(ctx, 0.6, -0.5, 0.25, `hsla(${hue + 20}, 100%, 75%, 0.7)`);
    } else if (v === 1) {
      // Spilled granules.
      for (const [x, y, r] of [[-0.8, -0.2, 0.75], [0.6, -0.6, 0.6], [0.5, 0.7, 0.7], [-0.4, 0.9, 0.45], [1.5, 0.1, 0.4]]) {
        dot(ctx, x, y, r, `hsla(${hue}, 90%, 40%, 0.85)`);
        dot(ctx, x - r * 0.25, y - r * 0.25, r * 0.4, `hsla(${hue + 15}, 100%, 80%, 0.7)`);
      }
    } else {
      // A shred of cytoskeleton and membrane.
      ctx.strokeStyle = `hsla(${hue}, 100%, 72%, 0.9)`;
      ctx.lineCap = 'round';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(-2, -0.5);
      ctx.bezierCurveTo(-0.8, 1.2, 0.6, -1.3, 2, 0.4);
      ctx.stroke();
      ctx.strokeStyle = `hsla(${hue}, 90%, 35%, 0.9)`;
      ctx.lineWidth = 0.3;
      ctx.stroke();
    }
  },
};

function sprite(kind, v) {
  const key = `${kind}${v}`;
  if (cache[key]) return cache[key];
  const c = canvas();
  const ctx = c.getContext('2d');
  ctx.translate(N / 2, N / 2);
  ctx.scale(PX, PX);
  DRAW[kind](ctx, v, KINDS[kind].hue);
  cache[key] = c;
  return c;
}

/** Variant, spin speed and size of one particle (all from its fixed `rot`). */
export function foodLook(f) {
  const k = KINDS[f.kind] || KINDS.detritus;
  const v = Math.floor(f.rot * 1000) % k.variants;
  const spin = (((f.rot * 7919) % 2) - 1) * k.spin;
  return { v, spin, img: sprite(f.kind in KINDS ? f.kind : 'detritus', v), size: BOX * (f.r / 2.1) };
}

/**
 * Draw a food particle at world position (x, y) with rotation `a` and
 * scale `k`, into a context already transformed to world units (base
 * transform `m`, a DOMMatrix). Uses setTransform instead of save/restore.
 */
export function drawFoodSprite(ctx, m, img, x, y, a, size) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  ctx.setTransform(m.a * c + m.c * s, m.b * c + m.d * s, -m.a * s + m.c * c, -m.b * s + m.d * c, m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f);
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
}
