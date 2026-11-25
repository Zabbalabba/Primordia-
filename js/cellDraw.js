// Procedural cell drawing in the Deep Glow style, shared by the game view,
// the editor and icons. Everything is drawn in the cell's local frame:
// +x is the front. Glow comes from additive blending and cached sprites,
// not canvas blur, so a few hundred cells stay cheap.

import { PARTS } from './parts.js';
import { TAU } from './util.js';

const GOLDEN = 2.39996;
const spriteCache = new Map();

export function glowColor(hue, l = 62, a = 1) {
  return `hsla(${hue}, 100%, ${l}%, ${a})`;
}

/** Cached soft radial glow for a hue (64 px, drawn scaled). */
export function glowSprite(hue, sat = 100, strength = 1) {
  const key = `${Math.round(hue / 6) * 6}:${sat}:${strength}`;
  let c = spriteCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, `hsla(${hue}, ${sat}%, 70%, ${0.55 * strength})`);
  g.addColorStop(0.35, `hsla(${hue}, ${sat}%, 60%, ${0.22 * strength})`);
  g.addColorStop(1, `hsla(${hue}, ${sat}%, 55%, 0)`);
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  spriteCache.set(key, c);
  return c;
}

function sprite(ctx, img, x, y, size) {
  ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
}

/** Body outline. Rods stretch along the heading; pseudopods bulge out as lobes. */
function membranePath(r, t, phase, wob, ex, ey, lobes) {
  const p = new Path2D();
  const n = 36;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU;
    let k = 1 + wob * 0.035 * Math.sin(3 * a + t * 2.1 + phase) + wob * 0.025 * Math.sin(5 * a - t * 2.9 + phase * 1.3);
    for (const l of lobes) {
      let d = a - l.a;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      k += l.amp * Math.exp(-(d * d) / 0.18);
    }
    const x = Math.cos(a) * r * ex * k;
    const y = Math.sin(a) * r * ey * k;
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.closePath();
  return p;
}

/** Two strokes, one wide and faint, one thin and bright: a cheap glow. */
function glowStroke(ctx, path, hue, width, bright = 70) {
  ctx.strokeStyle = glowColor(hue, 62, 0.22);
  ctx.lineWidth = width * 3.2;
  ctx.stroke(path);
  ctx.strokeStyle = glowColor(hue, bright, 0.95);
  ctx.lineWidth = width;
  ctx.stroke(path);
}

function wavePath(bx, by, a, L, amp, freq, waves, t, phase, seg = 18, grow = false) {
  const p = new Path2D();
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const px = -dy;
  const py = dx;
  for (let i = 0; i <= seg; i++) {
    const s = i / seg;
    const w = Math.sin(s * waves - t * freq + phase) * amp * (grow ? Math.pow(s, 0.75) : Math.min(1, s * 2.5));
    const x = bx + dx * L * s + px * w;
    const y = by + dy * L * s + py * w;
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  return p;
}

function ciliaPath(a, r, mp, t, thrust, phase, span = PARTS.cilia.arc, n = 9, len = 0.38) {
  // Cilia beat in a travelling (metachronal) wave: a stiff power stroke sweeps
  // backward and pushes water, then the cilium curls and swings forward close
  // to the surface. Neighbours are slightly out of step.
  const freq = 1.6 + 6 * Math.min(1, thrust + 0.1);
  const p = new Path2D();
  const L = r * len;
  for (let i = 0; i < n; i++) {
    const th = a - span / 2 + (span * (i + 0.5)) / n;
    const side = Math.sin(th) >= 0 ? 1 : -1;
    const b = mp(th);
    const ps = (((t * freq - i * 0.11 + phase * 0.1) % 1) + 1) % 1;
    let lean;
    let bend;
    if (ps < 0.3) {
      const k = ps / 0.3;
      lean = 0.95 - 1.9 * (k * k * (3 - 2 * k)); // forward → backward, straight
      bend = 0.08;
    } else {
      const k = (ps - 0.3) / 0.7;
      lean = -0.95 + 1.9 * k; // backward → forward, curled
      bend = 1.1 * Math.sin(k * Math.PI);
    }
    // Positive lean tilts the cilium toward the front of the cell.
    const dir = th - side * lean;
    const mid = dir + side * bend * 0.5;
    const tip = dir + side * bend;
    p.moveTo(b.x, b.y);
    p.quadraticCurveTo(b.x + Math.cos(mid) * L * 0.55, b.y + Math.sin(mid) * L * 0.55, b.x + Math.cos(tip) * L * (1 - 0.25 * bend), b.y + Math.sin(tip) * L * (1 - 0.25 * bend));
  }
  return p;
}

function drawPili(ctx, a, r, mp, hue, t, phase, twitch, thrust) {
  // Twitching motility: each pilus reaches out, sticks to the surface and
  // retracts, hauling the cell forward. Retraction is timed to the pull in
  // the simulation (world.move), so the cell jerks as the pili shorten.
  const span = PARTS.pili.arc;
  const moving = thrust > 0.05;
  const cyc = twitch ?? t * 1.7;
  const p = new Path2D();
  const dots = [];
  for (let i = 0; i < 6; i++) {
    const th = a - span / 2 + (span * (i + 0.5)) / 6;
    const b = mp(th);
    const maxL = r * (0.75 + 0.5 * (((i * 7) % 3) / 2));
    let L;
    let curl;
    let stuck = false;
    if (moving) {
      const f = (((cyc + i * 0.05 + phase * 0.01) % 1) + 1) % 1;
      if (f < 0.5) {
        // Pull: taut and shortening, tip anchored.
        L = maxL * (1 - 0.7 * (f / 0.5));
        curl = 0;
        stuck = true;
      } else {
        // Reach out again, feeling around.
        const k = (f - 0.5) / 0.5;
        L = maxL * (0.3 + 0.7 * k);
        curl = 0.35 * Math.sin(k * Math.PI + i);
      }
    } else {
      L = maxL * (0.45 + 0.15 * Math.sin(t * 1.3 + i * 1.7 + phase));
      curl = 0.3 * Math.sin(t * 1.9 + i * 2.3 + phase);
    }
    const ex = b.x + Math.cos(th + curl) * L;
    const ey = b.y + Math.sin(th + curl) * L;
    p.moveTo(b.x, b.y);
    p.quadraticCurveTo(b.x + Math.cos(th) * L * 0.55, b.y + Math.sin(th) * L * 0.55, ex, ey);
    if (stuck) dots.push(ex, ey);
  }
  ctx.strokeStyle = glowColor(hue, 82, 0.8);
  ctx.lineWidth = Math.max(0.4, r * 0.03);
  ctx.stroke(p);
  if (dots.length) {
    ctx.fillStyle = glowColor(hue, 88, 0.9);
    const d = Math.max(0.5, r * 0.05);
    for (let i = 0; i < dots.length; i += 2) {
      ctx.beginPath();
      ctx.arc(dots[i], dots[i + 1], d, 0, TAU);
      ctx.fill();
    }
  }
}

function drawRotor(ctx, a, r, mp, hue, t, thrust, phase, tumble) {
  // A long, thin corkscrew. Running: the motor spins it and a helical wave
  // runs down its length (two strands hint at the 3-D helix). Tumbling: the
  // motor reverses and the filament goes slack and curly.
  const b = mp(a);
  if (tumble > 0) {
    const path = wavePath(b.x, b.y, a + Math.sin(t * 9 + phase) * 0.5, r * 2.5, r * 0.42, 6, 5, t, phase, 22);
    glowStroke(ctx, path, hue, Math.max(0.5, r * 0.035), 80);
    return;
  }
  const freq = 8 + 34 * thrust;
  const path = wavePath(b.x, b.y, a, r * 3.1, r * 0.16, freq, 15, t, phase, 28);
  glowStroke(ctx, path, hue, Math.max(0.5, r * 0.035), 80);
  const back = wavePath(b.x, b.y, a, r * 3.1, r * 0.16, freq, 15, t, phase + Math.PI * 0.6, 28);
  ctx.strokeStyle = glowColor(hue, 70, 0.25);
  ctx.lineWidth = Math.max(0.4, r * 0.025);
  ctx.stroke(back);
}

function drawFlagellum(ctx, a, r, mp, hue, t, thrust, phase) {
  // A whip that beats in a plane: the bend starts at the base and grows as it
  // travels to the tip, faster when swimming hard.
  const b = mp(a);
  const amp = r * 0.34 * (0.35 + 0.65 * Math.min(1, thrust + 0.2));
  const path = wavePath(b.x, b.y, a, r * 2.4, amp, 4 + 14 * thrust, 7.5, t, phase, 22, true);
  glowStroke(ctx, path, hue, Math.max(0.8, r * 0.07));
}

function drawGroove(ctx, a, r, mp, hue, t, phase) {
  const b = mp(a);
  const open = new Path2D();
  open.ellipse(0, 0, r * 0.16, r * 0.36, 0, 0, TAU);
  const tent = new Path2D();
  for (let i = 0; i < 5; i++) {
    const y = (i - 2) * r * 0.16;
    const sway = Math.sin(t * 7 + i * 1.3 + phase) * r * 0.12;
    tent.moveTo(r * 0.05, y);
    tent.quadraticCurveTo(r * 0.25, y + sway, r * 0.4, y + sway * 1.6);
  }
  const m = new DOMMatrix().translateSelf(b.x, b.y).rotateSelf((a * 180) / Math.PI).translateSelf(-r * 0.08, 0);
  const o2 = new Path2D();
  o2.addPath(open, m);
  const t2 = new Path2D();
  t2.addPath(tent, m);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(1, 4, 10, 0.75)';
  ctx.fill(o2);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  glowStroke(ctx, t2, hue, Math.max(0.7, r * 0.045), 78);
}

function drawJaw(ctx, a, r, mp, hue, bite) {
  const b = mp(a);
  const open = 0.25 + 0.45 * bite;
  for (const side of [-1, 1]) {
    const m = new Path2D();
    m.moveTo(0, side * r * 0.08);
    m.quadraticCurveTo(r * 0.45, side * r * 0.32, r * 0.62, side * r * 0.02);
    m.quadraticCurveTo(r * 0.38, side * r * 0.12, 0, side * r * 0.24);
    m.closePath();
    const q = new Path2D();
    q.addPath(m, new DOMMatrix().translateSelf(b.x, b.y).rotateSelf((a * 180) / Math.PI).translateSelf(-r * 0.12, 0).rotateSelf((side * open * 180) / Math.PI));
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(30, 4, 12, 0.8)';
    ctx.fill(q);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255, 240, 245, 0.9)';
    ctx.lineWidth = Math.max(0.7, r * 0.045);
    ctx.stroke(q);
    ctx.strokeStyle = glowColor(hue, 62, 0.3);
    ctx.lineWidth = Math.max(2, r * 0.14);
    ctx.stroke(q);
  }
}

function drawLytic(ctx, a, r, mp, t, phase) {
  const b = mp(a);
  const p = new Path2D();
  const c = Math.cos(a);
  const s = Math.sin(a);
  p.moveTo(b.x - s * r * 0.2, b.y + c * r * 0.2);
  p.lineTo(b.x + c * r * 0.55, b.y + s * r * 0.55);
  p.lineTo(b.x + s * r * 0.2, b.y - c * r * 0.2);
  p.closePath();
  ctx.fillStyle = 'hsla(20, 100%, 60%, 0.35)';
  ctx.fill(p);
  glowStroke(ctx, p, 20, Math.max(0.6, r * 0.05), 75);
  const pulse = 0.7 + 0.3 * Math.sin(t * 6 + phase);
  sprite(ctx, glowSprite(12), b.x + c * r * 0.55, b.y + s * r * 0.55, r * 0.9 * pulse);
}

function drawSpike(ctx, a, r, mp, hue) {
  const b = mp(a);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const p = new Path2D();
  p.moveTo(b.x - s * r * 0.16, b.y + c * r * 0.16);
  p.lineTo(b.x + c * r * 0.85, b.y + s * r * 0.85);
  p.lineTo(b.x + s * r * 0.16, b.y - c * r * 0.16);
  p.closePath();
  ctx.fillStyle = glowColor(hue, 60, 0.18);
  ctx.fill(p);
  glowStroke(ctx, p, hue, Math.max(0.7, r * 0.05), 80);
}

function drawArmor(ctx, a, r, hue) {
  const span = PARTS.armor.arc;
  for (let i = 0; i < 3; i++) {
    const a0 = a - span / 2 + (span * i) / 3 + 0.04;
    const a1 = a - span / 2 + (span * (i + 1)) / 3 - 0.04;
    const p = new Path2D();
    p.arc(0, 0, r * 1.2, a0, a1);
    p.arc(0, 0, r * 0.99, a1, a0, true);
    p.closePath();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `hsla(${hue}, 60%, 14%, 0.85)`;
    ctx.fill(p);
    ctx.globalCompositeOperation = 'lighter';
    glowStroke(ctx, p, hue, Math.max(0.7, r * 0.04), 72);
  }
}

function drawToxin(ctx, a, r, mp, t, phase) {
  const b = mp(a);
  const x = b.x + Math.cos(a) * r * 0.08;
  const y = b.y + Math.sin(a) * r * 0.08;
  const pulse = 1 + 0.12 * Math.sin(t * 4 + phase);
  sprite(ctx, glowSprite(300), x, y, r * 1.3 * pulse);
  ctx.fillStyle = 'hsla(300, 100%, 70%, 0.85)';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.2 * pulse, 0, TAU);
  ctx.fill();
}

/** Eyes look different at each tier so progress is visible on the creature. */
function drawEye(ctx, t, a, r, mp, hue, look) {
  ctx.globalCompositeOperation = 'source-over';
  const b = mp(a);
  if (t === 'eyespot') {
    const x = b.x * 0.82;
    const y = b.y * 0.82;
    ctx.globalCompositeOperation = 'lighter';
    sprite(ctx, glowSprite(18), x, y, r * 0.7);
    ctx.fillStyle = 'hsl(18, 100%, 62%)';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.12, 0, TAU);
    ctx.fill();
    return;
  }
  const big = t === 'ocelloid';
  const er = r * (big ? 0.3 : 0.21);
  const k = big ? 0.88 : 0.8;
  const x = b.x * k;
  const y = b.y * k;
  const lx = Math.cos(look) * er * 0.38;
  const ly = Math.sin(look) * er * 0.38;
  ctx.globalCompositeOperation = 'lighter';
  sprite(ctx, glowSprite(big ? 190 : hue, 60), x, y, er * 4);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#eafcff';
  ctx.beginPath();
  ctx.arc(x, y, er, 0, TAU);
  ctx.fill();
  if (big) {
    ctx.fillStyle = 'hsl(185, 90%, 45%)';
    ctx.beginPath();
    ctx.arc(x + lx, y + ly, er * 0.62, 0, TAU);
    ctx.fill();
  } else {
    ctx.strokeStyle = `hsla(${hue}, 80%, 35%, 0.9)`;
    ctx.lineWidth = Math.max(0.6, er * 0.25);
    ctx.beginPath();
    ctx.arc(x, y, er * 0.9, a - 1.9, a + 1.9, true);
    ctx.stroke();
  }
  ctx.fillStyle = '#020611';
  ctx.beginPath();
  ctx.arc(x + lx, y + ly, er * (big ? 0.34 : 0.5), 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.beginPath();
  ctx.arc(x + lx - er * 0.22, y + ly - er * 0.22, er * (big ? 0.18 : 0.14), 0, TAU);
  ctx.fill();
}

const ORG_HUE = {
  chloroplast: 108, thylakoid: 120, mitochondrion: 18, storage: 205, chemosynth: 42, antifreeze: 195, heatshock: 8, pigment: 350,
  catalase: 270, detox: 65, gasvesicle: 190, foodvacuole: 210, lysosome: 285, crispr: 320, cyst: 45, adhesion: 150,
  transporter: 175, chemoreceptor: 160, capsule: 200, cellwall: 40,
};

// Membrane-level traits are drawn on or around the membrane, not as organelles.
const MEMBRANE_PARTS = new Set(['transporter', 'chemoreceptor', 'capsule', 'cellwall', 'adhesion', 'cyst']);

export function drawOrganelle(ctx, t, x, y, s, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const h = ORG_HUE[t] ?? 180;
  ctx.fillStyle = `hsl(${h}, 95%, 62%)`;
  ctx.strokeStyle = `hsl(${h}, 100%, 82%)`;
  ctx.lineWidth = Math.max(0.5, s * 0.12);
  ctx.beginPath();
  switch (t) {
    case 'chloroplast':
      ctx.ellipse(0, 0, s, s * 0.55, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) {
        ctx.moveTo(-s * 0.6, i * s * 0.2);
        ctx.lineTo(s * 0.6, i * s * 0.2);
      }
      ctx.strokeStyle = 'hsl(108, 80%, 30%)';
      ctx.stroke();
      ctx.restore();
      return;
    case 'thylakoid':
      ctx.fillStyle = 'transparent';
      for (let i = 0; i < 3; i++) {
        ctx.moveTo(-s * 0.9, -s * 0.35 + i * s * 0.35);
        ctx.quadraticCurveTo(0, -s * 0.6 + i * s * 0.35, s * 0.9, -s * 0.35 + i * s * 0.35);
      }
      ctx.lineWidth = Math.max(0.6, s * 0.18);
      break;
    case 'mitochondrion':
      ctx.ellipse(0, 0, s, s * 0.45, 0, 0, TAU);
      break;
    case 'storage':
      for (let i = 0; i < 4; i++) {
        const px = Math.cos(i * 1.7) * s * 0.45;
        const py = Math.sin(i * 2.3) * s * 0.45;
        ctx.moveTo(px + s * 0.25, py);
        ctx.arc(px, py, s * 0.25, 0, TAU);
      }
      break;
    case 'gasvesicle':
      ctx.fillStyle = 'rgba(200, 240, 255, 0.35)';
      for (let i = 0; i < 4; i++) {
        const px = (i % 2) * s * 0.6 - s * 0.3;
        const py = Math.floor(i / 2) * s * 0.6 - s * 0.3;
        ctx.moveTo(px + s * 0.28, py);
        ctx.ellipse(px, py, s * 0.28, s * 0.18, 0, 0, TAU);
      }
      break;
    case 'foodvacuole':
      ctx.fillStyle = 'rgba(160, 200, 255, 0.18)';
      ctx.arc(0, 0, s * 1.1, 0, TAU);
      break;
    case 'lysosome':
      for (let i = 0; i < 3; i++) {
        const px = Math.cos(i * 2.1) * s * 0.4;
        const py = Math.sin(i * 2.1) * s * 0.4;
        ctx.moveTo(px + s * 0.22, py);
        ctx.arc(px, py, s * 0.22, 0, TAU);
      }
      break;
    case 'chemosynth':
      for (let i = 0; i < 3; i++) {
        const a = (i * TAU) / 3;
        ctx.moveTo(Math.cos(a) * s * 0.85, Math.sin(a) * s * 0.85);
        ctx.ellipse(Math.cos(a) * s * 0.4, Math.sin(a) * s * 0.4, s * 0.45, s * 0.2, a, 0, TAU);
      }
      break;
    case 'crispr':
      ctx.fillStyle = 'transparent';
      for (let i = 0; i <= 12; i++) {
        const xx = -s + (i / 12) * 2 * s;
        const yy = Math.sin(i * 1.2) * s * 0.35;
        if (i === 0) ctx.moveTo(xx, yy);
        else ctx.lineTo(xx, yy);
      }
      ctx.lineWidth = Math.max(0.6, s * 0.16);
      break;
    case 'antifreeze':
      ctx.fillStyle = 'transparent';
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        ctx.moveTo(-Math.cos(a) * s * 0.7, -Math.sin(a) * s * 0.7);
        ctx.lineTo(Math.cos(a) * s * 0.7, Math.sin(a) * s * 0.7);
      }
      ctx.lineWidth = Math.max(0.6, s * 0.18);
      break;
    case 'heatshock':
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        if (i === 0) ctx.moveTo(Math.cos(a) * s * 0.6, Math.sin(a) * s * 0.6);
        else ctx.lineTo(Math.cos(a) * s * 0.6, Math.sin(a) * s * 0.6);
      }
      ctx.closePath();
      break;
    case 'pigment':
      for (let i = 0; i < 5; i++) {
        const px = Math.cos(i * 1.3) * s * 0.5;
        const py = Math.sin(i * 2.1) * s * 0.5;
        ctx.moveTo(px + s * 0.22, py);
        ctx.arc(px, py, s * 0.22, 0, TAU);
      }
      break;
    case 'catalase':
      ctx.arc(0, 0, s * 0.5, 0, TAU);
      break;
    case 'detox':
      ctx.moveTo(0, -s * 0.65);
      ctx.lineTo(s * 0.5, 0);
      ctx.lineTo(0, s * 0.65);
      ctx.lineTo(-s * 0.5, 0);
      ctx.closePath();
      break;
    default:
      ctx.arc(0, 0, s * 0.45, 0, TAU);
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Positions for internal organelles (not membrane traits), stable per index. */
export function organellePositions(g, r) {
  const internal = g.parts.filter((p) => !PARTS[p.t].ext && !MEMBRANE_PARTS.has(p.t));
  const n = internal.length;
  return internal.map((p, i) => {
    const rad = r * 0.58 * Math.sqrt((i + 0.7) / (n + 0.7));
    const ang = i * GOLDEN + 0.9;
    return { t: p.t, x: Math.cos(ang) * rad + r * 0.06, y: Math.sin(ang) * rad, rot: ang * 1.7 };
  });
}

/** Shape factors for a genome: rods are stretched along the heading. */
export function bodyShape(g) {
  const shape = g.domain === 'euk' ? 0 : g.shape || 0;
  return { ex: 1 + 0.7 * shape, ey: 1 - 0.18 * shape };
}

/**
 * Draw a cell. `st` carries animation state: heading, thrustLevel, biteAnim,
 * flash, phase, look (world angle the eyes track), x, y, and status flags
 * (cyst, infected, guest, meal).
 * opts.blob draws only a soft glow (what an eyeless viewer makes out at range).
 */
export function drawCell(ctx, g, r, st, t, opts = {}) {
  const hue = g.hue;
  const thrust = st.cyst ? 0 : st.thrustLevel || 0;
  const phase = st.phase || 0;
  let { ex, ey } = bodyShape(g);
  const hasPart = (id) => (opts.counts && opts.counts[id] !== undefined ? opts.counts[id] > 0 : g.parts.some((p) => p.t === id));
  // Each pilus pull stretches the body a little toward where it is going.
  if (thrust > 0.05 && st.twitch !== undefined && hasPart('pili')) {
    const pull = Math.pow(Math.max(0, Math.sin(st.twitch * TAU)), 3) * Math.min(1, thrust);
    ex *= 1 + 0.06 * pull;
    ey *= 1 - 0.05 * pull;
  }
  const mp = (a) => ({ x: Math.cos(a) * r * ex, y: Math.sin(a) * r * ey });
  ctx.save();
  ctx.translate(st.x, st.y);
  // A beating whip makes the whole cell yaw slightly from side to side.
  const yaw = thrust > 0.05 && !st.cyst && hasPart('flagellum') ? Math.sin(t * (4 + 14 * thrust) + phase) * 0.05 * Math.min(1, thrust) : 0;
  ctx.rotate(st.heading + yaw);
  ctx.globalCompositeOperation = 'lighter';

  if (opts.blob || opts.simple) {
    const pulse = 1 + 0.06 * Math.sin(t * 2 + phase);
    sprite(ctx, glowSprite(hue, opts.blobSat ?? 100), 0, 0, r * 4.2 * pulse * Math.max(ex, 1));
    ctx.fillStyle = `hsla(${hue}, ${opts.blobSat ?? 100}%, 70%, 0.35)`;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.75 * ex, r * 0.75 * ey, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    return;
  }

  const c = opts.counts || {};
  const has = (id) => (c[id] !== undefined ? c[id] > 0 : g.parts.some((p) => p.t === id));
  sprite(ctx, glowSprite(hue), 0, 0, r * (opts.halo ?? 5) * Math.max(1, ex * 0.9));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Slime capsule: a soft halo around everything.
  if (has('capsule')) {
    const cap = new Path2D();
    cap.ellipse(0, 0, r * ex * 1.28, r * ey * 1.32, 0, 0, TAU);
    ctx.fillStyle = `hsla(${hue}, 60%, 60%, 0.07)`;
    ctx.fill(cap);
    ctx.strokeStyle = `hsla(${hue}, 80%, 75%, 0.18)`;
    ctx.lineWidth = Math.max(0.6, r * 0.05);
    ctx.stroke(cap);
  }

  // Back layer: locomotion.
  if (!st.cyst) {
    for (const p of g.parts) {
      if (p.t === 'flagellum') drawFlagellum(ctx, p.a, r, mp, hue, t, thrust, phase + p.a);
      else if (p.t === 'rotor') drawRotor(ctx, p.a, r, mp, hue, t, thrust, phase + p.a, st.tumble || 0);
      else if (p.t === 'cilia') {
        ctx.strokeStyle = glowColor(hue, 75, 0.75);
        ctx.lineWidth = Math.max(0.5, r * 0.04);
        ctx.stroke(ciliaPath(p.a, r, mp, t, thrust, phase + p.a));
      } else if (p.t === 'pili') drawPili(ctx, p.a, r, mp, hue, t, phase + p.a, st.twitch, thrust);
    }
  }
  for (const p of g.parts) if (p.t === 'armor') drawArmor(ctx, p.a, r, hue);
  ctx.globalCompositeOperation = 'lighter';
  for (const p of g.parts) if (p.t === 'spike') drawSpike(ctx, p.a, r, mp, hue);
  for (const p of g.parts) if (p.t === 'toxin') drawToxin(ctx, p.a, r, mp, t, phase);
  for (const p of g.parts) if (p.t === 'lytic') drawLytic(ctx, p.a, r, mp, t, phase);

  // Body: a dark translucent interior with a glowing rim.
  // Pseudopods: at rest they bulge where they sit; when crawling, new lobes
  // flow out at the leading edge, alternating left and right, and the rear
  // pinches in as the cell pulls itself after them.
  let lobes = [];
  if (!st.cyst) {
    const pods = g.parts.filter((p) => p.t === 'pseudopod');
    if (pods.length && thrust > 0.1) {
      const k = Math.min(1, thrust);
      const cyc = t * 0.9 + phase;
      lobes.push({ a: 0.4, amp: 0.3 * k * Math.max(0, Math.sin(cyc)) });
      lobes.push({ a: -0.4, amp: 0.3 * k * Math.max(0, Math.sin(cyc + Math.PI)) });
      lobes.push({ a: Math.PI, amp: -0.08 * k });
      for (const [i, p] of pods.entries()) lobes.push({ a: p.a, amp: 0.1 * (0.5 + 0.5 * Math.sin(t * 1.2 + i * 2 + phase)) });
    } else {
      lobes = pods.map((p, i) => ({ a: p.a, amp: 0.22 * (0.55 + 0.45 * Math.sin(t * 1.2 + i * 2 + phase)) }));
    }
  }
  const body = membranePath(r, t, phase, st.cyst ? 0.2 : opts.wobble ?? 1, ex, ey, lobes);
  ctx.globalCompositeOperation = 'source-over';
  const fill = ctx.createRadialGradient(0, 0, 0, 0, 0, r * Math.max(ex, 1));
  fill.addColorStop(0, `hsla(${hue}, 80%, 14%, 0.75)`);
  fill.addColorStop(1, `hsla(${hue}, 90%, 26%, 0.6)`);
  ctx.fillStyle = fill;
  ctx.fill(body);
  const pigments = c.pigment ?? g.parts.filter((p) => p.t === 'pigment').length;
  if (pigments) {
    ctx.fillStyle = `rgba(40, 0, 10, ${0.15 * pigments})`;
    ctx.fill(body);
  }
  ctx.globalCompositeOperation = 'lighter';
  const rim = ctx.createRadialGradient(0, 0, r * 0.45, 0, 0, r * Math.max(ex, 1));
  rim.addColorStop(0, glowColor(hue, 60, 0));
  rim.addColorStop(1, glowColor(hue, 60, 0.35));
  ctx.fillStyle = rim;
  ctx.fill(body);

  if (g.domain === 'euk') {
    // Nucleus: a soft bright sphere.
    const nx = -r * 0.18;
    const nucleus = ctx.createRadialGradient(nx, 0, 0, nx, 0, r * 0.3);
    nucleus.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
    nucleus.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = nucleus;
    ctx.beginPath();
    ctx.arc(nx, 0, r * 0.3, 0, TAU);
    ctx.fill();
  } else if (r > 5 || opts.detail) {
    // Nucleoid: a loose tangle of DNA with no membrane around it.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = Math.max(0.4, r * 0.035);
    ctx.beginPath();
    // A spinning flagellar motor turns the body the other way.
    const spin = !st.cyst && hasPart('rotor') && !(st.tumble > 0) ? -t * 2.2 * thrust : 0;
    for (let i = 0; i <= 14; i++) {
      const a = i * 1.9 + phase + spin;
      const rr = r * 0.32 * (0.4 + 0.6 * Math.abs(Math.sin(i * 1.3)));
      const x = Math.cos(a) * rr * ex * 0.8;
      const y = Math.sin(a) * rr * ey * 0.8;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Organelles: glowing dots.
  if (r > 5 || opts.detail) {
    for (const o of organellePositions(g, r)) {
      const wob = Math.sin(t * 0.8 + o.rot) * r * 0.03;
      const s = r * 0.16;
      const ox = (o.x + wob) * ex * 0.95;
      const oy = (o.y - wob) * ey * 0.95;
      sprite(ctx, glowSprite(ORG_HUE[o.t] ?? 180), ox, oy, s * 4);
      if (r > 9 || opts.detail) {
        ctx.globalCompositeOperation = 'source-over';
        drawOrganelle(ctx, o.t, ox, oy, s, o.rot + t * 0.15);
        ctx.globalCompositeOperation = 'lighter';
      }
    }
  }
  // A guest bacterium, and food being digested.
  if (st.guest) {
    const gh = st.guest === 'cyano' ? 115 : 285;
    const gx = r * 0.3 * Math.cos(t * 0.7);
    const gy = r * 0.25 * Math.sin(t * 0.9);
    sprite(ctx, glowSprite(gh), gx, gy, r * 0.9);
    ctx.fillStyle = `hsla(${gh}, 100%, 72%, 0.9)`;
    ctx.beginPath();
    ctx.ellipse(gx, gy, r * 0.17, r * 0.09, t, 0, TAU);
    ctx.fill();
  }
  if (st.meal) {
    const mr = Math.min(r * 0.45, st.meal.r);
    sprite(ctx, glowSprite(st.meal.hue), r * 0.15, r * 0.1, mr * 3);
    ctx.fillStyle = `hsla(${st.meal.hue}, 70%, 60%, 0.35)`;
    ctx.beginPath();
    ctx.arc(r * 0.15, r * 0.1, mr, 0, TAU);
    ctx.fill();
  }

  // Membrane, plus a wall if there is one.
  glowStroke(ctx, body, hue, Math.max(1, r * (0.05 + g.membrane * 0.1)));
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = Math.max(0.5, r * 0.025);
  ctx.stroke(body);
  if (has('cellwall')) {
    const wall = membranePath(r * 1.08, t, phase, 0.3, ex, ey, []);
    ctx.strokeStyle = 'hsla(40, 70%, 75%, 0.55)';
    ctx.lineWidth = Math.max(0.8, r * 0.08);
    ctx.stroke(wall);
  }
  // Transporters and chemoreceptors are studs in the membrane.
  const studs = (c.transporter ?? 0) * 5;
  for (let i = 0; i < studs; i++) {
    const a = (i / studs) * TAU + 0.3;
    const p = mp(a);
    ctx.fillStyle = 'hsla(175, 100%, 80%, 0.7)';
    ctx.fillRect(p.x - 0.6, p.y - 0.6, 1.2, 1.2);
  }
  const chemo = c.chemoreceptor ?? 0;
  for (let i = 0; i < chemo * 2; i++) {
    const a = (i % 2 ? 0.35 : -0.35) + (i >= 2 ? Math.PI : 0) * (i >= 4 ? 0.5 : 1);
    const p = mp(a);
    sprite(ctx, glowSprite(160), p.x, p.y, r * 0.55);
  }
  if (has('adhesion')) {
    for (let i = 0; i < 8; i++) {
      const p = mp((i / 8) * TAU);
      ctx.fillStyle = 'hsla(150, 100%, 75%, 0.6)';
      ctx.beginPath();
      ctx.arc(p.x * 1.08, p.y * 1.08, Math.max(0.6, r * 0.05), 0, TAU);
      ctx.fill();
    }
  }

  if (st.flash > 0) {
    ctx.fillStyle = `rgba(255, 60, 90, ${st.flash * 0.5})`;
    ctx.fill(body);
  }
  if (st.infected) {
    const k = 0.35 + 0.25 * Math.sin(t * 9);
    ctx.fillStyle = `rgba(255, 80, 220, ${k * 0.35})`;
    ctx.fill(body);
    for (let i = 0; i < 4; i++) {
      const a = t * 0.6 + i * 1.6;
      sprite(ctx, glowSprite(310), Math.cos(a) * r * 0.45 * ex, Math.sin(a) * r * 0.45 * ey, r * 0.45);
    }
  }

  // Front layer.
  for (const p of g.parts) {
    if (p.t === 'oralgroove') drawGroove(ctx, p.a, r, mp, hue, t, phase);
    else if (p.t === 'cytostome') drawJaw(ctx, p.a, r, mp, hue, st.biteAnim || 0);
  }
  const look = st.look != null ? st.look - st.heading : 0;
  for (const p of g.parts) if (PARTS[p.t].eye) drawEye(ctx, p.t, p.a, r, mp, hue, look);

  // Dormant cyst: a thick shell over everything.
  if (st.cyst) {
    const shell = new Path2D();
    shell.ellipse(0, 0, r * ex * 1.18, r * ey * 1.18, 0, 0, TAU);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(10, 14, 24, 0.45)';
    ctx.fill(shell);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'hsla(45, 80%, 70%, 0.75)';
    ctx.lineWidth = Math.max(1.2, r * 0.16);
    ctx.stroke(shell);
  }

  ctx.restore();
}

/** Small standalone icon of a single part, for palettes and cards. */
export function drawPartIcon(ctx, t, size, hue = 172) {
  const r = size * 0.28;
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  const part = PARTS[t];
  const mp = (a) => ({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  if (part.ext) {
    // Show the part on a slice of membrane, facing right.
    ctx.translate(size * 0.3, size / 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `hsla(${hue}, 80%, 16%, 0.9)`;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    const ring = new Path2D();
    ring.arc(0, 0, r, 0, TAU);
    glowStroke(ctx, ring, hue, 1.2);
    const time = 0.6;
    ctx.lineCap = 'round';
    if (t === 'flagellum') drawFlagellum(ctx, 0, r, mp, hue, time, 0.6, 0);
    else if (t === 'rotor') drawRotor(ctx, 0, r * 0.8, mp, hue, time, 0.4, 0);
    else if (t === 'pili') drawPili(ctx, 0, r * 1.3, mp, hue, 0.4, 0);
    else if (t === 'cilia') {
      ctx.strokeStyle = glowColor(hue, 75, 0.9);
      ctx.lineWidth = 1;
      ctx.stroke(ciliaPath(0, r, mp, time, 0.6, 0));
    } else if (t === 'pseudopod') {
      const lobe = membranePath(r, 0, 0, 0, 1, 1, [{ a: 0, amp: 0.45 }]);
      ctx.fillStyle = `hsla(${hue}, 80%, 30%, 0.5)`;
      ctx.fill(lobe);
      glowStroke(ctx, lobe, hue, 1.2);
    } else if (t === 'oralgroove') drawGroove(ctx, 0, r, mp, hue, time, 0);
    else if (t === 'cytostome') drawJaw(ctx, 0, r, mp, hue, 0.5);
    else if (t === 'lytic') drawLytic(ctx, 0, r, mp, time, 0);
    else if (t === 'spike') drawSpike(ctx, 0, r, mp, hue);
    else if (t === 'armor') drawArmor(ctx, 0, r, hue);
    else if (t === 'toxin') drawToxin(ctx, 0, r, mp, time, 0);
    else if (part.eye) drawEye(ctx, t, 0, r * 1.5, (a) => ({ x: Math.cos(a) * r * 1.5, y: Math.sin(a) * r * 1.5 }), hue, 0);
  } else if (MEMBRANE_PARTS.has(t)) {
    ctx.translate(size / 2, size / 2);
    ctx.globalCompositeOperation = 'lighter';
    const ring = new Path2D();
    ring.arc(0, 0, r * 1.2, 0, TAU);
    const h = ORG_HUE[t] ?? hue;
    if (t === 'capsule') {
      ctx.fillStyle = `hsla(${hue}, 60%, 60%, 0.15)`;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.5, 0, TAU);
      ctx.fill();
    }
    glowStroke(ctx, ring, t === 'cellwall' ? 40 : hue, t === 'cellwall' ? 2.4 : 1.1);
    if (t === 'transporter') for (let i = 0; i < 10; i++) {
      ctx.fillStyle = 'hsla(175, 100%, 80%, 0.9)';
      ctx.fillRect(Math.cos(i * 0.63) * r * 1.2 - 1, Math.sin(i * 0.63) * r * 1.2 - 1, 2, 2);
    }
    if (t === 'chemoreceptor') for (let i = 0; i < 4; i++) sprite(ctx, glowSprite(160), Math.cos(i * 1.57 + 0.4) * r * 1.2, Math.sin(i * 1.57 + 0.4) * r * 1.2, r * 0.8);
    if (t === 'adhesion') for (let i = 0; i < 8; i++) {
      ctx.fillStyle = 'hsla(150, 100%, 75%, 0.8)';
      ctx.beginPath();
      ctx.arc(Math.cos(i * 0.785) * r * 1.4, Math.sin(i * 0.785) * r * 1.4, 1.4, 0, TAU);
      ctx.fill();
    }
    if (t === 'cyst') {
      ctx.strokeStyle = 'hsla(45, 80%, 70%, 0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.05, 0, TAU);
      ctx.stroke();
    }
    void h;
  } else {
    ctx.globalCompositeOperation = 'lighter';
    sprite(ctx, glowSprite(ORG_HUE[t] ?? 180), size / 2, size / 2, size);
    ctx.globalCompositeOperation = 'source-over';
    drawOrganelle(ctx, t, size / 2, size / 2, size * 0.3, -0.4);
  }
  ctx.restore();
}

export { MEMBRANE_PARTS };
