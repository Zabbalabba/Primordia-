// Genomes describe a cell's body. phenotype() turns a genome into the numbers
// the simulation uses, so every editor choice has a concrete effect, and it
// applies the interaction rules between parts (see INTERACTIONS below).

import { PARTS, PART_IDS, EXTERNAL_IDS, INTERNAL_IDS, MAX_EXTERNAL, MAX_INTERNAL, MAX_EYES, partAllowed } from './parts.js';
import { sightProfile } from './vision.js';
import { clamp, diminish, TAU, angleDiff } from './util.js';

export const SIZE_LIMITS = { pro: [0.5, 1.0], euk: [1.2, 3.0] };
export const SIZE_MIN = 0.5;
export const SIZE_MAX = 3.0;
export const BASE_RADIUS = 9;

export function makeGenome({ size = 0.7, membrane = 0.2, hue = 180, domain = 'pro', shape = 0, parts = [] } = {}) {
  return {
    size,
    membrane,
    hue,
    domain,
    shape,
    parts: parts.map((p) => ({ t: p.t, a: p.a ?? PARTS[p.t].defaultAngle ?? 0 })),
  };
}

export function cloneGenome(g) {
  return { size: g.size, membrane: g.membrane, hue: g.hue, domain: g.domain || 'pro', shape: g.shape || 0, parts: g.parts.map((p) => ({ t: p.t, a: p.a })) };
}

export function countParts(g) {
  const c = {};
  for (const id of PART_IDS) c[id] = 0;
  for (const p of g.parts) c[p.t]++;
  return c;
}

export function eyeCount(g) {
  return g.parts.filter((p) => PARTS[p.t].eye).length;
}
export function externalCount(g) {
  return g.parts.filter((p) => PARTS[p.t].ext).length;
}
export function internalCount(g) {
  return g.parts.length - externalCount(g);
}

export function canAddPart(g, t) {
  if (!partAllowed(t, g.domain || 'pro')) return false;
  const c = countParts(g);
  if (c[t] >= PARTS[t].max) return false;
  if (PARTS[t].eye && eyeCount(g) >= MAX_EYES) return false;
  if (PARTS[t].ext ? externalCount(g) >= MAX_EXTERNAL : internalCount(g) >= MAX_INTERNAL) return false;
  return true;
}

export function sizeLimits(g) {
  return SIZE_LIMITS[g.domain === 'euk' ? 'euk' : 'pro'];
}

// Interaction rules between parts, for the editor's "How your parts work
// together" list and the glowing links drawn between them. `good: false`
// marks a drawback. phenotype() applies the effects.
export const INTERACTIONS = [
  { id: 'o2', a: ['thylakoid', 'chloroplast'], b: ['mitochondrion'], good: true, text: 'Photosynthesis feeds oxygen straight to your mitochondria, so they work even in oxygen-poor water.' },
  { id: 'power', a: ['mitochondrion'], b: ['flagellum', 'cilia'], good: true, text: 'Mitochondria power your flagellum and cilia: more thrust for less energy.' },
  { id: 'digest', a: ['foodvacuole'], b: ['lysosome'], good: true, text: 'Lysosomes digest what the food vacuole takes in, faster and more fully.' },
  { id: 'engulf', a: ['pseudopod'], b: ['foodvacuole'], good: true, text: 'Pseudopods wrap prey into the food vacuole: you can engulf smaller cells whole.' },
  { id: 'current', a: ['cilia'], b: ['oralgroove'], good: true, text: 'Cilia sweep a feeding current into the oral groove: it reaches farther and eats more.' },
  { id: 'groove', a: ['oralgroove'], b: ['foodvacuole'], good: true, text: 'The oral groove feeds the food vacuole: particles are digested more fully.' },
  { id: 'float', a: ['gasvesicle'], b: ['thylakoid', 'chloroplast'], good: true, text: 'Gas vesicles keep your photosynthesis in the light.' },
  { id: 'chemotaxis', a: ['chemoreceptor'], b: ['rotor'], good: true, text: 'Chemoreceptors steer your rotary flagellum (chemotaxis): tumbles land close to where you want to go.' },
  { id: 'phototaxis', a: ['eyespot', 'eyecup', 'ocelloid'], b: ['flagellum'], good: true, text: 'Your eye guides the flagellum (phototaxis): sharper turns.' },
  { id: 'reserve', a: ['storage'], b: ['thylakoid', 'chloroplast', 'chemosynth'], good: true, text: 'Storage granules bank the surplus from photosynthesis or sulfur for the night.' },
  { id: 'dormant', a: ['cyst'], b: ['storage'], good: true, text: 'Stored reserves let you stay dormant in a cyst for longer.' },
  { id: 'immune', a: ['crispr'], b: ['lysosome'], good: true, text: 'Lysosomes help CRISPR clear infections: you survive viruses more often.' },
  { id: 'shade', a: ['pigment'], b: ['thylakoid', 'chloroplast'], good: false, text: 'Pigment shields you from UV but also shades your photosynthesis.' },
  { id: 'slime', a: ['capsule'], b: ['pili'], good: false, text: 'The slime capsule hampers your pili.' },
  { id: 'wall', a: ['cellwall'], b: ['pseudopod', 'foodvacuole'], good: false, text: 'A rigid wall stops pseudopods and engulfing.' },
];

/** Derived stats. Everything the simulation needs about a body. */
export function phenotype(g) {
  const c = countParts(g);
  const s = g.size;
  const area = s * s;
  const euk = g.domain === 'euk';
  const nParts = g.parts.length;
  const shape = euk ? 0 : g.shape || 0;
  const has = (ids) => ids.some((id) => c[id] > 0);
  const links = INTERACTIONS.filter((r) => has(r.a) && has(r.b));
  const linked = (id) => links.some((l) => l.id === id);
  const hints = [];

  // Small cells are quick and absorb well; drag grows with size (Stokes).
  const sizeSlow = 1 / (0.7 + 0.3 * s);
  const mitoBoost = linked('power') ? 1 + Math.min(0.36, 0.12 * c.mitochondrion) : 1;
  let flag = 0;
  for (const p of g.parts) if (p.t === 'flagellum') flag += 32 * (0.3 + 0.7 * Math.max(0, -Math.cos(p.a)));
  flag *= c.flagellum > 1 ? 0.8 : 1;
  const motor = {
    pili: diminish(c.pili, 16, 0.7) * (linked('slime') ? 0.65 : 1) * sizeSlow,
    rotor: diminish(c.rotor, 20, 0.6) * (1 + 0.15 * shape) * sizeSlow,
    pseudo: euk ? diminish(c.pseudopod, 9, 0.7) * (c.cellwall ? 0.3 : 1) * sizeSlow : 0,
    cilia: euk ? diminish(c.cilia, 13, 0.75) * mitoBoost * sizeSlow : 0,
    flag: euk ? flag * mitoBoost * sizeSlow : 0,
    gas: diminish(c.gasvesicle, 4, 0.8),
  };
  motor.pilusAngles = g.parts.filter((p) => p.t === 'pili').map((p) => p.a);
  motor.smooth = motor.pili + motor.pseudo + motor.cilia + motor.flag > 0;
  let turn = 1.0 + diminish(c.cilia, 0.9, 0.75) + 0.25 * c.pseudopod + 0.2 * c.pili + 0.3 * c.flagellum;
  if (linked('phototaxis')) turn *= 1.25;
  turn /= 0.6 + 0.4 * s;
  const tumbleError = c.chemoreceptor >= 2 ? 0.2 : c.chemoreceptor === 1 ? 0.42 : 1.2;
  const cruise = motor.pili * 0.5 + motor.rotor + motor.pseudo + motor.cilia + motor.flag;

  const mass = area * (1 + 0.1 * c.armor + 0.15 * c.cellwall + 0.02 * nParts);
  const maxHP = 26 * area + 14 * c.cellwall * area + 8 * c.armor * s + 20 * g.membrane * area + (euk ? 8 * area : 0);
  const energyFromLightOrSulfur = c.thylakoid + c.chloroplast + c.chemosynth > 0;
  const maxEnergy = 40 * area + 25 * c.storage * (energyFromLightOrSulfur ? 1.25 : 1);
  let partUpkeep = 0;
  for (const p of g.parts) partUpkeep += PARTS[p.t].upkeep;
  const upkeep = 0.1 * area * (euk ? 1.15 : 1) + partUpkeep * (0.8 + 0.2 * s) + 0.08 * g.membrane;

  const big = Math.max(0, s - 1.2);
  const tMin = 10 - diminish(c.antifreeze, 8, 0.7) - big * 2.5;
  const tMax = 30 + diminish(c.heatshock, 8, 0.7) + big * 2.5;

  let photo = diminish(c.thylakoid, 0.34, 0.85) + diminish(c.chloroplast, 0.55, 0.85);
  if (photo > 0) {
    photo *= 1 - Math.min(0.24, 0.08 * c.pigment);
    photo *= 1 + 0.12 * Math.min(3, c.gasvesicle);
  }
  const chemo = diminish(c.chemosynth, 0.45, 0.8);

  // Feeding.
  const svK = clamp(1.15 / (0.55 + 0.6 * s), 0.45, 1.25);
  const absorb = (0.15 + (c.transporter ? 0.2 + diminish(c.transporter, 0.25, 0.7) : 0)) * svK;
  if (s > 1.6 && c.transporter) hints.push('Large cells absorb poorly: little surface for their volume.');
  const engulf = euk && c.foodvacuole > 0 && c.pseudopod > 0 && !c.cellwall;
  const digest = c.foodvacuole ? Math.min(1, 0.45 + 0.28 * c.lysosome) : 0;
  if (c.foodvacuole && !c.lysosome) hints.push('Your food vacuole digests poorly without lysosomes.');
  if (c.foodvacuole && !c.pseudopod && !c.oralgroove) hints.push('A food vacuole needs pseudopods or an oral groove to take food in.');
  if (c.cellwall && (c.pseudopod || c.foodvacuole)) hints.push('Your cell wall blocks pseudopods and engulfing.');
  let groove = 0;
  if (euk && c.oralgroove) groove = 0.7 + (linked('current') ? 0.2 : 0) + (linked('groove') ? 0.1 : 0);
  const grooveReach = linked('current') ? 14 : 5;
  if (c.flagellum && !c.mitochondrion) hints.push('A flagellum without mitochondria is weak and costly.');
  if (c.rotor && !c.chemoreceptor) hints.push('Without chemoreceptors, your flagellum tumbles in random directions.');
  const bite = euk && c.cytostome ? (3 + 4 * s) * diminish(c.cytostome, 1, 0.65) : 0;
  const lytic = c.lytic ? (1.5 + 1.2 * s) * diminish(c.lytic, 1, 0.7) : 0;
  // Meat (cell remains): bites and engulfing digest it best, absorption manages some.
  const meatEff = Math.max(bite ? 0.9 : 0, lytic ? 0.85 : 0, engulf || groove ? digest || 0.4 : 0, absorb * 0.6);
  // Particles (algae, bacteria mats, detritus).
  const particleEff = Math.max(absorb, groove * (c.foodvacuole ? Math.max(0.75, digest) : 0.75), engulf ? digest : 0);

  const mito = diminish(c.mitochondrion, 0.18, 0.75);
  const virusResist = Math.min(0.75, (c.capsule ? 0.45 : 0) + (c.cellwall ? 0.25 : 0) + (c.crispr ? 0.3 : 0));
  const clearChance = Math.min(0.9, 0.55 + 0.1 * c.lysosome + (linked('immune') ? 0.1 : 0) + (c.crispr ? 0.1 : 0));

  const ph = {
    counts: c,
    nParts,
    euk,
    shape,
    radius: BASE_RADIUS * s,
    mass,
    motor,
    turn,
    tumbleError,
    cruise,
    maxHP,
    maxEnergy,
    upkeep,
    moveCost: 0.006,
    tMin,
    tMax,
    uvTol: 0.4 + diminish(c.pigment, 0.3, 0.75),
    o2Tol: 0.5 + diminish(c.catalase, 0.25, 0.75),
    toxTol: 0.22 + diminish(c.detox, 0.35, 0.75) + (c.cellwall ? 0.08 : 0),
    photo,
    chemo,
    mito,
    internalO2: linked('o2'),
    absorb,
    particleEff,
    meatEff,
    groove,
    grooveReach,
    engulf,
    digest,
    bite,
    lytic,
    spike: c.spike > 0 ? 5 + 4 * s : 0,
    toxin: c.toxin,
    virusResist,
    clearChance,
    crispr: c.crispr > 0,
    cyst: c.cyst > 0,
    cystTime: 18 * (1 + (linked('dormant') ? 0.5 * Math.min(2, c.storage) : 0)),
    adhesion: c.adhesion > 0,
    capsule: c.capsule > 0,
    wall: c.cellwall > 0,
    growthNeeded: 22 * area + 2.5 * nParts + (euk ? 6 : 0),
    membraneDR: 0.25 * g.membrane + (c.capsule ? 0.1 : 0) + (c.cellwall ? 0.15 : 0),
    links,
    hints,
  };
  ph.sight = sightProfile(g);
  ph.vision = ph.sight.max;
  ph.diet = dietLabel(ph);
  ph.motility = motilityLabel(ph);
  ph.topSpeed = cruise;
  return ph;
}

export function dietLabel(ph) {
  const auto = ph.photo > 0 || ph.chemo > 0;
  if (ph.bite || ph.lytic) return auto ? 'Mixotroph predator' : 'Predator';
  if (ph.engulf) return auto ? 'Mixotroph engulfer' : 'Engulfer';
  if (ph.groove) return auto ? 'Mixotroph grazer' : 'Grazer';
  if (ph.counts.transporter) return ph.photo > 0 ? 'Phototroph + absorber' : ph.chemo > 0 ? 'Chemotroph + absorber' : 'Absorber';
  if (ph.photo > 0 && ph.chemo > 0) return 'Autotroph';
  if (ph.photo > 0) return 'Phototroph';
  if (ph.chemo > 0) return 'Chemotroph';
  return 'Starving';
}

export function motilityLabel(ph) {
  const m = ph.motor;
  const kinds = [];
  if (m.flag) kinds.push('flagellum');
  if (m.cilia) kinds.push('cilia');
  if (m.rotor) kinds.push('run and tumble');
  if (m.pseudo) kinds.push('crawling');
  if (m.pili) kinds.push('twitching');
  if (!kinds.length) return m.gas ? 'drifting, floats toward light' : 'drifting';
  return kinds.join(', ');
}

/** Rough genetic distance used for speciation. */
export function genomeDistance(a, b) {
  const ca = countParts(a);
  const cb = countParts(b);
  let d = 0;
  for (const id of PART_IDS) d += Math.abs(ca[id] - cb[id]);
  d += Math.abs(a.size - b.size) * 5;
  d += Math.abs(a.membrane - b.membrane) * 2;
  if ((a.domain || 'pro') !== (b.domain || 'pro')) d += 10;
  return d;
}

// ---------------------------------------------------------------- mutation

const MUTATION_PART_WEIGHTS = {
  pili: 1.2, rotor: 0.6, gasvesicle: 0.6, pseudopod: 1, cilia: 1, flagellum: 0.5,
  transporter: 1, lytic: 0.3, oralgroove: 0.8, cytostome: 0.4, foodvacuole: 0.8, lysosome: 0.7,
  thylakoid: 0.8, chemosynth: 0.5, storage: 0.8, mitochondrion: 0.6, chloroplast: 0.3,
  capsule: 0.6, cellwall: 0.4, toxin: 0.3, spike: 0.5, armor: 0.5, crispr: 0.4,
  chemoreceptor: 0.9, eyespot: 0.8,
  pigment: 0.7, antifreeze: 0.7, heatshock: 0.7, detox: 0.6, catalase: 0.7, cyst: 0.3, adhesion: 0,
};

/**
 * Random mutation for AI-controlled lineages. `bias` maps part ids to extra
 * weight (stress-induced mutation: cells under a pressure mutate toward it).
 */
export function mutateGenome(g, rng, bias = null) {
  const m = cloneGenome(g);
  const euk = m.domain === 'euk';
  // Occasionally an existing eye evolves to the next tier.
  const upgradable = m.parts.filter((p) => PARTS[p.t].evolvesTo);
  if (upgradable.length && rng.chance(0.08 * (1 + (bias?.eyes || 0)))) {
    const p = rng.pick(upgradable);
    const next = PARTS[p.t].evolvesTo;
    if ((countParts(m)[next] || 0) < PARTS[next].max) p.t = next;
    m.hue = (m.hue + rng.float(-3, 3) + 360) % 360;
    return m;
  }
  const [lo, hi] = sizeLimits(m);
  const roll = rng.next();
  if (roll < 0.34) {
    const opts = PART_IDS.filter((id) => canAddPart(m, id) && !PARTS[id].evolvesFrom && (euk || !PARTS[id].symbiont)).map((id) => ({
      id,
      w: (MUTATION_PART_WEIGHTS[id] ?? 0.5) * (1 + (bias?.[id] || 0)),
    }));
    if (opts.length) {
      const pick = rng.weighted(opts).id;
      m.parts.push({ t: pick, a: placeAngleFor(pick, m, rng) });
    }
  } else if (roll < 0.52) {
    if (m.parts.length > 1) {
      const idx = rng.int(0, m.parts.length - 1);
      const removed = m.parts[idx];
      // Never strip a complex cell of its last mitochondrion.
      if (!(removed.t === 'mitochondrion' && countParts(m).mitochondrion <= 1)) m.parts.splice(idx, 1);
    }
  } else if (roll < 0.66) {
    const ext = m.parts.filter((p) => PARTS[p.t].ext);
    if (ext.length) {
      const p = rng.pick(ext);
      p.a = normAngle(p.a + rng.float(-0.8, 0.8));
    }
  } else if (roll < 0.82) {
    m.size = clamp(m.size * (1 + rng.float(-0.12, 0.12)), lo, hi);
  } else if (roll < 0.9) {
    if (euk) m.membrane = clamp(m.membrane + rng.float(-0.15, 0.15), 0, 1);
    else m.shape = clamp((m.shape || 0) + rng.float(-0.25, 0.25), 0, 1);
  } else {
    m.hue = (m.hue + rng.float(-25, 25) + 360) % 360;
  }
  m.hue = (m.hue + rng.float(-3, 3) + 360) % 360;
  return m;
}

/** A simple cell takes in a partner and becomes a complex cell. */
export function eukaryotize(g, rng = null) {
  const m = cloneGenome(g);
  m.domain = 'euk';
  m.size = Math.max(1.35, m.size * 1.8);
  m.shape = 0;
  m.membrane = Math.max(m.membrane, 0.2);
  // Twitching pili and bacterial flagella are lost; transporters stay.
  m.parts = m.parts.filter((p) => partAllowed(p.t, 'euk'));
  m.parts.push({ t: 'mitochondrion', a: 0 });
  if (rng) {
    // AI lineages pick up a way of eating and moving that suits a complex cell.
    const kit = rng.pick([
      ['pseudopod', 'foodvacuole', 'lysosome'],
      ['cilia', 'oralgroove', 'foodvacuole'],
      ['cilia', 'cilia', 'oralgroove'],
    ]);
    for (const t of kit) if (canAddPart(m, t)) m.parts.push({ t, a: placeAngleFor(t, m, rng) });
  }
  return m;
}

export function normAngle(a) {
  return angleDiff(a, 0);
}

/** Sensible default angle for a newly added part, avoiding overlap. */
export function placeAngleFor(t, g, rng = null) {
  const def = PARTS[t].defaultAngle ?? 0;
  if (!PARTS[t].ext) return rng ? rng.float(-Math.PI, Math.PI) : 0;
  const same = g.parts.filter((p) => (PARTS[t].eye ? PARTS[p.t].eye : p.t === t));
  const candidates =
    PARTS[t].eye && t !== 'ocelloid'
      ? [0.5, -0.5, 1.1, -1.1, 0, 1.7, -1.7]
      : [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.8, -1.8].map((o) => def + o);
  for (const c of candidates) {
    const a = normAngle(c);
    if (!same.some((p) => Math.abs(angleDiff(p.a, a)) < 0.3)) return a;
  }
  return rng ? rng.float(-Math.PI, Math.PI) : def;
}

// ---------------------------------------------------------------- naming

const GENUS_A = ['Proto', 'Vora', 'Cilo', 'Thal', 'Ama', 'Nyx', 'Lumi', 'Pela', 'Sulfo', 'Kryo', 'Halo', 'Mira', 'Gloe', 'Rhizo', 'Xeno', 'Ocu', 'Bathy', 'Pyro', 'Aero', 'Micro', 'Lepto', 'Strepto', 'Cyano', 'Glido', 'Vibri'];
const GENUS_B = ['ella', 'ium', 'ax', 'ora', 'ix', 'onia', 'ula', 'ops', 'cyst', 'bion', 'monas', 'coccus', 'bacter', 'zoon', 'stoma'];

export function genusName(rng) {
  return rng.pick(GENUS_A) + rng.pick(GENUS_B);
}

export function epithetFor(g, rng) {
  const c = countParts(g);
  const opts = [];
  if (c.spike >= 2) opts.push('spinosus', 'aculeatus');
  if (c.armor >= 2) opts.push('armatus', 'loricatus');
  if (c.cytostome || c.lytic) opts.push('rapax', 'vorax', 'mordax');
  if (c.pseudopod && c.foodvacuole) opts.push('vorans', 'amoeboides');
  if (c.thylakoid + c.chloroplast >= 2) opts.push('viridis', 'lucifer', 'solaris');
  if (c.chemosynth >= 1) opts.push('sulfuricus', 'abyssalis');
  if (c.antifreeze >= 1) opts.push('glacialis', 'frigidus', 'borealis');
  if (c.heatshock >= 1) opts.push('thermophilus', 'calidus');
  if (c.eyespot + c.eyecup + c.ocelloid >= 2) opts.push('oculatus', 'argus');
  if (c.ocelloid >= 1) opts.push('perspicax', 'lynceus');
  if (c.toxin >= 1) opts.push('toxicus', 'venenosus');
  if (c.rotor || c.flagellum >= 1) opts.push('velox', 'celer');
  if (c.cilia >= 3) opts.push('ciliatus', 'hirsutus');
  if (c.pili >= 2) opts.push('pilosus', 'tractor');
  if (c.pigment >= 1) opts.push('fuscus', 'rubens');
  if (c.catalase >= 1 || c.mitochondrion) opts.push('aerobius', 'oxyphilus');
  if (c.capsule) opts.push('mucosus');
  if (c.gasvesicle) opts.push('natans', 'flotans');
  if (g.size > 2) opts.push('magnus', 'gigas');
  if (g.size < 0.6) opts.push('minimus', 'pusillus');
  if (!opts.length) opts.push('vulgaris', 'simplex', 'communis', 'primus');
  return rng.pick(opts);
}

export function speciesName(g, rng, genus = null) {
  return `${genus || genusName(rng)} ${epithetFor(g, rng)}`;
}

// ---------------------------------------------------------------- presets

const P = Math.PI;

/** Starting body choices for the player: all simple cells. */
export const PLAYER_STARTS = {
  shallows: {
    label: 'Sunlit Shallows',
    blurb: 'A photosynthetic microbe in bright water. Plenty of light by day, harsh UV, and many competitors.',
    biome: 'shallows',
    genome: makeGenome({ size: 0.7, shape: 0.3, hue: 172, parts: [{ t: 'transporter' }, { t: 'thylakoid' }, { t: 'pili', a: 0 }] }),
  },
  vents: {
    label: 'Hydrothermal Vents',
    blurb: 'A heat-loving microbe that feeds on sulfur. Dark and dangerous, but rich, and night never matters.',
    biome: 'vents',
    genome: makeGenome({ size: 0.7, shape: 0.5, hue: 22, parts: [{ t: 'chemosynth' }, { t: 'heatshock' }, { t: 'detox' }, { t: 'pili', a: 0 }] }),
    unlocks: ['chemosynth', 'heatshock', 'detox'],
  },
  frigid: {
    label: 'Frigid Waters',
    blurb: 'A hardy absorber of the cold currents. Food drifts in, predators are rare, and the water is thick.',
    biome: 'frigid',
    genome: makeGenome({ size: 0.8, shape: 0, hue: 205, parts: [{ t: 'transporter' }, { t: 'antifreeze' }, { t: 'storage' }, { t: 'pili', a: 0 }] }),
    unlocks: ['antifreeze'],
  },
};

/** Founding species: the world starts with simple cells only. */
export const FOUNDERS = [
  {
    name: 'Cyanella primus',
    biome: 'shallows',
    count: 40,
    genome: makeGenome({ size: 0.6, shape: 0.3, hue: 112, parts: [{ t: 'thylakoid' }, { t: 'thylakoid' }, { t: 'gasvesicle' }, { t: 'pigment' }] }),
  },
  {
    name: 'Glidomonas vulgaris',
    biome: 'shallows',
    count: 30,
    genome: makeGenome({ size: 0.65, shape: 0.5, hue: 48, parts: [{ t: 'transporter' }, { t: 'transporter' }, { t: 'pili', a: 0 }, { t: 'pili', a: 0.6 }] }),
  },
  {
    name: 'Vibrella velox',
    biome: 'twilight',
    count: 22,
    genome: makeGenome({ size: 0.55, shape: 0.85, hue: 190, parts: [{ t: 'rotor', a: P }, { t: 'transporter' }, { t: 'chemoreceptor' }] }),
  },
  {
    name: 'Thermarchaeum ignis',
    biome: 'vents',
    count: 18,
    genome: makeGenome({ size: 0.7, shape: 0.2, hue: 28, parts: [{ t: 'chemosynth' }, { t: 'chemosynth' }, { t: 'heatshock' }, { t: 'heatshock' }, { t: 'detox' }, { t: 'cellwall' }] }),
  },
  {
    name: 'Kryobacter glacialis',
    biome: 'frigid',
    count: 16,
    genome: makeGenome({ size: 0.85, shape: 0, hue: 205, parts: [{ t: 'transporter' }, { t: 'antifreeze' }, { t: 'storage' }, { t: 'storage' }, { t: 'pili', a: 0 }, { t: 'capsule' }] }),
  },
  {
    name: 'Bdellax rapax',
    biome: 'twilight',
    count: 5,
    genome: makeGenome({ size: 0.45, shape: 0.9, hue: 345, parts: [{ t: 'rotor', a: P }, { t: 'lytic', a: 0 }, { t: 'chemoreceptor' }] }),
  },
  {
    name: 'Abyssococcus profundus',
    biome: 'abyss',
    count: 14,
    genome: makeGenome({ size: 0.75, shape: 0, hue: 240, parts: [{ t: 'transporter' }, { t: 'transporter' }, { t: 'storage' }, { t: 'capsule' }, { t: 'chemoreceptor' }] }),
  },
];

/** Complex cells that drift in once eukaryotes exist in the world. */
export const LATE_MIGRANTS = [
  {
    name: 'Amoebella vorans',
    biome: 'twilight',
    count: 4,
    genome: makeGenome({ domain: 'euk', size: 2.2, membrane: 0.25, hue: 300, parts: [{ t: 'pseudopod', a: 0 }, { t: 'pseudopod', a: 1.6 }, { t: 'foodvacuole' }, { t: 'lysosome' }, { t: 'lysosome' }, { t: 'mitochondrion' }, { t: 'chemoreceptor' }] }),
  },
  {
    name: 'Ciliella pratensis',
    biome: 'shallows',
    count: 5,
    genome: makeGenome({ domain: 'euk', size: 1.5, hue: 160, parts: [{ t: 'cilia', a: 1.4 }, { t: 'cilia', a: -1.4 }, { t: 'cilia', a: P }, { t: 'oralgroove', a: 0 }, { t: 'foodvacuole' }, { t: 'lysosome' }, { t: 'mitochondrion' }, { t: 'eyespot', a: 0.5 }] }),
  },
  {
    name: 'Euglenella viridis',
    biome: 'shallows',
    count: 5,
    genome: makeGenome({ domain: 'euk', size: 1.4, hue: 95, parts: [{ t: 'flagellum', a: P }, { t: 'eyespot', a: 0.4 }, { t: 'chloroplast' }, { t: 'chloroplast' }, { t: 'mitochondrion' }, { t: 'storage' }] }),
  },
  {
    name: 'Didinella mordax',
    biome: 'twilight',
    count: 3,
    genome: makeGenome({ domain: 'euk', size: 1.8, hue: 8, parts: [{ t: 'cilia', a: 1.5 }, { t: 'cilia', a: -1.5 }, { t: 'cytostome', a: 0 }, { t: 'foodvacuole' }, { t: 'lysosome' }, { t: 'mitochondrion' }, { t: 'eyecup', a: 0.5 }] }),
  },
];

/** Aerobic bacteria that look for a host: the ancestors of mitochondria. */
export const SYMBIONT = {
  name: 'Protomitos aerobius',
  genome: makeGenome({ size: 0.45, shape: 0.6, hue: 285, parts: [{ t: 'rotor', a: P }, { t: 'catalase' }, { t: 'transporter' }, { t: 'chemoreceptor' }] }),
};

export { TAU, EXTERNAL_IDS, INTERNAL_IDS };
