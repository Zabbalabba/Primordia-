// Behaviour for AI-controlled cells: flee, hunt, graze, seek comfortable
// water, look for hosts (symbiont bacteria), and go dormant when it helps.

import { envStress, autotrophIncome } from './biology.js';
import { clamp } from './util.js';
import { maxRange, rangeToward } from './vision.js';

const DIRS = 8;
const tmpEnv = {};
const tmpStress = {};

function envUtility(ph, e) {
  const s = envStress(ph, e, tmpStress);
  return -s.total * 60 + autotrophIncome(ph, e) * 1.5;
}

/** Can `o` hurt `c`? (as far as c can tell, given how clearly it senses) */
function dangerOf(o, c, clarity, d) {
  const ph = o.ph;
  if (clarity === 0) return o.r > c.r * 1.3 && d < 50 + c.r ? 0.5 : 0;
  let k = 0;
  if (ph.bite > 0 && o.r > c.r * 0.55) k = Math.max(k, (ph.bite * 3) / (c.hp + 6));
  if (ph.lytic > 0 && o.r < c.r * 2.5) k = Math.max(k, (ph.lytic * 3) / (c.hp + 6));
  if (ph.engulf && c.r < o.r * 0.6 && !c.cyst) k = Math.max(k, 1.6);
  return k * Math.min(2, o.r / c.r + 0.4);
}

function canEat(c, o) {
  const ph = c.ph;
  if (ph.engulf && o.r < c.r * 0.55) return true;
  if (ph.bite > 0 && o.r < c.r * 1.4) return true;
  if (ph.lytic > 0 && o.r < c.r * 2.2) return true;
  return false;
}

export function think(c, world, dt) {
  const ai = c.ai;
  ai.timer -= dt;
  if (ai.timer > 0) return;
  ai.timer = 0.2 + world.rng.float(0, 0.12);

  const ph = c.ph;
  const vis = maxRange(c);
  const vis2 = vis * vis;
  const base2 = ph.sight.base * ph.sight.base;
  const clarity = ph.sight.clarity;
  const sp = world.species.get(c.speciesId);
  const symbiont = sp && sp.symbiont;
  let fx = 0;
  let fy = 0;
  let threat = 0;
  let nearestThreat = Infinity;
  let prey = null;
  let preyScore = 0;
  let host = null;
  let hostD = Infinity;
  let crowd = 0;

  world.cellHash.query(c.x, c.y, vis, (o) => {
    if (o === c || o.dead) return;
    const dx = o.x - c.x;
    const dy = o.y - c.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > vis2) return;
    const d = Math.sqrt(d2) + 0.001;
    if (d < 30 + c.r) crowd++;
    if (o.speciesId === c.speciesId) return;
    let range = vis;
    if (d2 > base2) {
      range = rangeToward(c, Math.atan2(dy, dx));
      if (d > range) return;
    }
    if (symbiont) {
      // Aerobic bacteria look for a larger simple cell to live inside.
      if (!o.ph.euk && !o.guest && o.r > c.r * 1.15 && !o.cyst) {
        const dd = d - (o.isPlayer ? 120 : 0);
        if (dd < hostD) {
          hostD = dd;
          host = o;
        }
      }
      return;
    }
    const danger = dangerOf(o, c, clarity, d) * (1 - d / range);
    if (danger > 0) {
      fx -= (dx / d) * danger;
      fy -= (dy / d) * danger;
      threat += danger;
      if (d < nearestThreat) nearestThreat = d;
    }
    if (clarity > 0 && canEat(c, o) && !o.cyst && !(o === ai.ignore && world.time < ai.ignoreUntil)) {
      let score = (o.r / c.r + 0.3) / (d + 20);
      if (o.ph.spike > 0) score *= 0.55;
      if (o.ph.toxin > 0) score *= 0.6;
      if (o.ph.capsule) score *= 0.75;
      if (score > preyScore) {
        preyScore = score;
        prey = o;
      }
    }
  });
  c.crowd = crowd;

  // The rotifer's feeding current: get away from its mouth.
  for (const g of world.giants) {
    if (!g.mouth) continue;
    const dx = g.mouth.x - c.x;
    const dy = g.mouth.y - c.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < 230) {
      const w = 2.5 * (1 - d / 230);
      fx -= (dx / d) * w;
      fy -= (dy / d) * w;
      threat += w;
      nearestThreat = Math.min(nearestThreat, d);
    }
  }

  // Dormancy: ride out what can't be escaped.
  if (ph.cyst) {
    if (!c.cyst && ((c.stressTotal > 0.025 && c.energy < ph.maxEnergy * 0.5) || (threat > 1.5 && nearestThreat < 25 + c.r && c.hp < ph.maxHP * 0.6))) {
      world.setCyst(c, true);
    } else if (c.cyst && c.stressTotal <= 0.002 && threat < 0.3 && ph.cystTime - c.cystT > 4) {
      world.setCyst(c, false);
    }
  }
  if (c.cyst) {
    c.ctrl.thrust = 0;
    return;
  }

  const hunger = 1 - c.energy / ph.maxEnergy;
  let food = null;
  let foodScore = Infinity;
  if (ph.particleEff > 0.2 || ph.meatEff > 0.2) {
    const r = vis * 0.85;
    world.foodHash.query(c.x, c.y, r, (f) => {
      if (f.eaten) return;
      const eff = f.meat ? ph.meatEff : ph.particleEff;
      if (eff < 0.2) return;
      const d = Math.hypot(f.x - c.x, f.y - c.y);
      if (d > r) return;
      if (d > ph.sight.base && d > rangeToward(c, Math.atan2(f.y - c.y, f.x - c.x)) * 0.85) return;
      const score = d / (eff * f.energy);
      if (score < foodScore) {
        foodScore = score;
        food = f;
      }
    });
  }

  // Environmental comfort: probe a ring of points and drift toward better water.
  let ex = 0;
  let ey = 0;
  let envUrgency = 0;
  const here = envUtility(ph, c.env);
  const stressed = c.stressTotal > 0.0005;
  if (stressed || ph.photo > 0 || ph.chemo > 0 || (ai.envProbe = (ai.envProbe || 0) + 1) % 4 === 0) {
    const dist = 100;
    let best = here;
    let bx = 0;
    let by = 0;
    const off = world.rng.float(0, Math.PI * 2);
    for (let i = 0; i < DIRS; i++) {
      const a = off + (i / DIRS) * Math.PI * 2;
      const px = c.x + Math.cos(a) * dist;
      const py = c.y + Math.sin(a) * dist;
      if (px < 40 || py < 40 || px > world.size - 40 || py > world.size - 40) continue;
      const u = envUtility(ph, world.env.sample(px, py, tmpEnv));
      if (u > best) {
        best = u;
        bx = Math.cos(a);
        by = Math.sin(a);
      }
    }
    envUrgency = clamp((best - here) * 0.8, 0, 3);
    ex = bx * envUrgency;
    ey = by * envUrgency;
  }

  let dx = 0;
  let dy = 0;
  let thrust = 0.35;
  let boost = false;
  if (threat > 0.25) {
    ai.mode = 'flee';
    dx = fx;
    dy = fy;
    thrust = 1;
    boost = nearestThreat < 45 + c.r;
    if (ph.toxin > 0 && nearestThreat < 60 + c.r) world.releaseToxin(c);
  } else if (symbiont && host) {
    ai.mode = 'seek';
    dx = host.x - c.x;
    dy = host.y - c.y;
    thrust = 0.9;
  } else if (prey && hunger > 0.15 && (!food || preyScore * 20 > 1 / foodScore)) {
    ai.mode = 'hunt';
    dx = prey.x + prey.vx * 0.3 - c.x;
    dy = prey.y + prey.vy * 0.3 - c.y;
    thrust = 1;
    boost = dx * dx + dy * dy < (50 + c.r) ** 2 && c.energy > ph.maxEnergy * 0.2;
    // Hunters tire: a chase that lands no strike for a few seconds is given
    // up, and that prey is left alone for a while.
    const diff = world.diff;
    if (ai.chasing !== prey) {
      ai.chasing = prey;
      ai.chaseStart = world.time;
    }
    const lastStrike = Math.max(ai.chaseStart, c.lastStrike || -1e9);
    if (world.time - lastStrike > diff.chaseTime) {
      ai.ignore = prey;
      ai.ignoreUntil = world.time + 10;
      ai.chasing = null;
    }
    // On Easy, a hunter chasing you can't go faster than you normally swim,
    // so sprinting gets you away.
    if (prey.isPlayer && diff.chaseCap > 0 && ph.cruise > 0) {
      thrust = Math.min(thrust, (diff.chaseCap * prey.ph.cruise) / ph.cruise);
      boost = false;
    }
  } else if (food && hunger > 0.08) {
    ai.mode = 'forage';
    dx = food.x - c.x;
    dy = food.y - c.y;
    thrust = hunger > 0.5 ? 0.9 : 0.6;
  } else {
    ai.mode = 'wander';
    // Run-and-tumble swimmers keep a steadier course between tumbles.
    ai.wander += world.rng.gauss() * (ph.motor.smooth ? 0.45 : 0.2);
    dx = Math.cos(ai.wander);
    dy = Math.sin(ai.wander);
    thrust = ph.photo > 0 || ph.chemo > 0 ? 0.15 : 0.35;
  }

  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  if (ai.mode !== 'flee') {
    const w = stressed ? 1.6 : ai.mode === 'wander' ? 1.2 : 0.4;
    dx += ex * w;
    dy += ey * w;
    if (stressed && envUrgency > 0.2) thrust = Math.max(thrust, 0.8);
  }

  const m = 120;
  if (c.x < m) dx += (m - c.x) / m;
  if (c.y < m) dy += (m - c.y) / m;
  if (c.x > world.size - m) dx -= (c.x - (world.size - m)) / m;
  if (c.y > world.size - m) dy -= (c.y - (world.size - m)) / m;

  if (ai.mode !== 'hunt') ai.chasing = null;
  // Cells that steer by tumbling can't change course on a whim: smooth the
  // wanted direction so small wobbles don't trigger a tumble each time.
  if (!ph.motor.smooth && ph.motor.rotor > 0 && ai.mode !== 'flee' && ai.sx !== undefined) {
    dx = ai.sx * 0.5 + dx * 0.5;
    dy = ai.sy * 0.5 + dy * 0.5;
  }
  ai.sx = dx;
  ai.sy = dy;
  c.ctrl.dx = dx;
  c.ctrl.dy = dy;
  c.ctrl.thrust = thrust;
  c.ctrl.boost = boost;
  ai.prey = ai.mode === 'hunt' ? prey : null;
}
