// Selection pressure on the player's lineage. What hurt you, what you lacked
// and what you lived next to during a generation shapes which mutations appear
// when you divide (stress-induced mutation). DNA spending stays fully free.

import { PARTS } from './parts.js';
import { canAddPart, countParts, placeAngleFor, sizeLimits } from './genome.js';
import { envStress, oxygenFactor } from './biology.js';
import { BIOMES } from './environment.js';

export const PRESSURE_KEYS = {
  cold: { label: 'Cold', color: '#9fd8ff' },
  heat: { label: 'Heat', color: '#ff9b6a' },
  uv: { label: 'UV burn', color: '#e6a0ff' },
  o2: { label: 'Oxygen toxicity', color: '#7fe3ff' },
  tox: { label: 'Sulfur', color: '#e0dc5a' },
  starve: { label: 'Hunger', color: '#ffc45c' },
  predation: { label: 'Predation', color: '#ff5d73' },
  virus: { label: 'Virus', color: '#ff7ad9' },
};

function blank() {
  return {
    cold: 0, heat: 0, uv: 0, o2: 0, tox: 0, starve: 0, predation: 0, virus: 0,
    // opportunities
    light: 0, sulfur: 0, oxygen: 0, dark: 0, preyNear: 0, crowded: 0, chased: 0, night: 0,
  };
}

const tmpS = {};

export class Pressures {
  constructor() {
    this.live = blank();
    this.reset();
  }

  reset() {
    this.gen = blank();
    this.genTime = 0;
    this.attackDir = { front: 0, side: 0, rear: 0 };
    this.attackKind = { bite: 0, lytic: 0, spike: 0, toxin: 0 };
    this.biomeTime = {};
  }

  update(dt, cell, world) {
    const ph = cell.ph;
    const e = cell.env;
    const s = envStress(ph, e, tmpS);
    this.genTime += dt;
    const inst = blank();
    // Near-misses count a little too, so pressure shows before it hurts.
    inst.cold = s.cold > 0 ? 1 + s.cold * 40 : e.temp < ph.tMin + 3 ? 0.3 : 0;
    inst.heat = s.heat > 0 ? 1 + s.heat * 40 : e.temp > ph.tMax - 3 ? 0.3 : 0;
    inst.uv = s.uv > 0 ? 1 + s.uv * 40 : e.uv > ph.uvTol - 0.1 ? 0.3 : 0;
    inst.o2 = s.o2 > 0 ? 1 + s.o2 * 40 : e.o2 > ph.o2Tol - 0.1 ? 0.3 : 0;
    inst.tox = s.tox > 0 ? 1 + s.tox * 40 : e.tox > ph.toxTol - 0.08 ? 0.3 : 0;
    inst.starve = cell.energy <= 0.01 ? 1.5 : cell.energy < ph.maxEnergy * 0.2 ? 0.6 : 0;
    inst.virus = cell.infection ? 1.5 : 0;
    inst.light = (e.habitatLight ?? e.light) > 0.55 ? 1 : 0;
    inst.night = world.env.isNight ? 1 : 0;
    inst.sulfur = e.tox > 0.3 ? 1 : 0;
    inst.oxygen = oxygenFactor(e.o2) > 0.8 ? 1 : 0;
    inst.dark = (e.habitatLight ?? e.light) < 0.2 ? 1 : 0;
    inst.chased = cell.chasedBy ? 1 : 0;
    inst.preyNear = cell.preyNear ? 1 : 0;
    inst.predation = this.recentHit > 0 ? 1 + this.recentHit * 0.05 : inst.chased * 0.4;
    this.recentHit = Math.max(0, (this.recentHit || 0) - dt * 20);

    const k = 1 - Math.exp(-dt / 12);
    for (const key of Object.keys(inst)) {
      this.gen[key] += inst[key] * dt;
      this.live[key] += (inst[key] - this.live[key]) * k;
    }
    const b = world.env.classify(e);
    this.biomeTime[b] = (this.biomeTime[b] || 0) + dt;
  }

  onHit(amount, kind, relAngle, cell) {
    const frac = amount / cell.ph.maxHP;
    this.recentHit = (this.recentHit || 0) + frac * 100;
    const a = Math.abs(relAngle);
    if (a < 0.8) this.attackDir.front += frac;
    else if (a > 2.3) this.attackDir.rear += frac;
    else this.attackDir.side += frac;
    if (this.attackKind[kind] !== undefined) this.attackKind[kind] += frac;
  }

  /** Top live pressures for the HUD, 0..1. */
  topLive(n = 4) {
    return Object.keys(PRESSURE_KEYS)
      .map((k) => ({ key: k, ...PRESSURE_KEYS[k], value: Math.min(1, this.live[k] / 1.5) }))
      .filter((p) => p.value > 0.04)
      .sort((a, b) => b.value - a.value)
      .slice(0, n);
  }

  frac(key) {
    return this.genTime > 0 ? this.gen[key] / this.genTime : 0;
  }

  mainAttackDir() {
    const d = this.attackDir;
    if (d.front + d.side + d.rear < 0.05) return null;
    if (d.rear >= d.front && d.rear >= d.side) return 'rear';
    if (d.side >= d.front) return 'side';
    return 'front';
  }

  /** Three mutation offers, weighted by what this generation went through. */
  generateOffers(genome, rng, count = 3, progress = null) {
    const c = countParts(genome);
    const euk = genome.domain === 'euk';
    const f = (k) => this.frac(k);
    const pct = (k) => `${Math.round(Math.min(1, f(k)) * 100)}%`;
    const dir = this.mainAttackDir();
    const dirAngle = dir === 'rear' ? Math.PI : dir === 'side' ? Math.PI / 2 : 0;
    const dirText = dir ? { front: 'from the front', side: 'from the side', rear: 'from behind' }[dir] : '';
    const pool = [];
    const part = (t, w, reason, angle) => {
      if (!canAddPart(genome, t) || w <= 0 || PARTS[t].symbiont) return;
      pool.push({ kind: 'part', part: t, w, reason, angle });
    };

    part('antifreeze', f('cold') * 6, `You spent ${pct('cold')} of this generation in water near or below your cold limit.`);
    part('heatshock', f('heat') * 6, `You spent ${pct('heat')} of this generation in water near or above your heat limit.`);
    part('pigment', f('uv') * 6, `Ultraviolet light burned you for ${pct('uv')} of this generation.`);
    part('catalase', f('o2') * 6, `Oxygen levels were near or above your tolerance ${pct('o2')} of the time.`);
    part('detox', f('tox') * 6, `Sulfur levels were near or above your tolerance ${pct('tox')} of the time.`);
    part('crispr', f('virus') * 5, 'A virus got into your cell. A genetic memory of viruses would make you immune to strains you survive.');
    part('capsule', f('virus') * 2.5, 'A virus got into your cell. A slime capsule makes it hard for viruses to attach.');

    const pred = f('predation');
    if (pred > 0.02) {
      part('armor', pred * 5 + (dir === 'rear' ? 0.5 : 0), `Predators hit you ${dirText || 'repeatedly'}. A plate there would block most damage.`, dirAngle);
      part('spike', pred * 4, `You were attacked ${dirText || 'often'}. A spine there punishes attackers.`, dirAngle);
      part('capsule', pred * 3, 'Predators kept attacking. A slippery capsule is harder to bite or swallow.');
      part('cellwall', pred * 2, 'Predators kept attacking. A rigid wall makes you much tougher.');
      part('toxin', pred * 2, 'Predators kept attacking. A toxin gland can drive them off.', Math.PI);
      part(euk ? 'flagellum' : 'rotor', pred * 2 + f('chased') * 2, 'You were chased often. A flagellum means faster escapes.', Math.PI);
      part('cyst', pred * 1.5, 'Predators kept catching you. A cyst wall lets you seal up and wait them out.');
    }
    const starve = f('starve');
    part('storage', starve * 3 + f('night') * (c.thylakoid + c.chloroplast > 0 ? 2 : 0.3), `You were close to starving ${pct('starve')} of the time. Storage would buffer lean stretches like the night.`);
    part('transporter', starve * 2 + (c.transporter === 0 ? 1 : 0), 'Food you touched slipped past you. More transporters absorb more of it.');
    if (c.thylakoid < 3) part('thylakoid', f('light') * (1 + starve * 3), `You spent ${pct('light')} of this generation in well-lit water.`);
    if (c.thylakoid + c.chloroplast > 0) part('gasvesicle', f('light') * 0.8 + 0.2, 'Gas vesicles would keep your photosynthesis floating in good light.');
    if (c.chemosynth < 2) part('chemosynth', f('sulfur') * (1.5 + starve * 3), `You spent ${pct('sulfur')} of this generation in sulfur-rich water.`);
    if (euk) part('mitochondrion', f('oxygen') * 1.2, `Oxygen was plentiful ${pct('oxygen')} of the time. More mitochondria would use it.`);
    part('cyst', (f('cold') + f('heat') + f('tox')) * 1.2, 'Harsh water kept hurting you. A cyst wall lets you go dormant until it passes.');
    if (euk) {
      if (!c.foodvacuole) part('foodvacuole', f('preyNear') * 2 + starve + 0.6, 'Smaller cells were often within reach. A food vacuole lets you swallow them.');
      if (c.foodvacuole && !c.pseudopod) part('pseudopod', 1.5, 'Pseudopods would let your food vacuole wrap around prey.', 0);
      if (c.foodvacuole && c.lysosome < 2) part('lysosome', 1.2, 'Your food vacuole digests slowly. Lysosomes speed it up.');
      if (!c.cytostome) part('cytostome', f('preyNear') * 1.2, 'Cells your size were within reach. A cytostome bites into them.', 0);
      part('cilia', 0.5, 'A spontaneous mutation.');
      // The way to the next stage: cells that stick together.
      if (!c.adhesion && progress && progress.eukaryote && progress.generation - progress.eukaryoteGen >= 2) {
        pool.push({ kind: 'part', part: 'adhesion', w: 1.6, reason: 'Your daughter cells keep bumping into each other. Sticky proteins could keep them together.' });
      }
    } else {
      part('pili', 0.4, 'A spontaneous mutation.', 0);
      part('rotor', 0.35, 'A spontaneous mutation.', Math.PI);
      part('lytic', f('preyNear') * 0.8, 'Other cells were often within reach. A lytic tip dissolves the cells you ram.', 0);
    }

    const [lo, hi] = sizeLimits(genome);
    if (genome.size < hi - 0.05) pool.push({ kind: 'size', delta: euk ? 0.2 : 0.1, w: 0.3 + f('cold') * 1.5 + pred * 1.5, reason: f('cold') > 0.2 ? 'Larger cells hold warmth and broaden temperature tolerance.' : 'Larger cells are harder to swallow.' });
    if (genome.size > lo + 0.05) pool.push({ kind: 'size', delta: euk ? -0.2 : -0.1, w: 0.3 + starve * 2, reason: 'Smaller cells absorb food more efficiently and divide sooner.' });
    if (genome.membrane < 0.9) pool.push({ kind: 'membrane', delta: 0.2, w: 0.3 + pred * 2 + f('tox') * 1, reason: 'A thicker membrane absorbs damage.' });

    const dupable = genome.parts.map((p) => p.t).filter((t) => canAddPart(genome, t) && !PARTS[t].symbiont);
    if (dupable.length) {
      const t = rng.pick(dupable);
      pool.push({ kind: 'part', part: t, w: 0.5, reason: `Gene duplication: an extra copy of your ${PARTS[t].name.toLowerCase()}.`, dup: true });
    }

    const offers = [];
    const used = new Set();
    // Senses come quickly: a sensing offer is guaranteed until the lineage can
    // tell threats from prey (chemoreceptors, then eyes for complex cells).
    const sense = this.senseOffer(genome, pred, f('dark'), pct('dark'));
    if (sense) {
      if (sense.guaranteed) {
        offers.push(decorate(sense, genome));
        used.add(sense.part || sense.to);
      } else pool.push(sense);
    }
    while (offers.length < count && pool.length) {
      const pick = rng.weighted(pool);
      pool.splice(pool.indexOf(pick), 1);
      const key = pick.kind === 'part' ? pick.part : pick.kind === 'upgrade' ? pick.to : pick.kind + pick.delta;
      if (used.has(key)) continue;
      used.add(key);
      offers.push(decorate(pick, genome));
    }
    return offers;
  }

  /** The next step for this lineage's senses, or null. */
  senseOffer(genome, pred, dark, darkPct) {
    const c = countParts(genome);
    if (genome.domain !== 'euk') {
      if (c.chemoreceptor === 0 && canAddPart(genome, 'chemoreceptor')) {
        return { kind: 'part', part: 'chemoreceptor', w: 1, reason: 'Things kept bumping into you unannounced. Receptors that taste the water would warn you, and point you toward food.', guaranteed: true };
      }
      return null;
    }
    const eyes = genome.parts.filter((p) => PARTS[p.t].eye);
    const clarity = eyes.reduce((m, p) => Math.max(m, PARTS[p.t].tier), 0);
    const w = 0.6 + pred * 2 + dark * 1.5;
    const guaranteed = clarity < 2;
    if (clarity === 0) {
      if (!canAddPart(genome, 'eyespot')) return null;
      const reason = pred > 0.02 ? 'Attacks came without warning. A patch of light-sensitive pigment would let you see shapes coming.' : dark > 0.2 ? `You spent ${darkPct} of this generation in dark water.` : 'Light-sensitive pigment gathered on your membrane. You would see farther ahead.';
      return { kind: 'part', part: 'eyespot', w, reason, angle: 0.5, guaranteed };
    }
    const counts = countParts(genome);
    const best = eyes
      .filter((p) => PARTS[p.t].evolvesTo && counts[PARTS[p.t].evolvesTo] < PARTS[PARTS[p.t].evolvesTo].max)
      .sort((a, b) => PARTS[b.t].tier - PARTS[a.t].tier)[0];
    if (!best) return null;
    const to = PARTS[best.t].evolvesTo;
    const reason = to === 'eyecup' ? (pred > 0.02 ? 'Hunters looked just like harmless cells. A cupped eye tells them apart.' : 'Your eyespot folded into a shallow cup, so it can sense where light comes from.') : 'A clear lens formed over your eye cup, focusing a sharp image onto it.';
    return { kind: 'upgrade', from: best.t, to, angle: best.a, w, reason, guaranteed: guaranteed && to === 'eyecup' };
  }

  favouriteBiome() {
    let best = null;
    let t = 0;
    for (const [b, v] of Object.entries(this.biomeTime)) if (v > t) [best, t] = [b, v];
    return best ? BIOMES[best].name : null;
  }
}

function decorate(o, genome) {
  if (o.kind === 'part') {
    const p = PARTS[o.part];
    const angle = p.ext ? o.angle ?? placeAngleFor(o.part, genome) : 0;
    return { ...o, angle, title: p.name, effect: p.effect, cat: p.cat };
  }
  if (o.kind === 'upgrade') {
    return { ...o, title: PARTS[o.to].name, effect: `${PARTS[o.from].name} evolves: ${PARTS[o.to].effect}`, cat: 'Senses' };
  }
  if (o.kind === 'size') {
    return { ...o, title: o.delta > 0 ? 'Gigantism' : 'Dwarfism', effect: `${o.delta > 0 ? 'larger' : 'smaller'} cell`, cat: 'Body' };
  }
  return { ...o, title: 'Thick Membrane', effect: '+ health, − damage taken', cat: 'Body' };
}
