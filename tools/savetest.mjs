// Save round-trip check: simulate, snapshot, restore, compare, keep running.
import { World } from '../js/world.js';
import { serialize, deserialize } from '../js/save.js';
import { eukaryotize, cloneGenome } from '../js/genome.js';

const w = new World(4242, { autopilot: true });
w.populate();
w.spawnPlayer('shallows', 'Testus savedus');
for (let i = 0; i < 30 * 200; i++) {
  w.step(1 / 30);
  if (w.player && w.progress.readyToDivide) w.playerDivide(w.player.genome);
}
// Exercise the cell-stage 2.0 state: become complex, grow a colony, catch a virus.
if (w.player) {
  const g = eukaryotize(w.player.genome);
  g.parts.push({ t: 'adhesion', a: 0 }, { t: 'crispr', a: 0 }, { t: 'cyst', a: 0 });
  w.playerDivide(g, 'test: complex');
  w.playerDivide(cloneGenome(w.player.genome), 'test: colony');
  w.playerDivide(cloneGenome(w.player.genome), 'test: colony 2');
  w.player.immune.add(3);
  w.player.infection = { strain: 5, t: 9, total: 16 };
  w.player.guest = 'cyano';
  w.player.meal = { left: 12, rate: 3, hue: 120, r: 4 };
}
const other = w.cells.find((c) => !c.isPlayer && !c.attachedTo && c.ph.cyst !== undefined);
if (other) {
  other.cyst = true;
  other.cystT = 7.5;
}
const snap = serialize(w, { goalsDone: ['divide'], won: false });
const json = JSON.stringify(snap);
const gz = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
console.log('save json', (json.length / 1024).toFixed(0), 'KB; gzip', (gz.length / 1024).toFixed(0), 'KB; base64 ~', ((gz.length * 4) / 3 / 1024).toFixed(0), 'KB');
const { world: r, meta } = deserialize(JSON.parse(json));
r.autopilot = true;
const cmp = (label, a, b) => console.log(label.padEnd(18), a, b, a === b ? 'ok' : 'DIFF');
cmp('time', Math.round(w.time), Math.round(r.time));
cmp('cells', w.cells.length, r.cells.length);
cmp('food', w.food.length, r.food.length);
cmp('species', w.species.all().length, r.species.all().length);
cmp('player gen', w.player.generation, r.player.generation);
cmp('dna', w.progress.dna, r.progress.dna);
cmp('era', w.env.era.id, r.env.era.id);
cmp('lineage', w.playerSpecies.name, r.playerSpecies.name);
cmp('unlocked', [...w.progress.unlocked].join(), [...r.progress.unlocked].join());
cmp('player hp', Math.round(w.player.hp), Math.round(r.player.hp));
cmp('player domain', w.player.genome.domain, r.player.genome.domain);
cmp('player parts', w.player.genome.parts.map((p) => p.t).join(), r.player.genome.parts.map((p) => p.t).join());
cmp('attached', w.cells.filter((c) => c.attachedTo).length, r.cells.filter((c) => c.attachedTo).length);
cmp('attached to plyr', w.cells.filter((c) => c.attachedTo === w.player).length, r.cells.filter((c) => c.attachedTo === r.player).length);
cmp('infection', JSON.stringify(w.player.infection), JSON.stringify(r.player.infection));
cmp('immune', [...w.player.immune].join(), [...r.player.immune].join());
cmp('guest', w.player.guest, r.player.guest);
cmp('meal left', w.player.meal && w.player.meal.left, r.player.meal && r.player.meal.left);
cmp('cysts', w.cells.filter((c) => c.cyst).length, r.cells.filter((c) => c.cyst).length);
cmp('viruses', w.viruses.length, r.viruses.length);
cmp('giants', w.giants.length, r.giants.length);
cmp('euk exist', w.eukaryotesExist, r.eukaryotesExist);
cmp('symbiont sp', w.symbiontSpecies && w.symbiontSpecies.id, r.symbiontSpecies && r.symbiontSpecies.id);
cmp('history', w.progress.history.map((h) => h.gen + h.note).join('|'), r.progress.history.map((h) => h.gen + h.note).join('|'));
cmp('euk progress', w.progress.eukaryote, r.progress.eukaryote);
console.log('meta', JSON.stringify(meta));
for (let i = 0; i < 30 * 60; i++) {
  r.step(1 / 30);
  if (r.player && r.progress.readyToDivide) r.playerDivide(r.player.genome);
}
console.log('restored world ran 60s more: cells', r.cells.length, 'time', Math.round(r.time), 'gameOver', r.gameOver);
