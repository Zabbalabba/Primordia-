// Ecosystem overview (population chart, species list, events) and milestones.

import { drawCell } from './cellDraw.js';
import { formatTime } from './util.js';
import { ERAS } from './environment.js';

const $ = (id) => document.getElementById(id);

// Milestones follow the path of the stage: a simple cell, the partnership
// that makes a complex cell, then a colony. The colony is the finale.
export const GOALS = [
  { id: 'divide', chapter: 'Simple cell', text: 'Divide for the first time', done: (w) => w.progress.divisions >= 1 },
  { id: 'sense', chapter: 'Simple cell', text: 'Evolve chemoreceptors to sense food and danger', done: (w) => !!w.player && w.player.ph.counts.chemoreceptor > 0 },
  { id: 'gene', chapter: 'Simple cell', text: 'Absorb a gene from another species', done: (w) => w.progress.genesAcquired >= 1 },
  { id: 'era', chapter: 'Simple cell', text: 'Survive a change of era', done: (w) => w.progress.erasSurvived >= 1 },
  { id: 'virus', chapter: 'Simple cell', text: 'Survive a virus infection', done: (w) => w.progress.virusesSurvived >= 1 },
  { id: 'partner', chapter: 'Complex cell', text: 'Take in a partner and become a complex cell', done: (w) => w.progress.eukaryote },
  { id: 'engulf', chapter: 'Complex cell', text: 'Engulf another cell whole', done: (w) => w.progress.engulfed >= 1 },
  { id: 'sight', chapter: 'Complex cell', text: 'Evolve eyes that tell threats from prey', done: (w) => (w.player ? w.player.ph.sight.clarity : 0) >= 2 },
  { id: 'pop', chapter: 'Complex cell', text: 'Grow your lineage to 15 living cells', done: (w) => w.progress.peakLineage >= 15, prog: (w) => `${Math.min(15, w.progress.peakLineage)}/15` },
  {
    id: 'colony',
    chapter: 'Colony',
    final: true,
    text: 'Form a colony of 4 cells that stick together',
    done: (w) => w.progress.colony >= 4,
    prog: (w) => `${Math.min(4, w.progress.colony)}/4`,
  },
];

export function renderEco(world) {
  const living = world.species.living();
  $('eco-count').textContent = `· ${living.length} living, ${world.species.all().filter((s) => s.extinctAt !== null).length} extinct`;

  // Species rows.
  const box = $('eco-species');
  box.innerHTML = '';
  const playerId = world.playerSpecies ? world.playerSpecies.id : -1;
  const sorted = [...living].sort((a, b) => (b.id === playerId) - (a.id === playerId) || b.pop - a.pop);
  for (const sp of sorted.slice(0, 40)) {
    const row = document.createElement('div');
    row.className = `sp-row${sp.id === playerId ? ' you' : ''}`;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 68;
    const ctx = cv.getContext('2d');
    ctx.scale(2, 2);
    const g = sp.id === playerId && world.player ? world.player.genome : sp.ref;
    drawCell(ctx, g, 8.5, { x: 17, y: 17, heading: -Math.PI / 2, phase: sp.id }, 0.5, { wobble: 0.5, detail: true });
    row.appendChild(cv);
    const parent = sp.parentId ? world.species.get(sp.parentId) : null;
    row.insertAdjacentHTML(
      'beforeend',
      `<div><div class="sp-name">${sp.name}${sp.id === playerId ? ' (you)' : ''}</div><div class="sp-sub">${sp.diet}${parent ? ` · from ${parent.name}` : ''}</div></div>`
    );
    const spark = document.createElement('canvas');
    spark.width = 140;
    spark.height = 44;
    drawSpark(spark, sp.history, `hsl(${sp.hue}, 65%, 65%)`);
    spark.style.width = '70px';
    spark.style.height = '22px';
    row.appendChild(spark);
    row.insertAdjacentHTML('beforeend', `<div class="sp-pop">${sp.pop}</div>`);
    box.appendChild(row);
  }

  drawChart($('eco-chart'), world);

  // Goals.
  let chapter = '';
  $('eco-goals').innerHTML = GOALS.map((g) => {
    const done = g.done(world);
    const head = g.chapter !== chapter ? `<div class="g-chapter">${(chapter = g.chapter)}</div>` : '';
    return `${head}<div class="goal${done ? ' done' : ''}${g.final ? ' final' : ''}"><span class="g-check"></span><span class="g-text">${g.text}</span><span class="g-prog">${!done && g.prog ? g.prog(world) : ''}</span></div>`;
  }).join('');

  renderLineage(world);

  // Log.
  const log = world.species.log.slice(-30).reverse();
  $('eco-log').innerHTML = log.length ? log.map((l) => `<div><time>${formatTime(l.time)}</time>${l.text}</div>`).join('') : '<div>Nothing yet.</div>';
}

/** Your lineage through the generations: each body you chose when dividing. */
function renderLineage(world) {
  const box = $('eco-lineage');
  if (!box) return;
  const hist = world.progress.history;
  box.innerHTML = '';
  if (!hist.length) {
    box.innerHTML = '<div class="muted small">Divide to start your family tree.</div>';
    return;
  }
  for (const h of hist) {
    const item = document.createElement('div');
    item.className = `lin-item${h.genome.domain === 'euk' ? ' euk' : ''}`;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 88;
    const ctx = cv.getContext('2d');
    ctx.scale(2, 2);
    const r = h.genome.domain === 'euk' ? 12 + 1.5 * h.genome.size : 7 + 5 * h.genome.size;
    drawCell(ctx, h.genome, r, { x: 22, y: 22, heading: -Math.PI / 2, phase: h.gen }, 0.5, { wobble: 0.5, detail: true });
    item.appendChild(cv);
    item.insertAdjacentHTML('beforeend', `<div class="lin-gen">Gen ${h.gen}</div>${h.note ? `<div class="lin-note">${h.note}</div>` : ''}`);
    box.appendChild(item);
  }
  box.scrollLeft = box.scrollWidth;
}

function drawSpark(cv, hist, color) {
  const ctx = cv.getContext('2d');
  const w = cv.width;
  const h = cv.height;
  ctx.clearRect(0, 0, w, h);
  const data = hist.slice(-60);
  if (data.length < 2) return;
  const max = Math.max(4, ...data);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = (i / (data.length - 1)) * (w - 6) + 3;
    const y = h - 4 - (v / max) * (h - 8);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function drawChart(cv, world) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth || 600;
  const h = cv.clientHeight || 180;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const times = world.species.historyTimes;
  const pad = { l: 30, r: 8, t: 8, b: 20 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  if (times.length < 2) {
    ctx.fillStyle = '#9bb7b2';
    ctx.font = '12px Manrope, sans-serif';
    ctx.fillText('Population history appears after a few seconds of play.', pad.l, h / 2);
    return;
  }
  const t0 = times[0];
  const t1 = times[times.length - 1];
  const X = (t) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * pw;

  // Era bands.
  const eras = world.env.eraHistory;
  eras.forEach((e, i) => {
    const end = i + 1 < eras.length ? eras[i + 1].start : t1;
    if (end < t0) return;
    const x0 = X(Math.max(t0, e.start));
    const x1 = X(end);
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)';
    ctx.fillRect(x0, pad.t, x1 - x0, ph);
    ctx.fillStyle = '#60807c';
    ctx.font = '10px "JetBrains Mono", monospace';
    if (x1 - x0 > 60) ctx.fillText(ERAS[e.id].name, x0 + 4, pad.t + 11);
  });

  const all = world.species.all().filter((s) => s.history.length);
  const playerId = world.playerSpecies ? world.playerSpecies.id : -1;
  const top = [...all].sort((a, b) => Math.max(...b.history) - Math.max(...a.history)).slice(0, 7);
  if (!top.some((s) => s.id === playerId) && world.playerSpecies) top.push(world.playerSpecies);
  const n = times.length;
  let max = 5;
  for (const s of top) for (const v of s.history.slice(-n)) max = Math.max(max, v);

  // Axes.
  ctx.strokeStyle = 'rgba(170,230,220,0.12)';
  ctx.fillStyle = '#60807c';
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.lineWidth = 1;
  const step = max > 60 ? 20 : max > 25 ? 10 : 5;
  for (let v = 0; v <= max; v += step) {
    const y = pad.t + ph - (v / max) * ph;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + pw, y);
    ctx.stroke();
    ctx.fillText(String(v), 4, y + 3);
  }
  ctx.fillText(formatTime(t0), pad.l, h - 5);
  const endLabel = formatTime(t1);
  ctx.fillText(endLabel, pad.l + pw - ctx.measureText(endLabel).width, h - 5);

  for (const s of top) {
    const hist = s.history.slice(-n);
    const offset = n - hist.length;
    const you = s.id === playerId;
    ctx.strokeStyle = you ? '#3dffe2' : `hsla(${s.hue}, 100%, 62%, 0.8)`;
    ctx.lineWidth = you ? 2.5 : 1.5;
    ctx.beginPath();
    hist.forEach((v, i) => {
      const x = X(times[i + offset]);
      const y = pad.t + ph - (v / max) * ph;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}
