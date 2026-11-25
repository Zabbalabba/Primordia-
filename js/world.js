// The simulation: cells, food, viruses, giants, physics, metabolism, combat,
// reproduction and the player's lineage. No DOM or canvas code in here, so it
// also runs headless in Node (see tools/simtest.mjs).
//
// Physics follows life at low Reynolds number: in water, at cell size, there
// is no coasting. A cell moves only while something pushes it, and stops as
// soon as it stops. Currents carry everything.

import { Environment, WORLD_SIZE, ERAS, BIOMES } from './environment.js';
import { RNG, SpatialHash, clamp, angleDiff, lerp, TAU } from './util.js';
import { phenotype, cloneGenome, mutateGenome, eukaryotize, FOUNDERS, LATE_MIGRANTS, SYMBIONT, PLAYER_STARTS, canAddPart } from './genome.js';
import { PARTS, STARTING_UNLOCKS, EUKARYOTE_UNLOCKS } from './parts.js';
import { SpeciesRegistry } from './species.js';
import { Pressures } from './pressures.js';
import { envStress, viscosity, oxygenFactor, autotrophIncome } from './biology.js';
import { think } from './ai.js';

let nextCellId = 1;

export class Cell {
  constructor(world, genome, speciesId, x, y, opts = {}) {
    const rng = world.rng;
    this.id = nextCellId++;
    this.setGenome(genome);
    this.speciesId = speciesId;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.heading = opts.heading ?? rng.float(-Math.PI, Math.PI);
    this.hp = this.ph.maxHP;
    this.energy = opts.energy ?? this.ph.maxEnergy * 0.6;
    this.growth = opts.growth ?? rng.float(0, this.ph.growthNeeded * 0.4);
    this.age = opts.age ?? rng.float(0, 40);
    this.lifespan = opts.lifespan ?? (this.ph.euk ? rng.float(240, 340) : rng.float(170, 260));
    this.generation = opts.generation ?? 1;
    this.isPlayer = false;
    this.ctrl = { dx: 0, dy: 0, thrust: 0 };
    this.ai = { timer: rng.float(0, 0.3), wander: rng.float(-Math.PI, Math.PI), mode: 'wander' };
    this.biteCd = 0;
    this.spikeCd = 0;
    this.toxinCd = 0;
    this.engulfCd = 0;
    this.cystCd = 0;
    this.flash = 0;
    this.biteAnim = 0;
    this.phase = rng.float(0, 100);
    this.twitch = rng.float(0, 1);
    this.tumble = 0;
    this.tumbleCd = 0;
    this.env = {};
    this.stress = {};
    this.stressTotal = 0;
    this.effort = 0;
    this.thrustLevel = 0;
    this.crowd = 0;
    this.dead = false;
    this.cause = null;
    this.killer = null;
    this.chasedBy = null;
    this.guest = null; // 'mito' or 'cyano': a bacterium living inside, not yet a partner
    this.immune = new Set(opts.immune || []);
    this.infection = null;
    this.cyst = false;
    this.cystT = 0;
    this.meal = null;
    this.attachedTo = null;
    this.offset = null;
  }
  setGenome(g) {
    this.genome = g;
    this.ph = phenotype(g);
    this.r = this.ph.radius;
    this.ext = g.parts.filter((p) => PARTS[p.t].ext);
    this.grooves = g.parts.filter((p) => p.t === 'oralgroove');
  }
}

// Separate caps per food type so abundant algae can't block food in the dark.
const FOOD_CAPS = { algae: 900, bacteria: 320, detritus: 650, meat: 9999 };

const FOOD_TYPES = {
  algae: { energy: 5, r: 2.2, life: 140, meat: false },
  bacteria: { energy: 6, r: 2, life: 100, meat: false },
  detritus: { energy: 3.5, r: 1.8, life: 160, meat: false },
  meat: { energy: 7, r: 2.6, life: 50, meat: true },
};

const VIRUS_CAP = 220;

// Difficulty. Easy: hunters can't outrun you while chasing you (sprint gets
// you away), attacks hurt half as much, you grow faster, and predators stay
// rare. Normal is the harsher, more realistic pond.
export const DIFFICULTY = {
  easy: { label: 'Easy', playerDamage: 0.5, playerGrowth: 1.35, predatorShare: 0.06, chaseCap: 1.0, chaseTime: 4 },
  normal: { label: 'Normal', playerDamage: 1, playerGrowth: 1, predatorShare: 0.11, chaseCap: 0, chaseTime: 7 },
};

export class World {
  constructor(seed = (Math.random() * 1e9) | 0, opts = {}) {
    this.seed = seed;
    this.difficulty = DIFFICULTY[opts.difficulty] ? opts.difficulty : 'easy';
    this.rng = new RNG(seed);
    this.env = new Environment(seed ^ 0x5bd1e995);
    this.size = WORLD_SIZE;
    this.cells = [];
    this.food = [];
    this.clouds = [];
    this.viruses = [];
    this.giants = [];
    this.fx = [];
    this.events = [];
    this.cellHash = new SpatialHash(this.size, 60);
    this.foodHash = new SpatialHash(this.size, 40);
    this.species = new SpeciesRegistry(this);
    this.time = 0;
    this.maxCells = opts.maxCells ?? 260;
    this.foodCount = { algae: 0, bacteria: 0, detritus: 0, meat: 0 };
    this.immigrationTimer = 5;
    this.migrantTimer = 40;
    this.symbiontTimer = 20;
    this.virusTimer = 30;
    this.giantTimer = 420;
    this.eukaryotesExist = false;
    this.player = null;
    this.playerSpecies = null;
    this.symbiontSpecies = null;
    this.autopilot = !!opts.autopilot;
    this.respawnMode = 'ask'; // ask | developed | nearest | random
    this.pendingRespawn = null;
    this.oxygenTimer = 0;
    this.pressures = new Pressures();
    this.progress = {
      dna: 0,
      dnaFrac: 0,
      unlocked: new Set(STARTING_UNLOCKS),
      generation: 1,
      kills: 0,
      engulfed: 0,
      eaten: 0,
      genesAcquired: 0,
      erasSurvived: 0,
      divisions: 0,
      bornAt: 0,
      lineageDeaths: 0,
      peakLineage: 1,
      biomesThrived: new Set(),
      readyToDivide: false,
      eukaryote: false,
      eukaryoteGen: 0,
      virusesSurvived: 0,
      colony: 1,
      history: [],
    };
    this.gameOver = false;
    this._cur = { x: 0, y: 0 };
    this._tmpEnv = {};
  }

  get diff() {
    return DIFFICULTY[this.difficulty] || DIFFICULTY.easy;
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data, time: this.time });
  }

  // ------------------------------------------------------------ setup

  populate() {
    for (const f of FOUNDERS) {
      const sp = this.species.create({ name: f.name, genome: f.genome });
      for (let i = 0; i < f.count; i++) {
        const p = this.env.randomPointIn(f.biome, this.rng);
        this.addCell(cloneGenome(f.genome), sp.id, p.x, p.y);
      }
    }
    for (let i = 0; i < 500; i++) this.spawnFood(1 / 60, true);
    // A few virus strains already circulate among the commonest microbes.
    for (const sp of this.species.living().slice(0, 2)) {
      const host = this.cells.find((c) => c.speciesId === sp.id);
      if (host) this.releaseVirions(host.x, host.y, sp.id, 8);
    }
  }

  spawnPlayer(startKey, speciesName = null) {
    const start = PLAYER_STARTS[startKey] || PLAYER_STARTS.shallows;
    for (const u of start.unlocks || []) this.progress.unlocked.add(u);
    const sp = this.species.create({ name: speciesName, genome: start.genome, isPlayer: true });
    this.playerSpecies = sp;
    // Start somewhere the starting body can survive without taking damage.
    const startPh = phenotype(start.genome);
    let p = this.env.randomPointIn(start.biome, this.rng);
    for (let i = 0; i < 60 && envStress(startPh, this.env.sample(p.x, p.y, {})).total > 0; i++) {
      p = this.env.randomPointIn(start.biome, this.rng);
    }
    // A fair start: move nearby predators and viruses elsewhere.
    for (const o of this.cells) {
      if ((o.ph.bite > 0 || o.ph.lytic > 0 || o.ph.engulf) && Math.hypot(o.x - p.x, o.y - p.y) < 350) {
        const q = this.env.randomPointIn('twilight', this.rng);
        o.x = q.x;
        o.y = q.y;
      }
    }
    this.viruses = this.viruses.filter((v) => Math.hypot(v.x - p.x, v.y - p.y) > 300);
    const c = this.addCell(cloneGenome(start.genome), sp.id, p.x, p.y, { energy: 25, growth: 6, age: 0 });
    c.isPlayer = true;
    this.player = c;
    for (let i = 0; i < 3; i++) {
      this.addCell(cloneGenome(start.genome), sp.id, p.x + this.rng.float(-50, 50), p.y + this.rng.float(-50, 50), { age: 0, growth: 0 });
    }
    this.progress.history = [{ gen: 1, genome: cloneGenome(start.genome), note: 'First cell', time: 0 }];
    this.species.recount();
    return c;
  }

  addCell(genome, speciesId, x, y, opts = {}) {
    const c = new Cell(this, genome, speciesId, clamp(x, 30, this.size - 30), clamp(y, 30, this.size - 30), opts);
    this.env.sample(c.x, c.y, c.env);
    this.cells.push(c);
    if (c.ph.euk && !this.eukaryotesExist) this.markEukaryotes();
    return c;
  }

  markEukaryotes() {
    this.eukaryotesExist = true;
    this.giantTimer = Math.min(this.giantTimer, 240);
    this.emit('eukaryotes');
  }

  addFood(kind, x, y, extra = {}) {
    const fc = this.foodCount;
    if (kind !== 'meat' && fc[kind] >= FOOD_CAPS[kind]) return null;
    fc[kind]++;
    const t = FOOD_TYPES[kind];
    const f = {
      kind,
      x: clamp(x, 5, this.size - 5),
      y: clamp(y, 5, this.size - 5),
      r: t.r * (extra.scale || 1),
      energy: extra.energy ?? t.energy,
      meat: t.meat,
      age: 0,
      life: t.life * this.rng.float(0.8, 1.2),
      rot: this.rng.float(0, 6.28),
      genes: extra.genes || null,
      eaten: false,
    };
    this.food.push(f);
    return f;
  }

  spawnFood(dt, initial = false) {
    const env = this.env;
    const mods = env.mods;
    const tmp = this._tmpEnv;
    const rng = this.rng;
    // Algae follow the light, so food is thinner at night.
    const algaeAttempts = 60 * dt * mods.food;
    for (let n = algaeAttempts; n > 0; n--) {
      if (n < 1 && !rng.chance(n)) break;
      const x = rng.float(20, this.size - 20);
      const y = rng.float(20, this.size - 20);
      const e = env.sample(x, y, tmp, initial ? 0.8 : env.dayLight);
      if (rng.chance(Math.min(1, e.light * 1.2) * (e.temp > 3 ? 1 : 0.6))) this.addFood('algae', x, y);
    }
    for (const v of env.vents.concat(env.extraVents)) {
      const s = v.strength ?? 1;
      if (rng.chance(4 * s * dt * (initial ? 3 : 1))) {
        const a = rng.float(0, 6.28);
        const d = Math.abs(rng.gauss()) * 120 + 20;
        this.addFood('bacteria', v.x + Math.cos(a) * d, v.y + Math.sin(a) * d);
      }
    }
    for (const s of env.seeps) {
      if (rng.chance(1.8 * dt)) {
        const a = rng.float(0, 6.28);
        const d = Math.abs(rng.gauss()) * 110;
        this.addFood('bacteria', s.x + Math.cos(a) * d, s.y + Math.sin(a) * d);
      }
    }
    // Detritus ("marine snow") drifts everywhere, thicker in deep and cold water.
    for (let n = 14 * dt; n > 0; n--) {
      if (n < 1 && !rng.chance(n)) break;
      const x = rng.float(20, this.size - 20);
      const y = rng.float(20, this.size - 20);
      const e = env.sample(x, y, tmp);
      if (rng.chance(Math.min(1, 0.3 + 0.55 * e.depth + 1.1 * e.cold))) this.addFood('detritus', x, y);
    }
  }

  // ------------------------------------------------------------ main step

  step(dt) {
    this.time += dt;
    const env = this.env;
    const wasNight = env.isNight;
    env.update(dt);
    if (env.eraChanged) {
      const era = ERAS[env.eraChanged];
      this.emit('era', { id: env.eraChanged, name: era.name, desc: era.desc });
      if (this.player && !this.gameOver) this.progress.erasSurvived++;
    }
    if (env.isNight !== wasNight) this.emit(env.isNight ? 'night' : 'day');
    if (env.newVents) {
      this.emit('vents', { count: env.newVents.length });
      env.newVents = null;
    }

    this.spawnFood(dt);

    this.cellHash.clear();
    for (const c of this.cells) this.cellHash.insert(c);
    this.foodHash.clear();
    for (const f of this.food) this.foodHash.insert(f);

    for (const c of this.cells) {
      if (c.dead) continue;
      c.age += dt;
      env.sample(c.x, c.y, c.env);
      if (!c.attachedTo && (!c.isPlayer || this.autopilot)) think(c, this, dt);
      this.move(c, dt);
      this.metabolize(c, dt);
      c.biteCd -= dt;
      c.spikeCd -= dt;
      c.toxinCd -= dt;
      c.engulfCd -= dt;
      c.cystCd -= dt;
      c.flash = Math.max(0, c.flash - dt * 3);
      c.biteAnim = Math.max(0, c.biteAnim - dt * 4);
    }

    this.updateGiants(dt);
    this.collide();
    this.feed(dt);
    this.updateClouds(dt);
    this.updateViruses(dt);
    this.updateFood(dt);
    this.reproduce();
    this.reap();
    this.immigrate(dt);
    this.shareColony(dt);
    this.trackPlayer(dt);

    this.oxygenTimer -= dt;
    if (this.oxygenTimer <= 0) {
      this.oxygenTimer = 1;
      env.relaxOxygen(1);
    }
    this.species.tick(dt);

    for (const f of this.fx) f.t += dt;
    this.fx = this.fx.filter((f) => f.t < (f.life || 0.8));
  }

  // ------------------------------------------------------------ movement

  move(c, dt) {
    if (c.attachedTo) return this.followAnchor(c);
    const ph = c.ph;
    const m = ph.motor;
    const ctl = c.ctrl;
    const visc = viscosity(c.env.temp);
    const len = Math.hypot(ctl.dx, ctl.dy);
    const want = len > 0.05 && ctl.thrust > 0 && !c.cyst;
    const boost = ctl.boost && c.energy > 2 ? 1.45 : 1;
    const t = clamp(ctl.thrust, 0, 1) * boost * (c.meal ? 0.6 : 1) * (c.infection ? 0.8 : 1);
    const dirx = want ? ctl.dx / len : 0;
    const diry = want ? ctl.dy / len : 0;
    const desired = want ? Math.atan2(diry, dirx) : c.heading;
    let tx = 0;
    let ty = 0;
    let effort = 0;
    // A colony swims a bit better than a lone cell: more motors, more drag.
    const colonyK = c.colony ? (1 + 0.3 * c.colony) / (1 + 0.2 * c.colony) : 1;

    // Smooth steering for pili, pseudopods, cilia and flagella.
    if (want && m.smooth) {
      const maxTurn = (ph.turn * dt) / Math.sqrt(visc);
      c.heading += clamp(angleDiff(desired, c.heading), -maxTurn, maxTurn);
    }
    const dev = angleDiff(desired, c.heading);

    if (want && m.pili > 0) {
      // Twitching: pili reach out, stick and retract, in jerky pulls.
      c.twitch += dt * 1.7;
      const pulse = Math.pow(Math.max(0, Math.sin(c.twitch * TAU)), 3) * 2.4;
      let face = 0.35;
      for (const a of m.pilusAngles) face = Math.max(face, 0.35 + 0.65 * Math.max(0, Math.cos(angleDiff(dev, a))));
      const v = m.pili * pulse * face * t;
      tx += dirx * v;
      ty += diry * v;
      effort += m.pili * t;
    }
    if (m.rotor > 0) {
      // Run and tumble. Turning means stopping to tumble into a new heading.
      // Runs last a while before the motor reverses for a tumble, unless the
      // target is far off course; small errors are corrected during the run.
      c.tumbleCd -= dt;
      if (c.tumble > 0) {
        c.tumble -= dt;
        c.heading += dt * 9 * (c.tumbleDir || 1);
        if (c.tumble <= 0) c.heading = c.tumbleTarget;
      } else if (want) {
        const far = Math.abs(dev);
        if ((far > 0.8 && c.tumbleCd <= 0) || (far > 2.3 && c.tumbleCd <= 0.35)) {
          c.tumble = 0.25;
          c.tumbleCd = c.isPlayer ? 0.5 : 0.9;
          c.tumbleDir = this.rng.chance(0.5) ? 1 : -1;
          c.tumbleTarget = desired + this.rng.gauss() * ph.tumbleError;
        } else {
          // Small course corrections happen during a run.
          c.heading += clamp(dev, -0.5 * dt, 0.5 * dt);
          const v = m.rotor * t * (0.35 + 0.65 * Math.max(0, Math.cos(dev)));
          tx += Math.cos(c.heading) * v;
          ty += Math.sin(c.heading) * v;
          effort += m.rotor * t;
        }
      }
    }
    if (want && m.pseudo > 0) {
      const v = m.pseudo * t;
      tx += dirx * v;
      ty += diry * v;
      effort += m.pseudo * t;
    }
    if (want && m.cilia > 0) {
      const v = (m.cilia * t) / visc;
      tx += dirx * v;
      ty += diry * v;
      effort += m.cilia * t * 0.8;
    }
    if (want && m.flag > 0) {
      const v = m.flag * t * (0.2 + 0.8 * Math.max(0, Math.cos(dev)));
      tx += Math.cos(c.heading) * v;
      ty += Math.sin(c.heading) * v;
      effort += m.flag * t * (ph.counts.mitochondrion ? 0.8 : 1.3);
    }
    if (m.gas > 0 && ph.photo > 0 && !c.cyst) {
      // Gas vesicles: drift toward good light, away from burning UV.
      if (!c.lightDir || (c.lightTimer = (c.lightTimer || 0) - dt) <= 0) {
        c.lightTimer = 0.6;
        const e = this._tmpEnv;
        const lx = this.env.sample(c.x + 40, c.y, e).light - this.env.sample(c.x - 40, c.y, e).light;
        const ly = this.env.sample(c.x, c.y + 40, e).light - this.env.sample(c.x, c.y - 40, e).light;
        const l = Math.hypot(lx, ly) || 1;
        const away = c.stress.uv > 0 ? -1 : 1;
        c.lightDir = { x: (lx / l) * away, y: (ly / l) * away, on: Math.hypot(lx, ly) > 0.01 };
      }
      if (c.lightDir.on) {
        tx += c.lightDir.x * m.gas;
        ty += c.lightDir.y * m.gas;
      }
    }
    // Brownian jiggle: tiny cells are buffeted by water molecules.
    const jig = 2.2 / Math.max(0.5, ph.radius / 9);
    tx += this.rng.gauss() * jig;
    ty += this.rng.gauss() * jig;

    tx *= colonyK;
    ty *= colonyK;
    c.effort = effort * (boost > 1 ? 2 : 1);
    c.thrustLevel = lerp(c.thrustLevel, want ? Math.min(1.5, t) : 0, 0.15);
    // No coasting: velocity snaps toward what the motors deliver.
    const k = 1 - Math.exp(-(10 / Math.sqrt(visc)) * dt);
    c.vx += (tx - c.vx) * k;
    c.vy += (ty - c.vy) * k;
    const cur = this.env.current(c.x, c.y, this._cur);
    const cf = 1 / (0.8 + 0.25 * ph.radius / 9);
    c.x += (c.vx + cur.x * cf) * dt;
    c.y += (c.vy + cur.y * cf) * dt;
    const mrg = c.r + 4;
    c.x = clamp(c.x, mrg, this.size - mrg);
    c.y = clamp(c.y, mrg, this.size - mrg);
  }

  followAnchor(c) {
    const a = c.attachedTo;
    if (!a || a.dead) {
      c.attachedTo = null;
      return;
    }
    const ang = a.heading + c.offset.a;
    c.x = a.x + Math.cos(ang) * c.offset.d;
    c.y = a.y + Math.sin(ang) * c.offset.d;
    c.vx = a.vx;
    c.vy = a.vy;
    c.heading = a.heading + c.offset.h;
    c.thrustLevel = a.thrustLevel;
    c.effort = 0;
  }

  metabolize(c, dt) {
    const ph = c.ph;
    const e = c.env;
    const area = (ph.radius / 9) ** 2;
    const eff = 1 - ph.mito * oxygenFactor(e.o2, ph.internalO2);
    let gain = 0;
    const shade = 1 / (1 + 0.2 * Math.max(0, c.crowd - 1));
    if (!c.cyst) {
      if (ph.photo > 0) {
        const g = ph.photo * Math.min(e.light, 1.2) * shade;
        gain += g;
        this.env.addOxygen(c.x, c.y, g * dt * 0.0016);
      }
      if (ph.chemo > 0) gain += ph.chemo * Math.min(e.tox * 1.6, 1) * shade;
      // A guest bacterium shares a little of what it makes.
      if (c.guest === 'mito') gain += 0.05 * oxygenFactor(e.o2);
      if (c.guest === 'cyano') gain += 0.08 * Math.min(1, e.light);
    }
    // Digesting an engulfed meal.
    if (c.meal) {
      const take = Math.min(c.meal.left, c.meal.rate * dt);
      c.meal.left -= take;
      c.energy += take;
      if (c.meal.left <= 0.01) c.meal = null;
    }
    c.gain = gain;
    const dormant = c.cyst ? 0.15 : 1;
    const cost = (ph.upkeep * dormant + c.effort * ph.moveCost) * eff;
    c.energy += (gain - cost) * dt;

    // Viral infection: the virus hijacks the cell until it is cleared or the cell bursts.
    if (c.infection) {
      c.infection.t -= dt;
      c.energy -= 0.35 * area * dt;
      c.growth = Math.max(0, c.growth - 0.4 * dt);
      if (c.infection.t <= 0) this.resolveInfection(c);
    }

    const s = envStress(ph, e, c.stress);
    let rate = s.total * (c.cyst ? 0.1 : 1);
    c.starving = false;
    if (c.energy <= 0) {
      c.energy = 0;
      rate += c.cyst ? 0.004 : 0.025;
      c.starving = true;
    }
    c.stressTotal = s.total;
    const sm = c.sm || (c.sm = { cold: 0, heat: 0, uv: 0, o2: 0, tox: 0 });
    const km = Math.min(1, dt / 20);
    sm.cold += (s.cold - sm.cold) * km;
    sm.heat += (s.heat - sm.heat) * km;
    sm.uv += (s.uv - sm.uv) * km;
    sm.o2 += (s.o2 - sm.o2) * km;
    sm.tox += (s.tox - sm.tox) * km;
    if (rate > 0) {
      c.hp -= rate * ph.maxHP * dt;
      if (c.hp <= 0 && !c.cause) c.cause = c.starving && s.total < 0.01 ? 'starvation' : mainStress(s);
    }
    if (c.cyst) {
      c.cystT -= dt;
      if (c.cystT <= 0 || (c.wakeQueued && ph.cystTime - c.cystT >= 2)) this.setCyst(c, false);
    } else if (c.energy > ph.maxEnergy * 0.25 && c.hp < ph.maxHP) {
      const heal = Math.min(ph.maxHP - c.hp, 0.03 * ph.maxHP * dt);
      c.hp += heal;
      c.energy -= heal * 0.25;
    }
    // Surplus energy becomes growth toward division (colony members don't divide).
    const reserve = ph.maxEnergy * 0.4;
    if (!c.attachedTo && !c.cyst && c.energy > reserve && c.growth < ph.growthNeeded) {
      const tr = Math.min(c.energy - reserve, (0.5 + 0.6 * Math.sqrt(area)) * dt * (c.isPlayer ? this.diff.playerGrowth : 1));
      c.growth += tr;
      c.energy -= tr;
    }
    if (c.energy > ph.maxEnergy) {
      if (!c.attachedTo) c.growth = Math.min(ph.growthNeeded, c.growth + (c.energy - ph.maxEnergy) * 0.8);
      c.energy = ph.maxEnergy;
    }
    if (c.age > c.lifespan * (c.isPlayer ? 1.6 : 1) && !c.cyst) {
      c.hp = 0;
      c.cause = c.cause || 'old age';
    }
  }

  // ------------------------------------------------------------ abilities

  /** Seal into a dormant cyst, or wake up from one. */
  setCyst(c, on) {
    if (on) {
      if (!c.ph.cyst || c.cyst || c.cystCd > 0 || c.energy < 3 || c.attachedTo) return false;
      c.cyst = true;
      c.cystT = c.ph.cystTime;
      c.energy -= 3;
      c.meal = null;
      if (c.isPlayer) this.emit('cyst', { on: true, time: c.cystT });
      return true;
    }
    if (!c.cyst) return false;
    c.cyst = false;
    c.wakeQueued = false;
    c.cystCd = 6;
    if (c.isPlayer) this.emit('cyst', { on: false });
    return true;
  }

  toggleCyst(c) {
    if (c.cyst) {
      // Waking takes a moment: cysts last at least a couple of seconds.
      if (c.ph.cystTime - c.cystT < 2) {
        c.wakeQueued = true;
        return false;
      }
      return this.setCyst(c, false);
    }
    return this.setCyst(c, true);
  }

  releaseToxin(c) {
    if (c.ph.toxin <= 0 || c.toxinCd > 0 || c.energy < 4 || c.cyst) return false;
    c.toxinCd = 7;
    c.energy -= 4;
    const gland = c.ext.find((p) => p.t === 'toxin');
    const a = c.heading + (gland ? gland.a : Math.PI);
    this.clouds.push({
      x: c.x + Math.cos(a) * c.r * 1.3,
      y: c.y + Math.sin(a) * c.r * 1.3,
      r: 5,
      maxR: 32 + 14 * c.ph.toxin,
      t: 0,
      life: 4.5,
      power: c.ph.toxin,
      speciesId: c.speciesId,
      owner: c,
    });
    if (c.isPlayer) this.emit('toxin');
    return true;
  }

  // ------------------------------------------------------------ interactions

  collide() {
    for (const a of this.cells) {
      if (a.dead) continue;
      this.cellHash.query(a.x, a.y, a.r + 40, (b) => {
        if (b.id <= a.id || b.dead || a.dead) return;
        // Colony members are held in place by their anchor.
        if (a.attachedTo === b || b.attachedTo === a || (a.attachedTo && a.attachedTo === b.attachedTo)) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 0.0001) return;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const overlap = min - d;
        const ma = a.attachedTo ? 1e6 : a.ph.mass;
        const mb = b.attachedTo ? 1e6 : b.ph.mass;
        const tm = ma + mb;
        if (!a.attachedTo) {
          a.x -= nx * overlap * (mb / tm);
          a.y -= ny * overlap * (mb / tm);
        }
        if (!b.attachedTo) {
          b.x += nx * overlap * (ma / tm);
          b.y += ny * overlap * (ma / tm);
        }
        const closing = Math.max(0, -((b.vx - a.vx) * nx + (b.vy - a.vy) * ny));
        this.contact(a, b, nx, ny, d, closing);
        this.contact(b, a, -nx, -ny, d, closing);
      });
    }
  }

  /** Effects of A touching B. (nx, ny) points from A to B. */
  contact(A, B, nx, ny, d, closing) {
    if (A.dead || B.dead || A.cyst) return;
    // A host-seeking aerobic bacterium slips inside a simple cell.
    const spA = this.species.get(A.speciesId);
    if (spA && spA.symbiont && !B.ph.euk && !B.guest && B.speciesId !== A.speciesId && B.r > A.r * 1.15 && !B.cyst) {
      // Most encounters end with the bacterium digested or pushed out; the
      // lasting partnership was rare. The player's lineage is the exception.
      if (!B.isPlayer && !this.rng.chance(0.12)) return;
      B.guest = 'mito';
      A.hp = 0;
      A.dead = true;
      A.cause = 'symbiosis';
      if (B.isPlayer) this.emit('guest', { kind: 'mito' });
      this.fx.push({ type: 'divide', x: B.x, y: B.y, t: 0, life: 0.6, hue: 285 });
      return;
    }
    if (A.speciesId === B.speciesId) return;
    const angTo = angleDiff(Math.atan2(ny, nx), A.heading);
    const halfW = Math.asin(Math.min(1, B.r / Math.max(d, B.r)));

    // Engulfing: wrap a smaller cell into the food vacuole.
    if (A.ph.engulf && A.engulfCd <= 0 && !A.meal && !B.cyst && !B.attachedTo && B.r < A.r * 0.58 && (A.isPlayer || A.ai.mode !== 'flee')) {
      A.engulfCd = 1;
      let chance = 0.65;
      if (B.ph.capsule) chance *= 0.5;
      if (B.ph.spike) chance *= 0.5;
      if (B.ph.wall) chance *= 0.8;
      if (this.rng.chance(chance)) return this.engulf(A, B);
    }
    for (const p of A.ext) {
      const part = PARTS[p.t];
      const facing = Math.abs(angleDiff(angTo, p.a)) <= (part.arc || 0.6) / 2 + halfW;
      if (!facing) continue;
      if (p.t === 'cytostome' && A.biteCd <= 0) {
        if (!A.isPlayer && A.ai.mode === 'flee') continue;
        const dealt = this.damage(B, A.ph.bite, A, 'bite');
        A.lastStrike = this.time;
        A.energy += dealt * A.ph.meatEff;
        A.biteCd = 0.7;
        A.biteAnim = 1;
        this.fx.push({ type: 'bite', x: B.x - nx * B.r, y: B.y - ny * B.r, t: 0, life: 0.4 });
      } else if (p.t === 'lytic' && A.biteCd <= 0) {
        const dealt = this.damage(B, A.ph.lytic, A, 'lytic');
        A.lastStrike = this.time;
        A.energy += dealt * 0.6;
        A.biteCd = 1.1;
        A.biteAnim = 1;
        this.fx.push({ type: 'bite', x: B.x - nx * B.r, y: B.y - ny * B.r, t: 0, life: 0.35 });
      } else if (p.t === 'spike' && A.spikeCd <= 0 && closing > 4) {
        this.damage(B, A.ph.spike * clamp(closing / 20, 0.4, 2), A, 'spike');
        A.spikeCd = 0.5;
        this.fx.push({ type: 'spark', x: A.x + nx * A.r, y: A.y + ny * A.r, t: 0, life: 0.35 });
      }
    }
  }

  engulf(A, B) {
    const value = B.ph.maxHP * 0.45 + B.energy * 0.6 + B.growth * 0.4 + 4;
    A.meal = { left: value * A.ph.digest, rate: (value * A.ph.digest) / (4 - Math.min(2, A.ph.counts.lysosome)), hue: B.genome.hue, r: B.r };
    A.biteAnim = 1;
    B.hp = 0;
    B.cause = 'engulfed';
    B.killer = A;
    B.engulfed = true;
    this.fx.push({ type: 'engulf', x: B.x, y: B.y, t: 0, life: 0.6, hue: B.genome.hue, r: B.r });
    // A swallowed cyanobacterium can survive inside and become a chloroplast.
    if (!B.ph.euk && B.ph.photo > 0 && !A.guest && A.ph.counts.chloroplast === 0 && this.rng.chance(A.isPlayer ? 0.3 : 0.05)) {
      A.guest = 'cyano';
      if (A.isPlayer) this.emit('guest', { kind: 'cyano' });
    }
    if (A.isPlayer) {
      this.progress.engulfed++;
      this.emit('engulf', { name: this.species.get(B.speciesId)?.name || 'a cell' });
    }
  }

  damage(B, amount, attacker, kind) {
    if (B.dead || amount <= 0) return 0;
    const angFrom = angleDiff(Math.atan2(attacker.y - B.y, attacker.x - B.x), B.heading);
    for (const p of B.ext) {
      if (p.t === 'armor' && Math.abs(angleDiff(angFrom, p.a)) < PARTS.armor.arc / 2) {
        amount *= 0.4;
        break;
      }
    }
    amount *= 1 - Math.min(0.6, B.ph.membraneDR);
    // Slime capsules foil lytic tips (they can't get a grip); walls blunt bites.
    if (kind === 'lytic' && B.ph.capsule) amount *= 0.5;
    if (kind === 'lytic' && B.ph.wall) amount *= 0.8;
    if (kind === 'bite' && B.ph.wall) amount *= 0.65;
    if (B.cyst) amount *= 0.2;
    if (B.isPlayer || (B.attachedTo && B.attachedTo.isPlayer)) amount *= this.diff.playerDamage;
    const dealt = Math.min(amount, B.hp);
    B.hp -= amount;
    B.flash = 1;
    B.lastHit = { speciesId: attacker.speciesId, kind, time: this.time };
    if (B.isPlayer) {
      this.pressures.onHit(amount, kind, angFrom, B);
      this.emit('playerHit', { amount, kind });
    }
    if (B.hp <= 0 && !B.cause) {
      B.cause = kind === 'toxin' ? 'poison' : 'predation';
      B.killer = attacker;
    }
    return dealt;
  }

  feed(dt) {
    for (const c of this.cells) {
      if (c.dead || c.cyst) continue;
      const ph = c.ph;
      // Cilia sweep a feeding current toward the oral groove.
      if (ph.groove && ph.counts.cilia) {
        for (const g of c.grooves) {
          const ma = c.heading + g.a;
          const mx = c.x + Math.cos(ma) * c.r;
          const my = c.y + Math.sin(ma) * c.r;
          this.foodHash.query(mx, my, 28, (f) => {
            if (f.eaten) return;
            const dx = mx - f.x;
            const dy = my - f.y;
            const d = Math.hypot(dx, dy) || 1;
            if (d > 28) return;
            f.x += (dx / d) * 10 * dt;
            f.y += (dy / d) * 10 * dt;
          });
        }
      }
      const reach = c.r + ph.grooveReach + 2;
      this.foodHash.query(c.x, c.y, reach + 4, (f) => {
        if (f.eaten) return;
        const dx = f.x - c.x;
        const dy = f.y - c.y;
        const d = Math.hypot(dx, dy);
        let eff = 0;
        const touching = d <= c.r + f.r + 1.5;
        if (touching) eff = f.meat ? ph.meatEff : Math.max(ph.absorb, ph.engulf ? ph.digest : 0);
        if (ph.groove && d <= reach + f.r) {
          const ang = angleDiff(Math.atan2(dy, dx), c.heading);
          for (const g of c.grooves) {
            if (Math.abs(angleDiff(ang, g.a)) < PARTS.oralgroove.arc / 2) {
              eff = Math.max(eff, f.meat ? ph.meatEff : ph.particleEff);
              break;
            }
          }
        }
        if (eff <= 0.05) return;
        f.eaten = true;
        c.energy += f.energy * eff;
        // Show it being drawn in, near the player (or anywhere on the title screen).
        const p = this.player;
        if (this.fx.length < 160 && (!p || (Math.abs(c.x - p.x) < 520 && Math.abs(c.y - p.y) < 520))) {
          this.fx.push({ type: 'absorb', x: f.x, y: f.y, kind: f.kind, r: f.r, rot: f.rot, cell: c, t: 0, life: c.isPlayer ? 0.55 : 0.45 });
        }
        c.biteAnim = Math.max(c.biteAnim, 0.4);
        if (c.isPlayer) this.playerAte(f, eff);
      });
    }
  }

  updateClouds(dt) {
    for (const cl of this.clouds) {
      cl.t += dt;
      cl.r = lerp(cl.r, cl.maxR, 1 - Math.exp(-dt * 2.5));
      this.cellHash.query(cl.x, cl.y, cl.r + 30, (b) => {
        if (b.dead || b.speciesId === cl.speciesId) return;
        if (Math.hypot(b.x - cl.x, b.y - cl.y) > cl.r + b.r * 0.5) return;
        const resist = clamp((b.ph.toxTol - 0.22) * 1.6, 0, 0.85);
        const fade = 1 - cl.t / cl.life;
        this.damage(b, 5 * cl.power * (1 - resist) * fade * dt, cl.owner, 'toxin');
        b.flash = Math.max(b.flash, 0.4);
      });
    }
    this.clouds = this.clouds.filter((c) => c.t < c.life);
  }

  // ------------------------------------------------------------ viruses

  releaseVirions(x, y, strain, n) {
    for (let i = 0; i < n && this.viruses.length < VIRUS_CAP; i++) {
      const a = this.rng.float(0, TAU);
      const d = this.rng.float(2, 18);
      this.viruses.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, strain, age: 0, life: this.rng.float(70, 110), phase: this.rng.float(0, 6) });
    }
  }

  updateViruses(dt) {
    const cur = this._cur;
    for (const v of this.viruses) {
      v.age += dt;
      this.env.current(v.x, v.y, cur);
      v.x = clamp(v.x + (cur.x * 0.9 + this.rng.gauss() * 3) * dt, 5, this.size - 5);
      v.y = clamp(v.y + (cur.y * 0.9 + this.rng.gauss() * 3) * dt, 5, this.size - 5);
      if (v.hit) continue;
      // Phages are host-specific: each strain only infects one species.
      this.cellHash.query(v.x, v.y, 30, (c) => {
        if (v.hit || c.dead || c.speciesId !== v.strain || c.infection || c.cyst) return;
        if (Math.hypot(c.x - v.x, c.y - v.y) > c.r + 2) return;
        v.hit = true;
        if (c.immune.has(v.strain)) return;
        if (!this.rng.chance(0.55 * (1 - c.ph.virusResist))) return;
        c.infection = { strain: v.strain, t: 16, total: 16 };
        if (c.isPlayer) this.emit('infected');
      });
    }
    this.viruses = this.viruses.filter((v) => !v.hit && v.age < v.life);
    // Booming species attract new viruses ("kill the winner").
    this.virusTimer -= dt;
    if (this.virusTimer <= 0) {
      this.virusTimer = 12;
      const strains = new Set(this.viruses.map((v) => v.strain));
      for (const sp of this.species.living()) {
        if (sp.symbiont || strains.has(sp.id)) continue;
        const threshold = sp.isPlayer ? 16 : 24;
        if (sp.pop >= threshold && this.rng.chance(0.3)) {
          const hosts = this.cells.filter((c) => c.speciesId === sp.id && !c.isPlayer);
          if (!hosts.length) continue;
          const h = this.rng.pick(hosts);
          this.releaseVirions(h.x, h.y, sp.id, 6);
          if (sp.isPlayer) this.emit('virusStrain');
        }
      }
    }
  }

  resolveInfection(c) {
    const ph = c.ph;
    const strain = c.infection.strain;
    c.infection = null;
    const chance = ph.clearChance * (0.5 + 0.5 * clamp(c.hp / ph.maxHP, 0, 1));
    if (this.rng.chance(chance)) {
      if (ph.crispr) c.immune.add(strain);
      if (c.isPlayer) {
        this.progress.virusesSurvived++;
        this.emit('cured', { immune: ph.crispr });
      }
    } else {
      c.hp = 0;
      c.cause = 'virus';
      c.lysed = strain;
    }
  }

  // ------------------------------------------------------------ the rotifer

  spawnGiant() {
    const p = this.player;
    const S = this.size;
    // Enter from the edge nearest the player (or a random edge).
    const ref = p || { x: this.rng.float(300, S - 300), y: this.rng.float(300, S - 300) };
    const side = this.rng.int(0, 3);
    const along = clamp(ref.x + this.rng.float(-400, 400), 150, S - 150);
    const alongY = clamp(ref.y + this.rng.float(-400, 400), 150, S - 150);
    const x = side === 0 ? 60 : side === 1 ? S - 60 : along;
    const y = side === 2 ? 60 : side === 3 ? S - 60 : alongY;
    this.giants.push({ x, y, heading: Math.atan2(ref.y - y, ref.x - x), r: 48, t: 0, life: 120, phase: 0, feeding: true, target: { x: ref.x, y: ref.y } });
    this.emit('giant');
  }

  updateGiants(dt) {
    if (this.eukaryotesExist || this.time > 900) {
      this.giantTimer -= dt;
      if (this.giantTimer <= 0 && this.giants.length === 0) {
        this.giantTimer = this.rng.float(300, 460);
        this.spawnGiant();
      }
    }
    for (const g of this.giants) {
      g.t += dt;
      g.phase += dt;
      // Feeding bouts of eight seconds, then four of rest.
      g.feeding = g.phase % 12 < 8;
      const leaving = g.t > g.life;
      if (leaving) g.target = { x: g.x < this.size / 2 ? -200 : this.size + 200, y: g.y };
      else if (g.t % 25 < dt && this.player) g.target = { x: this.player.x, y: this.player.y };
      const want = Math.atan2(g.target.y - g.y, g.target.x - g.x);
      g.heading += clamp(angleDiff(want, g.heading), -0.25 * dt, 0.25 * dt);
      const speed = g.feeding ? 3 : 7;
      g.x += Math.cos(g.heading) * speed * dt;
      g.y += Math.sin(g.heading) * speed * dt;
      // The corona's cilia whip up a current that draws food (and cells) into the mouth.
      const mx = g.x + Math.cos(g.heading) * g.r;
      const my = g.y + Math.sin(g.heading) * g.r;
      g.mouth = { x: mx, y: my };
      const R = 150;
      if (g.feeding) {
        this.cellHash.query(mx, my, R, (c) => {
          if (c.dead || c.attachedTo) return;
          const dx = mx - c.x;
          const dy = my - c.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d > R) return;
          const pull = 13 * (1 - d / R) ** 1.5 * (c.r > 18 ? 0.5 : 1) * (c.cyst ? 1.3 : 1);
          c.x += (dx / d) * pull * dt;
          c.y += (dy / d) * pull * dt;
          if (d < 12 + c.r * 0.5 && c.r < 22) {
            c.hp = 0;
            c.cause = 'a rotifer';
            c.engulfed = true;
          }
        });
        this.foodHash.query(mx, my, R, (f) => {
          const dx = mx - f.x;
          const dy = my - f.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d > R) return;
          f.x += (dx / d) * 16 * (1 - d / R) * dt;
          f.y += (dy / d) * 16 * (1 - d / R) * dt;
          if (d < 10) f.eaten = true;
        });
      }
      // Its body pushes cells aside.
      this.cellHash.query(g.x, g.y, g.r + 30, (c) => {
        if (c.attachedTo) return;
        const dx = c.x - g.x;
        const dy = c.y - g.y;
        const d = Math.hypot(dx, dy) || 1;
        const min = g.r * 0.85 + c.r;
        if (d < min) {
          c.x = g.x + (dx / d) * min;
          c.y = g.y + (dy / d) * min;
        }
      });
    }
    this.giants = this.giants.filter((g) => g.x > -300 && g.y > -300 && g.x < this.size + 300 && g.y < this.size + 300);
  }

  // ------------------------------------------------------------ food & population

  updateFood(dt) {
    const cur = this._cur;
    for (const f of this.food) {
      f.age += dt;
      this.env.current(f.x, f.y, cur);
      f.x = clamp(f.x + cur.x * 0.9 * dt, 5, this.size - 5);
      f.y = clamp(f.y + cur.y * 0.9 * dt, 5, this.size - 5);
      f.rot += dt * 0.3;
    }
    this.food = this.food.filter((f) => !f.eaten && f.age < f.life);
    const fc = this.foodCount;
    fc.algae = fc.bacteria = fc.detritus = fc.meat = 0;
    for (const f of this.food) fc[f.kind]++;
  }

  /** Empty habitats get colonised by migrants from the open ocean. */
  migrants() {
    if (this.cells.length > this.maxCells - 20) return;
    const counts = {};
    let euks = 0;
    for (const c of this.cells) {
      const b = this.env.classify(c.env);
      counts[b] = (counts[b] || 0) + 1;
      if (c.ph.euk) euks++;
    }
    const pool = FOUNDERS.filter((f) => (counts[f.biome] || 0) < 4);
    // Once complex cells exist, they keep a foothold through migration too.
    const lateOk = this.eukaryotesExist || this.env.eraHistory.length >= 3 || this.time > 900;
    if (lateOk && euks < 14) pool.push(...LATE_MIGRANTS);
    if (!pool.length || !this.rng.chance(0.5)) return;
    const f = this.rng.pick(pool);
    const g = mutateGenome(f.genome, this.rng);
    const sp = this.species.create({ genome: g });
    const p = this.env.randomPointIn(f.biome, this.rng);
    for (let i = 0; i < (f.genome.domain === 'euk' ? 3 : 4); i++) this.addCell(cloneGenome(g), sp.id, p.x + this.rng.float(-40, 40), p.y + this.rng.float(-40, 40), { age: 0 });
    this.species.record('migration', `${sp.name} migrated into the ${BIOMES[f.biome].name.toLowerCase()}`, sp.id);
  }

  /** Aerobic bacteria appear once oxygen rises (or the lineage is ready for them). */
  symbionts(dt) {
    this.symbiontTimer -= dt;
    if (this.symbiontTimer > 0) return;
    this.symbiontTimer = 25;
    const p = this.player;
    const playerReady = p && !p.ph.euk && !p.guest && this.progress.generation >= 3;
    if (this.env.eraHistory.length < 2 && !playerReady) return;
    if (!this.symbiontSpecies) {
      this.symbiontSpecies = this.species.create({ name: SYMBIONT.name, genome: SYMBIONT.genome });
      this.symbiontSpecies.symbiont = true;
      this.species.record('migration', `${SYMBIONT.name}, an oxygen-breathing bacterium, appeared in the pond`, this.symbiontSpecies.id);
      this.emit('symbionts');
    }
    const sid = this.symbiontSpecies.id;
    const all = this.cells.filter((c) => c.speciesId === sid);
    if (all.length >= 14) return;
    let x;
    let y;
    if (playerReady && this.rng.chance(0.7)) {
      const a = this.rng.float(0, TAU);
      const d = this.rng.float(180, 320);
      x = p.x + Math.cos(a) * d;
      y = p.y + Math.sin(a) * d;
    } else {
      const q = this.env.randomPointIn(this.rng.chance(0.5) ? 'shallows' : 'twilight', this.rng);
      x = q.x;
      y = q.y;
    }
    for (let i = 0; i < 3; i++) this.addCell(cloneGenome(SYMBIONT.genome), sid, x + this.rng.float(-25, 25), y + this.rng.float(-25, 25), { age: 0 });
  }

  /**
   * Cells drift in from the wider ocean when the pond is nearly empty, so a
   * mass extinction thins the ecosystem without wiping it out completely.
   */
  immigrate(dt) {
    this.symbionts(dt);
    this.immigrationTimer -= dt;
    if (this.immigrationTimer > 0) return;
    this.immigrationTimer = 4;
    this.migrantTimer -= 4;
    if (this.migrantTimer <= 0) {
      this.migrantTimer = 35;
      this.migrants();
    }
    if (this.cells.length >= 120) return;
    const donors = this.cells.filter((c) => !c.dead && !this.species.get(c.speciesId)?.isPlayer && !this.species.get(c.speciesId)?.symbiont);
    for (let i = 0; i < 3 && donors.length; i++) {
      const d = this.rng.pick(donors);
      const a = this.rng.float(0, Math.PI * 2);
      this.addCell(cloneGenome(d.genome), d.speciesId, d.x + Math.cos(a) * 40, d.y + Math.sin(a) * 40, { age: 0, growth: 0 });
    }
  }

  reproduce() {
    const count = this.cells.length;
    const born = [];
    for (const c of this.cells) {
      if (c.dead || c.isPlayer || c.attachedTo || c.cyst || c.infection) continue;
      if (c.growth < c.ph.growthNeeded) continue;
      const sp = this.species.get(c.speciesId);
      if (sp && sp.symbiont && sp.pop >= 14) {
        c.growth = c.ph.growthNeeded * 0.7;
        continue;
      }
      const lineage = sp && sp.isPlayer;
      const cap = lineage ? this.maxCells + 30 : this.maxCells;
      if (count + born.length >= cap) {
        c.growth = c.ph.growthNeeded * 0.7;
        continue;
      }
      // Soft cap per species keeps one design from filling the whole pond.
      // Predators stay much rarer than the cells they eat.
      const predator = c.ph.lytic > 0 || c.ph.bite > 0 || c.ph.engulf;
      const hunter = predator && !lineage;
      const share = (sp ? sp.pop : 0) / (this.maxCells * (hunter ? this.diff.predatorShare : 0.22));
      if (!this.rng.chance(1 - Math.min(hunter ? 0.995 : 0.97, share * share))) {
        c.growth = c.ph.growthNeeded * (hunter ? 0.5 : 0.75);
        continue;
      }
      born.push(this.divide(c, lineage));
    }
    for (const b of born) if (b) this.cells.push(b);
  }

  /** NPC division. Returns the child (not yet added). */
  divide(c, lineage) {
    let g = c.genome;
    let speciesId = c.speciesId;
    const sp = this.species.get(c.speciesId);
    if (c.guest === 'mito' && !c.ph.euk && !lineage && this.rng.chance(0.35)) {
      // The guest becomes a partner: a new complex cell lineage begins.
      g = eukaryotize(c.genome, this.rng);
      speciesId = this.species.assignChild(g, c.speciesId);
      const nsp = this.species.get(speciesId);
      if (nsp) this.species.record('speciation', `${nsp.name} took in an aerobic bacterium and became a complex cell`, speciesId);
      c.guest = null;
    } else if (c.guest === 'cyano' && c.ph.euk && !lineage && canAddPart(c.genome, 'chloroplast')) {
      g = cloneGenome(c.genome);
      g.parts.push({ t: 'chloroplast', a: 0 });
      speciesId = this.species.assignChild(g, c.speciesId);
      c.guest = null;
    } else if (!lineage && !(sp && sp.symbiont) && this.rng.chance(0.45)) {
      g = mutateGenome(c.genome, this.rng, stressBias(c));
      speciesId = this.species.assignChild(g, c.speciesId);
    } else g = cloneGenome(g);
    const a = this.rng.float(0, Math.PI * 2);
    const child = new Cell(this, g, speciesId, c.x + Math.cos(a) * c.r, c.y + Math.sin(a) * c.r, {
      energy: c.energy * 0.5,
      growth: 0,
      age: 0,
      generation: c.generation + 1,
      heading: a,
      immune: c.immune,
    });
    this.env.sample(child.x, child.y, child.env);
    c.energy *= 0.5;
    c.growth = 0;
    if (child.ph.euk && !this.eukaryotesExist) this.markEukaryotes();
    this.fx.push({ type: 'divide', x: c.x, y: c.y, t: 0, life: 0.6, hue: c.genome.hue });
    return child;
  }

  reap() {
    let any = false;
    for (const c of this.cells) {
      if (c.hp > 0 || c.dead) {
        if (!c.dead || c.cause !== 'symbiosis') continue;
      }
      if (c.dead && c.cause === 'symbiosis') {
        any = true;
        continue;
      }
      c.dead = true;
      any = true;
      const ds = this.deathStats || (this.deathStats = {});
      const key = c.cause || 'unknown';
      ds[key] = (ds[key] || 0) + 1;
      const area = (c.ph.radius / 9) ** 2;
      if (c.lysed) {
        // The cell bursts, releasing a new generation of virus.
        this.releaseVirions(c.x, c.y, c.lysed, Math.round(8 + 6 * area));
      }
      if (!c.engulfed) {
        const n = Math.round(1 + 2 * area);
        const total = c.ph.maxHP * 0.35 + c.growth * 0.4 + c.energy * 0.3 + 4;
        const genes = [...new Set(c.genome.parts.map((p) => p.t))];
        for (let i = 0; i < n; i++) {
          const a = this.rng.float(0, Math.PI * 2);
          const d = this.rng.float(0, c.r);
          this.addFood('meat', c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, { energy: total / n, genes, scale: 0.8 + Math.sqrt(area) * 0.3 });
        }
        this.fx.push({ type: 'burst', x: c.x, y: c.y, t: 0, life: 0.9, hue: c.genome.hue, r: c.r });
      }
      if (c.killer && c.killer.isPlayer) this.playerKilled(c);
      const sp = this.species.get(c.speciesId);
      if (sp && sp.isPlayer) {
        this.progress.lineageDeaths++;
        if (!c.isPlayer && c.cause) {
          this.lineageCauses = this.lineageCauses || {};
          this.lineageCauses[c.cause] = (this.lineageCauses[c.cause] || 0) + 1;
        }
      }
      if (c.isPlayer) this.onPlayerDeath(c);
    }
    if (any) this.cells = this.cells.filter((c) => !c.dead);
  }

  /** Colony members share energy with the cell they are attached to. */
  shareColony(dt) {
    const p = this.player;
    if (!p) return;
    let n = 0;
    for (const c of this.cells) {
      if (c.dead || c.attachedTo !== p) continue;
      n++;
      const spare = c.energy - c.ph.maxEnergy * 0.55;
      if (spare > 0 && p.energy < p.ph.maxEnergy) {
        const tr = Math.min(spare, 1.5 * dt);
        c.energy -= tr;
        p.energy += tr * 0.9;
      } else if (c.energy < c.ph.maxEnergy * 0.25 && p.energy > p.ph.maxEnergy * 0.5) {
        const tr = 1 * dt;
        p.energy -= tr;
        c.energy += tr * 0.9;
      }
    }
    p.colony = n;
    this.progress.colony = n + 1;
  }

  // ------------------------------------------------------------ player

  playerAte(f, eff) {
    const pr = this.progress;
    pr.eaten++;
    const gain = { algae: 0.8, bacteria: 1, detritus: 0.45, meat: 1.6 }[f.kind] * Math.min(1, eff + 0.3);
    this.addDNA(gain);
    if (f.genes && this.rng.chance(0.15)) this.tryGeneTransfer(f.genes, 'meat');
    this.emit('ate', { kind: f.kind });
  }

  playerKilled(victim) {
    const pr = this.progress;
    pr.kills++;
    this.addDNA(3 + victim.ph.nParts);
    const sp = this.species.get(victim.speciesId);
    if (!victim.engulfed) this.emit('kill', { name: sp ? sp.name : 'a cell' });
    if (this.rng.chance(0.5)) this.tryGeneTransfer(victim.genome.parts.map((p) => p.t), 'kill', sp?.name);
  }

  addDNA(v) {
    const pr = this.progress;
    pr.dnaFrac += v;
    const whole = Math.floor(pr.dnaFrac);
    if (whole > 0) {
      pr.dna += whole;
      pr.dnaFrac -= whole;
    }
  }

  tryGeneTransfer(genes, source, fromName = null) {
    const pr = this.progress;
    const dom = this.player ? this.player.genome.domain : 'pro';
    // Symbiont parts can't be picked up as loose genes, and complex-cell
    // machinery means nothing to a simple cell yet.
    const locked = [...new Set(genes)].filter((g) => PARTS[g] && !pr.unlocked.has(g) && !PARTS[g].symbiont && (PARTS[g].domain === 'any' || dom === 'euk'));
    if (!locked.length) return null;
    const g = this.rng.pick(locked);
    pr.unlocked.add(g);
    pr.genesAcquired++;
    this.emit('gene', { part: g, name: PARTS[g].name, from: fromName, source });
    return g;
  }

  trackPlayer(dt) {
    const p = this.player;
    if (!p || p.dead || this.gameOver) return;
    this.pressures.update(dt, p, this);
    p.chasedBy = null;
    p.preyNear = false;
    this.cellHash.query(p.x, p.y, 160, (o) => {
      if (o === p || o.dead || o.speciesId === p.speciesId) return;
      if (o.ai.prey === p) p.chasedBy = o;
      if (o.r < p.r * 0.9 && Math.hypot(o.x - p.x, o.y - p.y) < 110) p.preyNear = true;
    });
    if (p.stressTotal <= 0 && !p.starving) {
      const b = this.env.classify(p.env);
      p.comfort = p.comfort || {};
      p.comfort[b] = (p.comfort[b] || 0) + dt;
      if (p.comfort[b] > 25) this.progress.biomesThrived.add(b);
    }
    // Scent: which way food lies, for cells with chemoreceptors.
    p.scentTimer = (p.scentTimer || 0) - dt;
    if (p.ph.counts.chemoreceptor && p.scentTimer <= 0) {
      p.scentTimer = 0.5;
      const sc = p.scent || (p.scent = new Float32Array(8));
      sc.fill(0);
      const R = p.ph.sight.base + 60;
      this.foodHash.query(p.x, p.y, R, (f) => {
        const dx = f.x - p.x;
        const dy = f.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d > R || d < p.r) return;
        const eff = f.meat ? p.ph.meatEff : p.ph.particleEff;
        let k = Math.round((Math.atan2(dy, dx) / TAU) * 8);
        k = ((k % 8) + 8) % 8;
        sc[k] += (eff * f.energy) / (d + 20);
      });
      let max = 0;
      for (const v of sc) max = Math.max(max, v);
      if (max > 0) for (let i = 0; i < 8; i++) sc[i] /= max;
    }
    const sp = this.playerSpecies;
    if (sp && sp.pop > this.progress.peakLineage) this.progress.peakLineage = sp.pop;
    const ready = p.growth >= p.ph.growthNeeded && !p.cyst;
    if (ready && !this.progress.readyToDivide) this.emit('ready');
    this.progress.readyToDivide = ready;
    if (p.age > p.lifespan * 1.25 && !p.warnedAge) {
      p.warnedAge = true;
      this.emit('aging');
    }
  }

  onPlayerDeath(c) {
    this.emit('playerDied', { cause: c.cause || 'unknown' });
    const pending = { dead: c, cause: c.cause || 'unknown', x: c.x, y: c.y };
    const rel = this.relatives(pending);
    if (!rel.length) return this.lineageExtinct(pending);
    // Ask the player which relative to continue as, unless there is only one
    // (or they chose a standing answer, or nobody is playing).
    if (this.autopilot || rel.length === 1 || this.respawnMode !== 'ask') {
      return this.continueAs(pending, this.autopilot || rel.length === 1 ? 'nearest' : this.respawnMode);
    }
    this.player = null;
    this.pendingRespawn = pending;
    this.emit('chooseRelative');
  }

  /** Living members of the dead player's lineage. */
  relatives(pending) {
    const sid = pending.dead.speciesId;
    return this.cells.filter((o) => !o.dead && o !== pending.dead && o.speciesId === sid);
  }

  /** How far a relative's body has come: complex cells first, then parts and generations. */
  development(o) {
    return (o.ph.euk ? 100 : 0) + o.genome.parts.length * 4 + o.generation;
  }

  /** The relative each option would pick (random is decided when chosen). */
  relativeChoice(pending, kind) {
    const rel = this.relatives(pending);
    if (!rel.length) return null;
    const dist = (o) => Math.hypot(o.x - pending.x, o.y - pending.y);
    if (kind === 'random') return this.rng.pick(rel);
    if (kind === 'developed') {
      let best = rel[0];
      for (const o of rel) {
        const d = this.development(o) - this.development(best);
        if (d > 0 || (d === 0 && dist(o) < dist(best))) best = o;
      }
      return best;
    }
    // Nearest, preferring a member of your colony: the colony carries on.
    let best = null;
    let bd = Infinity;
    for (const o of rel) {
      const d = dist(o) - (o.attachedTo === pending.dead ? 1e5 : 0);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  /** Take control of a relative after the player's cell died. */
  continueAs(pending, kind) {
    const best = this.relativeChoice(pending, kind);
    this.pendingRespawn = null;
    if (!best) return this.lineageExtinct(pending);
    const c = pending.dead;
    const wasColony = best.attachedTo === c;
    best.isPlayer = true;
    best.attachedTo = null;
    best.ctrl = { dx: 0, dy: 0, thrust: 0 };
    for (const o of this.cells) if (o.attachedTo === c) o.attachedTo = wasColony ? best : null;
    this.player = best;
    this.emit('respawn', {
      cause: pending.cause,
      kind,
      generation: best.generation,
      euk: best.ph.euk,
      distance: Math.max(0, Math.hypot(best.x - pending.x, best.y - pending.y)),
    });
    return best;
  }

  lineageExtinct(pending) {
    this.pendingRespawn = null;
    this.player = null;
    this.gameOver = true;
    this.emit('extinct', { cause: pending.cause });
  }


  /** Called when the player finishes the editor. */
  playerDivide(newGenome, note = '') {
    const p = this.player;
    if (!p) return;
    const pr = this.progress;
    const becameEuk = newGenome.domain === 'euk' && !p.ph.euk;
    p.setGenome(cloneGenome(newGenome));
    p.hp = p.ph.maxHP;
    p.energy = Math.min(p.ph.maxEnergy, p.ph.maxEnergy * 0.55);
    p.growth = 0;
    p.age = 0;
    p.warnedAge = false;
    p.guest = null;
    p.generation++;
    pr.generation = p.generation;
    pr.divisions++;
    pr.readyToDivide = false;
    if (becameEuk) {
      pr.eukaryote = true;
      pr.eukaryoteGen = p.generation;
      for (const u of EUKARYOTE_UNLOCKS) pr.unlocked.add(u);
      if (!this.eukaryotesExist) this.markEukaryotes();
    }
    // With adhesion proteins the daughter stays attached: a colony.
    const attached = this.cells.filter((o) => o.attachedTo === p).length;
    const stick = p.ph.adhesion && attached < 5;
    const slot = attached;
    const a = stick ? Math.PI + (slot - 2) * 0.9 : this.rng.float(0, Math.PI * 2);
    const dist = p.r * 2 + (stick ? Math.floor(slot / 3) * p.r * 1.6 : 0);
    const sib = this.addCell(cloneGenome(newGenome), p.speciesId, p.x + Math.cos(p.heading + a) * dist, p.y + Math.sin(p.heading + a) * dist, {
      energy: p.ph.maxEnergy * 0.5,
      growth: 0,
      age: 0,
      generation: p.generation,
      immune: p.immune,
    });
    if (stick) {
      sib.attachedTo = p;
      sib.offset = { a, d: dist, h: this.rng.float(-0.5, 0.5) };
      this.emit('colony', { size: attached + 2 });
    }
    this.playerSpecies.ref = cloneGenome(newGenome);
    this.playerSpecies.diet = p.ph.diet;
    // Living with an eye for a generation makes its next tier available.
    for (const part of newGenome.parts) {
      const next = PARTS[part.t].evolvesTo;
      if (next && !pr.unlocked.has(next)) {
        pr.unlocked.add(next);
        this.emit('eyeTier', { from: PARTS[part.t].name, to: PARTS[next].name });
      }
      // Symbionts can multiply once you have them.
      if (PARTS[part.t].symbiont) pr.unlocked.add(part.t);
    }
    pr.history.push({ gen: p.generation, genome: cloneGenome(newGenome), note, time: this.time });
    if (pr.history.length > 40) pr.history.shift();
    this.pressures.reset();
    this.fx.push({ type: 'divide', x: p.x, y: p.y, t: 0, life: 0.8, hue: newGenome.hue });
    this.species.recount();
  }

  lineageCount() {
    return this.playerSpecies ? this.playerSpecies.pop : 0;
  }
}

function mainStress(s) {
  let best = 'exposure';
  let v = 0;
  const names = { cold: 'cold', heat: 'heat', uv: 'UV radiation', o2: 'oxygen poisoning', tox: 'sulfur poisoning' };
  for (const k of Object.keys(names)) {
    if (s[k] > v) {
      v = s[k];
      best = names[k];
    }
  }
  return best;
}

/** Stress-induced mutation bias for AI cells: stressed cells mutate toward relief. */
function stressBias(c) {
  const s = c.sm;
  if (!s) return null;
  return {
    antifreeze: s.cold * 400,
    heatshock: s.heat * 400,
    pigment: s.uv * 400,
    catalase: s.o2 * 400,
    detox: s.tox * 400,
  };
}

export { autotrophIncome };
