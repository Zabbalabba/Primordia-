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
    // Plain seconds spent in each situation, for the reasons shown to the
    // player (gen holds weighted values for choosing offers).
    this.secs = {};
    this.hits = 0;
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

    // Seconds actually hurt (hit*) or close to a limit (near*), and so on.
    const secs = this.secs;
    const add = (key, on) => {
      if (on) secs[key] = (secs[key] || 0) + dt;
    };
    for (const key of ['cold', 'heat', 'uv', 'o2', 'tox']) {
      add(`hit_${key}`, s[key] > 0);
      add(`near_${key}`, inst[key] > 0);
    }
    add('lowEnergy', cell.energy < ph.maxEnergy * 0.2);
    add('starving', cell.energy <= 0.01);
    add('light', inst.light > 0);
    add('night', inst.night > 0);
    add('sulfur', inst.sulfur > 0);
    add('oxygen', inst.oxygen > 0);
    add('dark', inst.dark > 0);
    add('chased', inst.chased > 0);
    add('preyNear', inst.preyNear > 0);
    add('infected', inst.virus > 0);

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
    this.hits = (this.hits || 0) + 1;
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

  /** Share of this generation's time spent in a situation (0..1). */
  time(key) {
    return this.genTime > 0 ? Math.min(1, ((this.secs || {})[key] || 0) / this.genTime) : 0;
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
    // Reasons quote plain time shares, and only facts that really happened.
    const T = (k) => this.time(k);
    const pc = (v) => `${Math.max(1, Math.round(v * 100))}%`;
    const hits = this.hits || 0;
    const dir = this.mainAttackDir();
    const dirAngle = dir === 'rear' ? Math.PI : dir === 'side' ? Math.PI / 2 : 0;
    const dirText = dir ? { front: 'from the front', side: 'from the side', rear: 'from behind' }[dir] : '';
    const SPONT = 'A spontaneous mutation.';
    const pool = [];
    const part = (t, w, reason, angle) => {
      if (!canAddPart(genome, t) || w <= 0 || PARTS[t].symbiont) return;
      pool.push({ kind: 'part', part: t, w, reason, angle });
    };
    // "X hurt you for N% of the time", or "came close to your limit".
    const envReason = (key, hurtText, nearText) => {
      const hit = T(`hit_${key}`);
      const near = T(`near_${key}`);
      if (hit >= 0.02) return hurtText(pc(hit));
      if (near >= 0.02) return nearText(pc(near));
      return SPONT;
    };

    part('antifreeze', f('cold') * 6, envReason('cold', (p) => `Cold water hurt you ${p} of this generation.`, (p) => `You spent ${p} of this generation close to your cold limit.`));
    part('heatshock', f('heat') * 6, envReason('heat', (p) => `Hot water hurt you ${p} of this generation.`, (p) => `You spent ${p} of this generation close to your heat limit.`));
    part('pigment', f('uv') * 6, envReason('uv', (p) => `Ultraviolet light burned you ${p} of this generation.`, (p) => `UV light was close to your limit ${p} of this generation.`));
    part('catalase', f('o2') * 6, envReason('o2', (p) => `Oxygen poisoned you ${p} of this generation.`, (p) => `Oxygen was close to your limit ${p} of this generation.`));
    part('detox', f('tox') * 6, envReason('tox', (p) => `Sulfur poisoned you ${p} of this generation.`, (p) => `Sulfur was close to your limit ${p} of this generation.`));
    part('crispr', f('virus') * 5, 'A virus got into your cell. A genetic memory of viruses would make you immune to strains you survive.');
    part('capsule', f('virus') * 2.5, 'A virus got into your cell. A slime capsule makes it hard for viruses to attach.');

    const pred = f('predation');
    const hitText = hits > 0 ? `Predators hit you ${hits} time${hits > 1 ? 's' : ''}${dirText ? `, mostly ${dirText}` : ''}.` : T('chased') > 0.02 ? `Predators chased you ${pc(T('chased'))} of this generation.` : '';
    // Any hit counts, even a single one early in a long generation.
    const pw = Math.max(pred, hits > 0 ? 0.1 + 0.03 * Math.min(hits, 10) : 0);
    if (pw > 0.02 && hitText) {
      part('armor', pw * 5 + (dir === 'rear' ? 0.5 : 0), `${hitText} A plate on that side would block most of the damage.`, dirAngle);
      part('spike', pw * 4, `${hitText} A spine on that side punishes attackers.`, dirAngle);
      part('capsule', pw * 3, `${hitText} A slippery capsule is hard to grip: lytic tips do half damage and it's harder to swallow.`);
      part('cellwall', pw * 2, `${hitText} A rigid wall makes you tougher and blunts bites.`);
      part('toxin', pw * 2, `${hitText} A toxin gland can drive them off.`, Math.PI);
      part(euk ? 'flagellum' : 'rotor', pw * 2 + f('chased') * 2, `${hitText} A flagellum means faster escapes.`, Math.PI);
      part('cyst', pw * 1.5, `${hitText} A cyst wall lets you seal up and wait them out.`);
    }
    const starve = f('starve');
    const photo = c.thylakoid + c.chloroplast > 0;
    {
      // Storage: offered for hungry stretches, or for nights without sun.
      const wHungry = starve * 3;
      const wNight = f('night') * (photo ? 2 : 0.3);
      const reason =
        wHungry >= wNight && T('lowEnergy') >= 0.03
          ? `You were low on energy ${pc(T('lowEnergy'))} of this generation. Storage granules would buffer lean stretches.`
          : T('night') >= 0.05 && photo
            ? `Night fell for ${pc(T('night'))} of this generation and your photosynthesis stopped. Storage granules bank daytime surplus for the dark.`
            : 'Storage granules would let you bank surplus energy for lean times.';
      part('storage', wHungry + wNight, reason);
    }
    part(
      'transporter',
      starve * 2 + (c.transporter === 0 ? 1 : 0),
      c.transporter === 0
        ? 'Without membrane transporters, most food you touch slips past you.'
        : T('lowEnergy') >= 0.03
          ? `You were low on energy ${pc(T('lowEnergy'))} of this generation. More transporters absorb more of the food you touch.`
          : 'More transporters absorb more of the food you touch.'
    );
    if (c.thylakoid < 3 && T('light') >= 0.05) part('thylakoid', f('light') * (1 + starve * 3), `You spent ${pc(T('light'))} of this generation in well-lit water.`);
    if (photo) part('gasvesicle', f('light') * 0.8 + 0.2, 'Gas vesicles would keep your photosynthesis floating in good light.');
    if (c.chemosynth < 2 && T('sulfur') >= 0.05) part('chemosynth', f('sulfur') * (1.5 + starve * 3), `You spent ${pc(T('sulfur'))} of this generation in sulfur-rich water.`);
    if (euk && T('oxygen') >= 0.05) part('mitochondrion', f('oxygen') * 1.2, `Oxygen was plentiful ${pc(T('oxygen'))} of this generation. More mitochondria would use it.`);
    {
      const harsh = Math.max(T('hit_cold'), T('hit_heat'), T('hit_tox'));
      part('cyst', (f('cold') + f('heat') + f('tox')) * 1.2, harsh >= 0.02 ? `Harsh water hurt you ${pc(harsh)} of this generation. A cyst wall lets you go dormant until it passes.` : 'A cyst wall would let you go dormant through bad times.');
    }
    const preyNear = T('preyNear');
    if (euk) {
      if (!c.foodvacuole) part('foodvacuole', f('preyNear') * 2 + starve + 0.6, preyNear >= 0.05 ? `Smaller cells were within reach ${pc(preyNear)} of this generation. A food vacuole lets you swallow them.` : 'A food vacuole would let you swallow smaller cells whole.');
      if (c.foodvacuole && !c.pseudopod) part('pseudopod', 1.5, 'Pseudopods would let your food vacuole wrap around prey.', 0);
      if (c.foodvacuole && c.lysosome < 2) part('lysosome', 1.2, 'Your food vacuole digests slowly. Lysosomes speed it up.');
      if (!c.cytostome && preyNear >= 0.05) part('cytostome', f('preyNear') * 1.2, `Cells your size were within reach ${pc(preyNear)} of this generation. A cytostome bites into them.`, 0);
      part('cilia', 0.5, SPONT);
      // The way to the next stage: cells that stick together.
      if (!c.adhesion && canAddPart(genome, 'adhesion') && progress && progress.eukaryote && progress.generation - progress.eukaryoteGen >= 2) {
        pool.push({ kind: 'part', part: 'adhesion', w: 1.6, reason: 'Your daughter cells keep bumping into each other. Sticky proteins could keep them together: from this division on, daughters stay attached.' });
      }
    } else {
      part('pili', 0.4, SPONT, 0);
      part('rotor', 0.35, SPONT, Math.PI);
      if (preyNear >= 0.05) part('lytic', f('preyNear') * 0.8, `Other cells were within reach ${pc(preyNear)} of this generation. A lytic tip dissolves the cells you ram.`, 0);
    }

    const [lo, hi] = sizeLimits(genome);
    if (genome.size < hi - 0.05) pool.push({ kind: 'size', delta: euk ? 0.2 : 0.1, w: 0.3 + f('cold') * 1.5 + pred * 1.5, reason: T('near_cold') >= 0.1 ? 'Larger cells hold warmth and broaden temperature tolerance.' : 'Larger cells are harder to swallow and hold more health.' });
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
    const sense = this.senseOffer(genome, pred, f('dark'), pc(T('dark')), hits);
    if (sense) {
      if (sense.guaranteed) {
        offers.push(decorate(sense, genome));
        used.add(sense.part || sense.to);
      } else pool.push(sense);
    }
    // Attacked this generation? Then one offer is always a defence.
    if (hits > 0 && hitText) {
      const defence = pool.filter((o) => o.kind === 'part' && PARTS[o.part].cat === 'Defense' && o.part !== 'crispr');
      if (defence.length) {
        const pick = rng.weighted(defence);
        pool.splice(pool.indexOf(pick), 1);
        offers.push(decorate(pick, genome));
        used.add(pick.part);
      }
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
  senseOffer(genome, pred, dark, darkPct, hits = 0) {
    const c = countParts(genome);
    if (genome.domain !== 'euk') {
      if (c.chemoreceptor === 0 && canAddPart(genome, 'chemoreceptor')) {
        const reason = hits > 0 ? 'Predators reached you before you sensed them. Receptors that taste the water would warn you, and point you toward food.' : 'Receptors that taste the water would tell you what is nearby, and point you toward food.';
        return { kind: 'part', part: 'chemoreceptor', w: 1, reason, guaranteed: true };
      }
      return null;
    }
    const eyes = genome.parts.filter((p) => PARTS[p.t].eye);
    const clarity = eyes.reduce((m, p) => Math.max(m, PARTS[p.t].tier), 0);
    const w = 0.6 + pred * 2 + dark * 1.5;
    const guaranteed = clarity < 2;
    if (clarity === 0) {
      if (!canAddPart(genome, 'eyespot')) return null;
      const reason = hits > 0 ? 'Attacks came without warning. A patch of light-sensitive pigment would let you see shapes coming.' : dark > 0.2 ? `You spent ${darkPct} of this generation in dark water.` : 'Light-sensitive pigment gathered on your membrane. You would see farther ahead.';
      return { kind: 'part', part: 'eyespot', w, reason, angle: 0.5, guaranteed };
    }
    const counts = countParts(genome);
    const best = eyes
      .filter((p) => PARTS[p.t].evolvesTo && counts[PARTS[p.t].evolvesTo] < PARTS[PARTS[p.t].evolvesTo].max)
      .sort((a, b) => PARTS[b.t].tier - PARTS[a.t].tier)[0];
    if (!best) return null;
    const to = PARTS[best.t].evolvesTo;
    const reason = to === 'eyecup' ? (hits > 0 ? 'Hunters looked just like harmless cells. A cupped eye tells them apart.' : 'Your eyespot folded into a shallow cup, so it can sense where light comes from.') : 'A clear lens formed over your eye cup, focusing a sharp image onto it.';
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
