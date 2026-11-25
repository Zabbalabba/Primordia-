// In-game heads-up display: vitals, local conditions, era, pressures, toasts.

import { BIOMES } from './environment.js';
import { formatTime, clamp } from './util.js';
import { CLARITY } from './vision.js';

const $ = (id) => document.getElementById(id);

// What environmental damage is called, and what to do about it.
const HURT = {
  heat: { chip: 'Too hot', hint: '<b>Too hot here.</b> Move away from the vents, or evolve heat-shock proteins.' },
  cold: { chip: 'Too cold', hint: '<b>Too cold here.</b> Find warmer water (near vents or in the sunny shallows), or evolve antifreeze.' },
  uv: { chip: 'UV burn', hint: '<b>UV light is burning you.</b> Go deeper or into shade, or evolve pigment.' },
  o2: { chip: 'Oxygen poisoning', hint: '<b>Oxygen is poisoning you.</b> Move away from bright water full of photosynthesizers, or evolve catalase enzymes.' },
  tox: { chip: 'Sulfur poisoning', hint: '<b>Sulfur is poisoning you.</b> Move away from vents and seeps, or evolve sulfide enzymes.' },
  starving: { chip: 'Starving', hint: '<b>You are out of energy and starving.</b> Find food, or rest in the light if you photosynthesize.' },
};
const HURT_KEY = 'primordia.hudMore';

const GAUGES = [
  { key: 'temp', label: 'Temp', min: -5, max: 50, fmt: (v) => `${v.toFixed(0)}°C`, safe: (ph) => [ph.tMin, ph.tMax], margin: 3 },
  { key: 'light', label: 'Light', min: 0, max: 1.2, fmt: (v) => `${Math.round(v * 100)}%`, safe: null },
  { key: 'uv', label: 'UV', min: 0, max: 1, fmt: (v) => `${Math.round(v * 100)}%`, safe: (ph) => [0, ph.uvTol], margin: 0.08 },
  { key: 'o2', label: 'Oxygen', min: 0, max: 1, fmt: (v) => `${Math.round(v * 100)}%`, safe: (ph) => [0, ph.o2Tol], margin: 0.08 },
  { key: 'tox', label: 'Sulfur', min: 0, max: 1, fmt: (v) => `${Math.round(v * 100)}%`, safe: (ph) => [0, ph.toxTol], margin: 0.06 },
];

export class HUD {
  constructor() {
    this.el = $('hud');
    this.hintAt = {};
    // Details (cell type, sight, diet) start folded away on small screens.
    let more = window.innerWidth > 900;
    try {
      const v = localStorage.getItem(HURT_KEY);
      if (v === '1' || v === '0') more = v === '1';
    } catch {
      /* default */
    }
    this.setMore(more);
    $('hud-more-btn').addEventListener('click', () => {
      this.setMore(!this.more);
      try {
        localStorage.setItem(HURT_KEY, this.more ? '1' : '0');
      } catch {
        /* not critical */
      }
    });
    this.timer = 0;
    this.mmTimer = 0;
    this.gaugeEls = {};
    const wrap = $('env-gauges');
    wrap.innerHTML = '';
    for (const g of GAUGES) {
      const row = document.createElement('div');
      row.className = 'gauge';
      row.innerHTML = `<span class="g-label">${g.label}</span><div class="g-track"><div class="g-safe"></div><div class="g-mark"></div></div><span class="g-val"></span>`;
      wrap.appendChild(row);
      this.gaugeEls[g.key] = { row, safe: row.querySelector('.g-safe'), mark: row.querySelector('.g-mark'), val: row.querySelector('.g-val') };
    }
  }

  show(v) {
    this.el.hidden = !v;
  }

  setMore(v) {
    this.more = v;
    $('hud-more-btn').setAttribute('aria-expanded', String(v));
    $('hud-more-btn').closest('.vitals').classList.toggle('collapsed', !v);
  }

  /** The main thing hurting the player right now, or null. */
  hurtOf(p) {
    const s = p.stress || {};
    let best = null;
    let v = 0.0008;
    for (const k of ['heat', 'cold', 'uv', 'o2', 'tox']) {
      if ((s[k] || 0) > v) {
        v = s[k];
        best = k;
      }
    }
    if (!best && p.starving) return { key: 'starving', rate: p.cyst ? 0.004 : 0.025 };
    return best ? { key: best, rate: (s.total || v) * (p.cyst ? 0.1 : 1) } : null;
  }

  update(dt, world, renderer, force = false) {
    this.timer -= dt;
    this.mmTimer -= dt;
    if (this.mmTimer <= 0 || force) {
      this.mmTimer = 0.25;
      renderer.drawMinimap($('minimap'));
    }
    if (this.timer > 0 && !force) return;
    this.timer = 0.1;
    const p = world.player;
    if (!p) return;
    const ph = p.ph;
    const sp = world.playerSpecies;
    $('hud-species').textContent = sp ? sp.name : '';
    $('hud-gen').textContent = `Gen ${p.generation}`;
    $('bar-hp').style.width = `${clamp(p.hp / ph.maxHP, 0, 1) * 100}%`;
    $('bar-en').style.width = `${clamp(p.energy / ph.maxEnergy, 0, 1) * 100}%`;
    const gr = clamp(p.growth / ph.growthNeeded, 0, 1);
    $('bar-gr').style.width = `${gr * 100}%`;
    $('bar-gr').parentElement.classList.toggle('ready', gr >= 1);
    $('hud-dna').textContent = world.progress.dna;
    $('hud-lineage').textContent = sp ? sp.pop : 1;
    $('hud-diet').textContent = ph.diet;
    $('hud-sight').textContent = `Sight: ${CLARITY[ph.sight.clarity].short}`;
    const colony = world.progress.colony || 1;
    $('hud-phase').textContent = colony > 1 ? `Colony of ${colony}` : ph.euk ? 'Complex cell' : 'Simple cell';
    $('hud-phase').classList.toggle('euk', ph.euk);
    // Critical status stays visible; the rest folds away with the details.
    const status = [];
    const hurt = this.hurtOf(p);
    if (hurt) {
      const pct = Math.max(1, Math.round(hurt.rate * 100));
      status.push(`<span class="st hurt">${HURT[hurt.key].chip} · −${pct}% health/s</span>`);
      // Explain once in a while what is happening and what helps.
      const now = performance.now() / 1000;
      if (!this.hintAt[hurt.key] || now - this.hintAt[hurt.key] > 75) {
        this.hintAt[hurt.key] = now;
        this.toast(HURT[hurt.key].hint, 'bad', 6);
      }
    }
    if (p.infection) status.push(`<span class="st bad">Virus · ${Math.ceil(p.infection.t)}s</span>`);
    if (p.cyst) status.push(`<span class="st cyst">Dormant · ${Math.ceil(p.cystT)}s</span>`);
    if (p.guest) status.push(`<span class="st guest">${p.guest === 'mito' ? 'Guest: aerobic bacterium' : 'Guest: cyanobacterium'}</span>`);
    const minor = [];
    if (p.meal) minor.push('<span class="st">Digesting</span>');
    if (p.immune.size) minor.push(`<span class="st good">Immune to ${p.immune.size} virus${p.immune.size > 1 ? 'es' : ''}</span>`);
    const html = status.join('');
    if (this.statusHtml !== html) {
      $('hud-status').innerHTML = html;
      this.statusHtml = html;
    }
    const minorHtml = minor.join('');
    if (this.minorHtml !== minorHtml) {
      $('hud-status-more').innerHTML = minorHtml;
      this.minorHtml = minorHtml;
    }
    $('btn-cyst').hidden = !ph.cyst;
    $('btn-cyst').textContent = p.cyst ? 'Wake' : 'Cyst';
    const day = world.env.dayLight;
    $('hud-day').textContent = world.env.isNight ? 'Night' : day > 0.9 ? 'Midday' : 'Day';
    $('hud-day-bar').style.left = `${Math.round(((world.env.time / 240 + 0.1) % 1) * 100)}%`;
    $('btn-divide').hidden = !(gr >= 1);
    $('btn-toxin').hidden = !(ph.toxin > 0);
    $('btn-toxin').classList.toggle('touch-key', true);
    $('btn-toxin').disabled = p.toxinCd > 0;

    const e = p.env;
    $('hud-biome').textContent = BIOMES[world.env.classify(e)].name;
    for (const g of GAUGES) {
      const el = this.gaugeEls[g.key];
      const v = e[g.key] ?? 0;
      const pos = (x) => clamp((x - g.min) / (g.max - g.min), 0, 1) * 100;
      el.mark.style.left = `${pos(v)}%`;
      el.val.textContent = g.fmt(v);
      if (g.safe) {
        const [a, b] = g.safe(ph);
        el.safe.style.left = `${pos(a)}%`;
        el.safe.style.width = `${pos(b) - pos(a)}%`;
        el.safe.hidden = false;
        const bad = v < a || v > b;
        const near = !bad && ((g.key === 'temp' && v < a + g.margin && a > g.min) || v > b - g.margin);
        el.row.classList.toggle('bad', bad);
        el.row.classList.toggle('near', near);
      } else {
        el.safe.hidden = true;
        el.row.classList.remove('bad', 'near');
      }
    }

    const env = world.env;
    $('hud-era').textContent = env.eraInfo.name;
    $('hud-era-bar').style.width = `${clamp(env.eraElapsed / env.era.duration, 0, 1) * 100}%`;
    $('hud-era-next').textContent = env.nextEraInfo.name;
    $('hud-era-time').textContent = formatTime(env.eraRemaining);
    $('hud-era-next').parentElement.classList.toggle('soon', env.eraRemaining < 60);

    const list = $('pressure-list');
    const top = world.pressures.topLive(4);
    if (!top.length) list.innerHTML = '<div class="muted">None right now.</div>';
    else
      list.innerHTML = top
        .map((p) => `<div class="pressure"><span>${p.label}</span><div class="p-track"><i style="width:${Math.round(p.value * 100)}%;background:${p.color}"></i></div></div>`)
        .join('');
  }

  toast(html, cls = '', dur = 4.5) {
    const box = $('toasts');
    const t = document.createElement('div');
    t.className = `toast ${cls}`;
    t.innerHTML = html;
    box.appendChild(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 450);
    }, dur * 1000);
  }
}
