// Entry point: screens, input, the game loop and event handling.

import { World } from './world.js';
import { Renderer } from './render.js';
import { HUD } from './hud.js';
import { Editor } from './editor.js';
import { renderEco, GOALS } from './eco.js';
import { PLAYER_STARTS, speciesName, cloneGenome, SYMBIONT } from './genome.js';
import { drawCell } from './cellDraw.js';
import { PARTS } from './parts.js';
import { RNG, formatTime } from './util.js';
import { BIOMES, ERAS } from './environment.js';
import { SaveStore, deserialize } from './save.js';
import { Audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const SIM_DT = 1 / 30;

const state = {
  mode: 'title', // title | play | editor | eco | pause | help | over
  world: null,
  renderer: null,
  start: 'shallows',
  difficulty: 'easy',
  speed: 1,
  keys: new Set(),
  pointer: { x: 0, y: 0, down: false, inside: false },
  sprintHeld: false,
  goalsDone: new Set(),
  won: false,
  returnMode: 'play',
};

const canvas = $('game');
const hud = new HUD();
const editor = new Editor(onEditorDone);
const saves = new SaveStore();
const audio = new Audio();
let savedGame = null;

// ---------------------------------------------------------------- worlds

function makeAttractWorld() {
  const w = new World((Math.random() * 1e9) | 0, { difficulty: state.difficulty });
  w.populate();
  for (let i = 0; i < 300; i++) w.step(SIM_DT);
  return w;
}

function setWorld(w) {
  state.world = w;
  w.respawnMode = respawnMode;
  if (!state.renderer) state.renderer = new Renderer(canvas, w);
  else {
    state.renderer.world = w;
    state.renderer.buildBackground();
  }
}

// ---------------------------------------------------------------- saving

function hasLineage() {
  const w = state.world;
  return !!(w && w.playerSpecies && !w.gameOver);
}

function saveMeta() {
  return { goalsDone: [...state.goalsDone], won: state.won, speed: state.speed };
}

function saveGame(cloud = true) {
  // While you choose a relative there is no player cell; the last save stands.
  if (!hasLineage() || state.world.pendingRespawn) return;
  if (installable) keepSaves();
  saves.save(state.world, saveMeta(), { cloud });
}

function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

async function refreshContinue() {
  savedGame = await saves.peek();
  const has = !!savedGame;
  $('continue-card').hidden = !has;
  $('new-label').hidden = !has;
  $('btn-start').textContent = has ? 'Begin a new lineage' : 'Begin';
  if (!has) return;
  const sm = savedGame.summary || {};
  $('cc-name').textContent = sm.name || 'Your lineage';
  const era = ERAS[sm.era] ? ERAS[sm.era].name : '';
  const where = savedGame.source === 'account' ? 'your account' : 'this device';
  $('cc-meta').textContent = `Generation ${sm.generation ?? 1} · ${formatTime(sm.time || 0)} played${era ? ` · ${era}` : ''} · saved ${ago(savedGame.savedAt)} on ${where}`;
}

function continueGame() {
  if (!savedGame) return;
  let restored;
  try {
    restored = deserialize(savedGame.snapshot);
  } catch {
    $('cc-meta').textContent = 'This save could not be loaded.';
    return;
  }
  const { world: w, meta } = restored;
  setWorld(w);
  state.goalsDone = new Set(meta.goalsDone || []);
  state.won = !!meta.won;
  state.speed = meta.speed || 1;
  $('btn-speed').textContent = `${state.speed}×`;
  if (w.player) {
    state.renderer.cam.x = w.player.x;
    state.renderer.cam.y = w.player.y;
  }
  setMode('play');
  audio.setEra(w.env.era.id);
  hud.update(0, w, state.renderer, true);
  hud.toast(`<b>Welcome back.</b> ${w.playerSpecies ? w.playerSpecies.name : 'Your lineage'}, generation ${w.progress.generation}.`, 'good', 5);
}

function updateSaveStatus() {
  const parts = [];
  if (saves.lastSaved) parts.push(`Saved ${ago(saves.lastSaved)} on this device`);
  if (saves.lastCloudSaved) parts.push(`to your account ${ago(saves.lastCloudSaved)}`);
  $('save-status').textContent = parts.length ? `${parts.join(', ')}. Progress saves automatically.` : 'Your progress saves automatically.';
}

function startGame() {
  const name = $('species-input').value.trim() || speciesName(PLAYER_STARTS[state.start].genome, new RNG());
  const w = new World((Math.random() * 1e9) | 0);
  w.populate();
  for (let i = 0; i < 90; i++) w.step(SIM_DT); // let the pond settle
  w.spawnPlayer(state.start, name);
  w.events.length = 0;
  setWorld(w);
  state.renderer.cam.x = w.player.x;
  state.renderer.cam.y = w.player.y;
  state.goalsDone = new Set();
  state.won = false;
  state.speed = 1;
  $('btn-speed').textContent = '1×';
  setMode('play');
  audio.setEra(w.env.era.id);
  hud.update(0, w, state.renderer, true);
  const start = PLAYER_STARTS[state.start];
  hud.toast(`<b>${name}</b>, a single bacterium, begins in the ${start.label.toLowerCase()}. Touch food to absorb it, grow, and divide.`, 'good', 7);
  setTimeout(() => hud.toast('You twitch along on pili: slow, but every cell around you is just as small. If the water hurts you, a red tag under your health bars says why.', '', 7), 3000);
}

// ---------------------------------------------------------------- screens

function setMode(mode) {
  state.mode = mode;
  if (mode === 'title') audio.setEra('title');
  $('screen-title').hidden = mode !== 'title';
  $('screen-help').hidden = mode !== 'help';
  $('screen-eco').hidden = mode !== 'eco';
  $('screen-pause').hidden = mode !== 'pause';
  $('screen-over').hidden = mode !== 'over';
  $('screen-relative').hidden = mode !== 'choose';
  $('screen-event').hidden = mode !== 'event';
  if (mode !== 'editor') editor.open_ && editor.close();
  hud.show(mode !== 'title' && mode !== 'editor');
  if (mode === 'eco') renderEco(state.world);
  if (mode === 'pause') {
    updateSaveStatus();
    syncAudioUI();
  }
  if (mode === 'title') refreshContinue();
  if (mode === 'title') {
    eventQueue.length = 0;
    hud.clearToasts();
  }
  // Big events wait while you are in the editor or a menu.
  if (mode === 'play' && eventQueue.length) showNextEvent();
}

function openHelp(from) {
  state.returnMode = from;
  setMode('help');
}

function buildTitle() {
  const grid = $('start-grid');
  grid.innerHTML = '';
  for (const [key, s] of Object.entries(PLAYER_STARTS)) {
    const b = document.createElement('button');
    b.className = 'start-card';
    b.type = 'button';
    b.setAttribute('aria-pressed', String(key === state.start));
    const cv = document.createElement('canvas');
    b.appendChild(cv);
    b.insertAdjacentHTML('beforeend', `<span class="sc-title">${s.label}</span><span class="sc-blurb">${s.blurb}</span>`);
    b.addEventListener('click', () => {
      state.start = key;
      for (const c of grid.children) c.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
      rerollName();
    });
    grid.appendChild(b);
    requestAnimationFrame(() => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.max(1, r.width * dpr);
      cv.height = Math.max(1, r.height * dpr);
      const ctx = cv.getContext('2d');
      ctx.scale(dpr, dpr);
      const g = ctx.createRadialGradient(r.width / 2, r.height / 2, 0, r.width / 2, r.height / 2, r.width / 2);
      g.addColorStop(0, BIOMES[s.biome].color + '55');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, r.width, r.height);
      drawCell(ctx, s.genome, Math.min(r.height * 0.2, 22), { x: r.width / 2, y: r.height / 2, heading: -0.3, thrustLevel: 0.5, phase: 2 }, 0.8, { detail: true });
    });
  }
  rerollName();
}

function rerollName() {
  $('species-input').value = speciesName(PLAYER_STARTS[state.start].genome, new RNG());
}

function showOver(kind) {
  const w = state.world;
  const pr = w.progress;
  const stats = [
    ['Time survived', formatTime(w.time)],
    ['Generations', pr.generation],
    ['Largest lineage', pr.peakLineage],
    ['Eras survived', pr.erasSurvived],
    ['Genes absorbed', pr.genesAcquired],
    ['Cells eaten', pr.kills],
    ['Species alive in the pond', w.species.living().length],
  ];
  $('over-stats').innerHTML = stats.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  if (kind === 'win') {
    $('over-eyebrow').textContent = 'Cell stage complete';
    $('over-title').textContent = 'The first colony';
    $('over-text').textContent = `From a single bacterium to a colony of complex cells in ${state.world.progress.generation} generations. Cells that stick together and share the work are the first step toward many-celled life. You can keep playing this stage.`;
    $('btn-continue').hidden = false;
  } else {
    const cause = kind.cause || 'unknown causes';
    $('over-eyebrow').textContent = 'Extinction';
    $('over-title').textContent = 'Your lineage is gone';
    $('over-text').textContent = `The last of ${w.playerSpecies?.name || 'your species'} died of ${cause}. The pond carries on without you.`;
    $('btn-continue').hidden = true;
    saves.clear().then(() => (savedGame = null));
  }
  setMode('over');
}

// ---------------------------------------------------------------- events

function handleEvents() {
  const w = state.world;
  if (!w) return;
  const playing = !!w.player || w.gameOver;
  for (const e of w.events) {
    if (state.mode === 'title') continue;
    switch (e.type) {
      case 'era':
        audio.setEra(e.id);
        bigEvent({ eyebrow: 'A new era', title: e.name, text: `${e.desc}<br><span class="muted">${ERAS[e.id].hint}</span>`, tone: '', art: { kind: 'era', id: e.id } });
        break;
      case 'vents':
        hud.toast(`<b>${e.count} new vents</b> have opened on the sea floor.`, 'era', 6);
        break;
      case 'ready':
        audio.sfx('chime');
        hud.toast('<b>Ready to divide.</b> Press R or tap Divide.', 'good', 5);
        break;
      case 'gene':
        audio.sfx('gene');
        hud.toast(`<b>Gene absorbed: ${e.name}</b>${e.from ? ` from ${e.from}` : ''}. You can now add it when you divide.`, 'gene', 6);
        break;
      case 'eyeTier':
        hud.toast(`<b>Your ${e.from.toLowerCase()} can now evolve</b> into an ${e.to.toLowerCase()} when you next divide.`, 'gene', 6);
        break;
      case 'kill':
        hud.toast(`You consumed a <i>${e.name}</i>.`, '', 3, 0);
        break;
      case 'respawn': {
        const which = { developed: 'your most developed relative', nearest: 'your nearest relative', random: 'a random relative' }[e.kind] || 'a relative';
        if (!e.chosen) audio.sfx('death');
        hud.toast(
          `<b>You died (${e.cause}).</b> You continue as ${which}: generation ${e.generation}, ${e.euk ? 'complex' : 'simple'} cell, ${Math.round(e.distance)} µm away.`,
          'bad',
          6,
          2
        );
        break;
      }
      case 'chooseRelative':
        audio.sfx('death');
        showRelativeChoice();
        break;
      case 'extinct':
        audio.sfx('death');
        if (playing) setTimeout(() => showOver({ cause: e.cause }), 1200);
        break;
      case 'aging':
        hud.toast('Your cell is getting old. Divide soon to renew it.', 'bad', 5, 2);
        break;
      case 'toxin':
        audio.sfx('toxin');
        break;
      case 'guest':
        if (e.kind === 'mito') {
          if (!seen('guest-mito'))
            bigEvent({
              eyebrow: 'Something inside',
              title: 'A stowaway',
              text: 'A <i>Protomitos</i> bacterium slipped through your membrane, and you didn’t digest it. It is still alive in there, breathing. When you next divide, you will have to decide what it becomes.',
              tone: 'wonder',
              sound: 'chime',
              art: { kind: 'cells', cells: [{ g: w.player.genome, guest: 'mito' }] },
            });
          else hud.toast('<b>A <i>Protomitos</i> bacterium is living inside you again.</b>', 'gene', 6, 2);
        } else if (!seen('guest-cyano'))
          bigEvent({
            eyebrow: 'Something inside',
            title: 'A green passenger',
            text: 'The photosynthetic bacterium you swallowed is still alive inside you, glowing whenever light reaches it. When you divide, it could stay.',
            tone: 'wonder',
            sound: 'chime',
            art: { kind: 'cells', cells: [{ g: w.player.genome, guest: 'cyano' }] },
          });
        else hud.toast('<b>A swallowed cyanobacterium is alive inside you.</b>', 'gene', 6, 2);
        break;
      case 'symbionts':
        if (!seen('symbionts'))
          bigEvent({
            eyebrow: 'A newcomer',
            title: '<i>Protomitos</i> has arrived',
            text: 'A tiny bacterium that breathes oxygen has drifted into the pond. It seems drawn to larger cells, and circles them for a while.<br><b>What might happen if you let one get too close?</b>',
            tone: 'wonder',
            art: { kind: 'cells', cells: [{ g: SYMBIONT.genome, big: true }] },
          });
        break;
      case 'eukaryotes':
        if (!w.progress.eukaryote && !seen('eukaryotes')) {
          const first = w.cells.find((c) => c.ph.euk && !c.isPlayer);
          bigEvent({
            eyebrow: 'Elsewhere in the pond',
            title: 'Something new has evolved',
            text: 'A cell has taken in a partner and become something far larger, with a nucleus and a skeleton of fibres inside. Some complex cells can swallow a bacterium like you whole.<br><b>How did they do it?</b>',
            tone: 'danger',
            art: first ? { kind: 'cells', cells: [{ g: first.genome, big: true }] } : null,
          });
        }
        break;
      case 'engulf':
        audio.sfx('engulf');
        hud.toast(`You engulfed a <i>${e.name}</i>. Digesting…`, '', 3, 0);
        break;
      case 'infected':
        if (!seen('infected'))
          bigEvent({
            eyebrow: 'Infected',
            title: 'A virus has hijacked your cell',
            text: 'It is turning your cell into a factory for more of itself. Eat and keep your health up to fight it off before the timer runs out. If the virus wins, your cell bursts and releases a new swarm.',
            tone: 'danger',
            sound: 'infect',
            art: { kind: 'cells', cells: [{ g: w.player.genome, infected: true }] },
          });
        else {
          audio.sfx('infect');
          hud.toast(w.player && w.player.ph.crispr ? '<b>Infected by a virus.</b> Your CRISPR system is fighting it.' : '<b>Infected by a virus.</b> Eat and rest to fight it off.', 'bad', 6, 2);
        }
        break;
      case 'cured':
        audio.sfx('chime');
        hud.toast(e.immune ? '<b>Infection cleared.</b> CRISPR keeps a memory: you are now immune to this strain.' : '<b>Infection cleared.</b> CRISPR genes would make you immune next time.', 'good', 6);
        break;
      case 'virusStrain':
        hud.toast('A virus strain has adapted to <b>your species</b>. Viruses target whatever is most common.', 'bad', 7, 2);
        break;
      case 'giant':
        if (!seen('giant'))
          bigEvent({
            eyebrow: 'Something enormous',
            title: 'A rotifer',
            text: 'An animal made of about a thousand cells is moving through the water. The crown of cilia on its head stirs a whirlpool that sweeps everything near its mouth inside.<br><b>Stay out of the swirl.</b>',
            tone: 'danger',
            art: { kind: 'giant' },
          });
        else {
          audio.sfx('swell');
          hud.toast('<b>A rotifer is back.</b> Stay clear of its swirl.', 'bad', 7, 2);
        }
        break;
      case 'colony':
        if (!seen('colony'))
          bigEvent({
            eyebrow: 'Together',
            title: 'Your daughter stayed',
            text: 'This time your daughter cell didn’t swim away. The two of you move as one and share your energy. Many cells working as one body: this is how every animal and plant began.<br><span class="muted">A colony of 4 completes the cell stage.</span>',
            tone: 'wonder',
            sound: 'milestone',
            art: { kind: 'cells', cells: [{ g: w.player.genome, dx: -0.55 }, { g: w.player.genome, dx: 0.55 }] },
          });
        else {
          audio.sfx('milestone');
          hud.toast(`<b>Colony of ${e.size}.</b> Another daughter cell stayed attached.`, 'good', 6, 2);
        }
        break;
      case 'cyst':
        audio.sfx('cyst');
        if (e.on) hud.toast('<b>Dormant.</b> Your cell is sealed in a cyst: almost nothing can hurt it, but it can\'t eat. Press C to wake.', '', 5);
        break;
      case 'night':
        hud.toast('Night falls. Photosynthesis stops until morning.', '', 4, 0);
        break;
      case 'day':
        if (w.time > 60) hud.toast('Morning. The light returns.', '', 3, 0);
        break;
      case 'playerHit':
        audio.sfx('hurt');
        break;
      case 'ate':
        audio.sfx(e.kind === 'meat' ? 'eat' : 'absorb');
        break;
      case 'speciation':
      case 'extinction':
      case 'migration': {
        // Only mention events that involve species you could plausibly meet.
        if (e.type === 'migration') hud.toast(e.text, '', 4, 0);
        break;
      }
    }
  }
  w.events.length = 0;
}

let goalTimer = 0;
function checkGoals(dt) {
  goalTimer -= dt;
  if (goalTimer > 0) return;
  goalTimer = 1;
  const w = state.world;
  if (!w || !w.player) return;
  for (const g of GOALS) {
    if (!state.goalsDone.has(g.id) && g.done(w)) {
      state.goalsDone.add(g.id);
      hud.toast(`<b>Milestone:</b> ${g.text}`, 'good', 5);
      audio.sfx('milestone');
    }
  }
  if (!state.won && state.goalsDone.has('colony')) {
    state.won = true;
    setTimeout(() => showOver('win'), 1500);
  }
}

function onEditorDone(info) {
  setMode('play');
  audio.sfx('divide');
  if (info.symbiosis === 'mito' && !seen('complex')) {
    const w = state.world;
    bigEvent({
      eyebrow: 'Endosymbiosis',
      title: 'You are a complex cell',
      text: `The bacterium inside you is part of you now: your first mitochondrion. Your lineage is bigger, with a nucleus and a skeleton of fibres, and new parts are open to you: cilia, pseudopods, food vacuoles and eyes.${w.eukaryotesExist && w.cells.some((c) => c.ph.euk && c.speciesId !== w.playerSpecies.id) ? '' : '<br><b>You are the first in the pond.</b>'}<br><span class="muted">About two billion years ago, this is how complex life began.</span>`,
      tone: 'wonder',
      sound: 'milestone',
      art: { kind: 'cells', cells: [{ g: w.player.genome, big: true }] },
    });
  }
  if (info.symbiosis === 'cyano') hud.toast('<b>Chloroplast acquired.</b> You can photosynthesise like an alga.', 'gene', 6);
  const parts = [];
  if (info.mutation) parts.push(`mutation: ${info.mutation}`);
  if (info.cost) parts.push(`${info.cost} DNA spent`);
  hud.toast(`<b>Divided.</b> Generation ${state.world.player.generation}${parts.length ? ` · ${parts.join(' · ')}` : ''}.`, 'good', 5);
  if (info.newGene) hud.toast(`${PARTS[info.newGene].name} is now part of your genome.`, 'gene', 5);
  saveGame();
}

// ---------------------------------------------------------------- big events

// The most important moments pause the game with a card; each kind shows
// once per lineage (eras every time). Smaller news uses the pop-ups.
const eventQueue = [];
let eventArt = null;
let eventShownAt = 0;

/** True if this kind of event was already shown in this game (and marks it). */
function seen(id) {
  const pr = state.world.progress;
  const list = pr.seen || (pr.seen = []);
  if (list.includes(id)) return true;
  list.push(id);
  return false;
}

function bigEvent(ev) {
  eventQueue.push(ev);
  if (state.mode === 'play') showNextEvent();
}

function showNextEvent() {
  const ev = eventQueue.shift();
  if (!ev) return;
  $('ev-eyebrow').textContent = ev.eyebrow;
  $('ev-title').innerHTML = ev.title;
  $('ev-text').innerHTML = ev.text;
  $('ev-card').className = `modal-card event-card ${ev.tone || ''}`;
  $('ev-art').hidden = !ev.art;
  eventArt = ev.art || null;
  eventShownAt = performance.now();
  audio.sfx(ev.sound || 'swell');
  state.keys.clear();
  state.pointer.down = false;
  setMode('event');
}

function closeEvent() {
  // A short grace period, so a tap meant for steering doesn't skip the card.
  if (state.mode !== 'event' || performance.now() - eventShownAt < 600) return;
  setMode('play');
}
$('ev-go').addEventListener('click', closeEvent);

const ERA_GLOW = { primordial: [255, 170, 80], oxidation: [90, 220, 255], glaciation: [190, 230, 255], volcanic: [255, 90, 50], blooms: [120, 255, 120] };

function drawEventArt(t) {
  const cv = $('ev-art');
  const W = cv.clientWidth;
  const H = cv.clientHeight;
  if (!eventArt || !W) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const a = eventArt;
  if (a.kind === 'cells') {
    for (const [i, c] of a.cells.entries()) {
      const euk = c.g.domain === 'euk';
      // A long rear tail (rotary flagellum or whip) needs room below the body.
      const tail = c.g.parts.some((p) => (p.t === 'rotor' || p.t === 'flagellum') && Math.abs(p.a) > 2);
      const r = tail ? H * 0.15 : c.big ? H * 0.26 : H * (euk ? 0.22 : 0.2);
      const x = W / 2 + (c.dx || 0) * r * 2 + Math.sin(t * 0.7 + i) * 3;
      const y = (tail ? H * 0.28 : H / 2) + Math.cos(t * 0.5 + i) * 4;
      drawCell(ctx, c.g, r, { x, y, heading: -Math.PI / 2 + Math.sin(t * 0.4 + i) * 0.15, thrustLevel: 0.6, phase: i * 3, twitch: t * 1.7, guest: c.guest, infected: c.infected, look: -Math.PI / 2 }, t, { detail: true });
    }
  } else if (a.kind === 'giant') {
    state.renderer.drawGiant(ctx, { x: W / 2, y: H * 0.58, heading: -Math.PI / 2 + Math.sin(t * 0.3) * 0.08, r: H * 0.2, feeding: true }, t);
  } else if (a.kind === 'era') {
    const [cr, cg, cb] = ERA_GLOW[a.id] || [61, 255, 226];
    const pulse = 1 + 0.05 * Math.sin(t * 1.5);
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, H * 0.6 * pulse);
    g.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, 0.85)`);
    g.addColorStop(0.35, `rgba(${cr}, ${cg}, ${cb}, 0.3)`);
    g.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) {
      const ang = i * 2.399 + t * 0.15 * (i % 2 ? 1 : -1);
      const rad = ((i * 37) % 100) / 100 * H * 0.55 + Math.sin(t + i) * 4;
      ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${0.25 + 0.5 * ((i * 13) % 10) / 10})`;
      ctx.beginPath();
      ctx.arc(W / 2 + Math.cos(ang) * rad * 1.6, H / 2 + Math.sin(ang) * rad, 1 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

// ---------------------------------------------------------------- after death

const RESPAWN_KEY = 'primordia.respawn';
const RESPAWN_KINDS = ['developed', 'nearest', 'random'];
function loadRespawnMode() {
  try {
    const v = localStorage.getItem(RESPAWN_KEY);
    return v === 'developed' || v === 'nearest' || v === 'random' ? v : 'ask';
  } catch {
    return 'ask';
  }
}
let respawnMode = loadRespawnMode();
function setRespawnMode(v) {
  respawnMode = v;
  if (state.world) state.world.respawnMode = v;
  $('set-respawn').value = v;
  try {
    localStorage.setItem(RESPAWN_KEY, v);
  } catch {
    /* not critical */
  }
}
$('set-respawn').value = respawnMode;
$('set-respawn').addEventListener('change', (e) => setRespawnMode(e.target.value));

function showRelativeChoice() {
  const w = state.world;
  const pending = w.pendingRespawn;
  if (!pending) return;
  const rel = w.relatives(pending);
  $('rel-title').textContent = `Continue as one of ${rel.length} relatives`;
  $('rel-text').textContent = `Your cell died of ${pending.cause}. Your lineage lives on. Pick who to play as next.`;
  $('rel-remember').checked = false;
  const box = $('rel-options');
  box.innerHTML = '';
  const labels = { developed: 'Most developed', nearest: 'Nearest', random: 'Random' };
  RESPAWN_KINDS.forEach((kind, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rel-opt';
    const cell = kind === 'random' ? null : w.relativeChoice(pending, kind);
    if (cell) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const ctx = cv.getContext('2d');
      ctx.scale(2, 2);
      const r = cell.ph.euk ? 15 + 2 * cell.genome.size : 9 + 7 * cell.genome.size;
      drawCell(ctx, cell.genome, r, { x: 32, y: 32, heading: -Math.PI / 2, phase: cell.phase }, 0.5, { wobble: 0.5, detail: true });
      b.appendChild(cv);
    } else b.insertAdjacentHTML('beforeend', '<span class="r-q" aria-hidden="true">?</span>');
    const d = cell ? Math.round(Math.hypot(cell.x - pending.x, cell.y - pending.y)) : 0;
    const info = cell
      ? `Gen ${cell.generation} · ${cell.ph.euk ? 'complex' : 'simple'} cell · ${cell.genome.parts.length} parts<br>${d} µm away${cell.attachedTo === pending.dead ? ' · in your colony' : ''}`
      : 'Any living member of your lineage';
    b.insertAdjacentHTML('beforeend', `<span><span class="r-name">${labels[kind]}</span><br><span class="r-info">${info}</span></span><kbd>${i + 1}</kbd>`);
    b.addEventListener('click', () => chooseRelative(kind));
    box.appendChild(b);
  });
  setMode('choose');
}

function chooseRelative(kind) {
  const w = state.world;
  if (!w.pendingRespawn) return;
  if ($('rel-remember').checked) setRespawnMode(kind);
  const p = w.continueAs(w.pendingRespawn, kind);
  if (!p) return; // extinct: the event handler shows the end screen
  // Mark the toast as already announced by the death sound.
  for (const e of w.events) if (e.type === 'respawn') e.chosen = true;
  state.renderer.cam.x = p.x;
  state.renderer.cam.y = p.y;
  setMode('play');
}

function toggleCyst() {
  const w = state.world;
  if (!w || !w.player || !w.player.ph.cyst) return;
  w.toggleCyst(w.player);
}

function tryDivide() {
  const w = state.world;
  if (state.mode !== 'play' || !w.player || !w.progress.readyToDivide) return;
  state.mode = 'editor';
  hud.show(false);
  editor.open(w);
}

// ---------------------------------------------------------------- input

const KEYMAP = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const m = state.mode;
  if (m === 'event') {
    // The event card takes the keyboard until it is closed.
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape' || e.code === 'NumpadEnter') {
      e.preventDefault();
      closeEvent();
    }
    return;
  }
  if (KEYMAP[e.code] || e.code === 'ShiftLeft' || e.code === 'ShiftRight') state.keys.add(e.code);
  if (e.code === 'Tab') {
    e.preventDefault();
    if (m === 'play') setMode('eco');
    else if (m === 'eco') setMode('play');
  } else if (e.code === 'KeyR' || e.code === 'Enter') {
    if (m === 'play') tryDivide();
  } else if (e.code === 'KeyE' || e.code === 'Space') {
    if (m === 'play' && state.world.player) {
      e.preventDefault();
      state.world.releaseToxin(state.world.player);
    }
  } else if (e.code === 'KeyP' || e.code === 'Escape') {
    if (m === 'play') setMode('pause');
    else if (m === 'pause' || m === 'eco') setMode('play');
    else if (m === 'help') setMode(state.returnMode);
  } else if (e.code === 'KeyH') {
    if (m === 'play') openHelp('play');
  } else if (m === 'choose' && (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3')) {
    chooseRelative(RESPAWN_KINDS[Number(e.code.slice(5)) - 1]);
  } else if (e.code === 'KeyC') {
    if (m === 'play') toggleCyst();
  } else if (e.code === 'KeyM') {
    audio.toggleMute();
    syncAudioUI();
  }
});
window.addEventListener('keyup', (e) => state.keys.delete(e.code));
window.addEventListener('blur', () => {
  state.keys.clear();
  state.pointer.down = false;
});

canvas.addEventListener('pointerdown', (e) => {
  if (state.mode !== 'play') return;
  state.pointer.down = true;
  state.pointer.id = e.pointerId;
  state.pointer.x = e.clientX;
  state.pointer.y = e.clientY;
  canvas.setPointerCapture?.(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  state.pointer.x = e.clientX;
  state.pointer.y = e.clientY;
  state.pointer.inside = true;
});
canvas.addEventListener('pointerup', () => (state.pointer.down = false));
canvas.addEventListener('pointercancel', () => (state.pointer.down = false));
canvas.addEventListener('pointerleave', () => (state.pointer.inside = false));
canvas.addEventListener(
  'wheel',
  (e) => {
    if (!state.renderer) return;
    e.preventDefault();
    const r = state.renderer;
    r.userZoom = Math.min(2.5, Math.max(0.45, r.userZoom * Math.exp(-e.deltaY * 0.0012)));
  },
  { passive: false }
);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// The page itself never zooms: block iOS pinch gestures on the page and
// double-tap zoom (the editor's own pinch-zoom uses pointer events and still works).
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
let lastTouchEnd = 0;
document.addEventListener(
  'touchend',
  (e) => {
    const now = Date.now();
    const t = e.target;
    // Buttons and fields keep every tap (rapid + presses in the editor);
    // touch-action: manipulation already stops zoom on them.
    const control = t instanceof Element && t.closest('button, input, select, textarea, label');
    if (now - lastTouchEnd < 350 && !control) e.preventDefault();
    lastTouchEnd = now;
  },
  { passive: false }
);
// Belt and braces against selection and the iOS long-press callout while steering.
canvas.addEventListener('selectstart', (e) => e.preventDefault());
canvas.addEventListener('dragstart', (e) => e.preventDefault());
canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
document.addEventListener('selectstart', (e) => {
  if (state.mode === 'play' && !(e.target instanceof HTMLInputElement)) e.preventDefault();
});

function applyControls() {
  const w = state.world;
  const p = w && w.player;
  if (!p || state.mode !== 'play') return;
  let dx = 0;
  let dy = 0;
  for (const k of state.keys) {
    const v = KEYMAP[k];
    if (v) {
      dx += v[0];
      dy += v[1];
    }
  }
  const r = state.renderer;
  let thrust = dx || dy ? 1 : 0;
  if (state.pointer.down) {
    const s = r.worldToScreen(p.x, p.y);
    const vx = state.pointer.x - s.x;
    const vy = state.pointer.y - s.y;
    const d = Math.hypot(vx, vy);
    if (d > 6) {
      dx = vx;
      dy = vy;
      thrust = Math.min(1, d / 60);
    }
  }
  p.ctrl.dx = dx;
  p.ctrl.dy = dy;
  p.ctrl.thrust = thrust;
  p.ctrl.boost = state.keys.has('ShiftLeft') || state.keys.has('ShiftRight') || state.sprintHeld;
  r.lookTarget = state.pointer.inside || state.pointer.down ? r.screenToWorld(state.pointer.x, state.pointer.y) : null;
}

// ---------------------------------------------------------------- buttons

$('btn-start').addEventListener('click', startGame);
// Difficulty: remembered on this device for the next new lineage.
try {
  const d = localStorage.getItem('primordia.difficulty');
  if (d === 'easy' || d === 'normal') state.difficulty = d;
} catch {
  /* default */
}
function syncDifficulty() {
  for (const b of document.querySelectorAll('.diff-row .seg')) b.setAttribute('aria-checked', String(b.dataset.diff === state.difficulty));
}
for (const b of document.querySelectorAll('.diff-row .seg')) {
  b.addEventListener('click', () => {
    state.difficulty = b.dataset.diff;
    syncDifficulty();
    try {
      localStorage.setItem('primordia.difficulty', state.difficulty);
    } catch {
      /* not critical */
    }
  });
}
syncDifficulty();
$('btn-continue-save').addEventListener('click', continueGame);
$('btn-save-now').addEventListener('click', () => {
  saveGame();
  updateSaveStatus();
});
$('btn-reroll').addEventListener('click', rerollName);
$('btn-howto').addEventListener('click', () => openHelp('title'));
$('btn-help2').addEventListener('click', () => openHelp('pause'));
$('btn-divide').addEventListener('click', tryDivide);
$('btn-cyst').addEventListener('click', toggleCyst);
$('btn-toxin').addEventListener('click', () => state.world.player && state.world.releaseToxin(state.world.player));
$('btn-eco').addEventListener('click', () => setMode(state.mode === 'eco' ? 'play' : 'eco'));
$('btn-pause').addEventListener('click', () => setMode('pause'));
$('btn-speed').addEventListener('click', () => {
  state.speed = state.speed >= 3 ? 1 : state.speed + 1;
  $('btn-speed').textContent = `${state.speed}×`;
});
const sprint = $('btn-sprint');
sprint.addEventListener('pointerdown', () => (state.sprintHeld = true));
sprint.addEventListener('pointerup', () => (state.sprintHeld = false));
sprint.addEventListener('pointerleave', () => (state.sprintHeld = false));
$('btn-quit').addEventListener('click', () => {
  saveGame();
  setWorld(makeAttractWorld());
  setMode('title');
});
// Save when the tab is hidden or closed, so leaving never loses progress.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.mode !== 'title') saveGame();
});
window.addEventListener('pagehide', () => {
  if (state.mode !== 'title' && hasLineage()) saves.saveLocal(state.world, saveMeta());
});
$('btn-again').addEventListener('click', () => {
  setWorld(makeAttractWorld());
  setMode('title');
});
$('btn-continue').addEventListener('click', () => setMode('play'));
for (const el of document.querySelectorAll('[data-close]')) {
  el.addEventListener('click', () => {
    if (state.mode === 'help') setMode(state.returnMode);
    else setMode('play');
  });
}
function onScreenChange() {
  state.renderer?.resize();
  if (editor.open_) editor.resize();
}
window.addEventListener('resize', onScreenChange);
window.addEventListener('orientationchange', () => setTimeout(onScreenChange, 250));
window.visualViewport?.addEventListener('resize', onScreenChange);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) onScreenChange();
});

// ---------------------------------------------------------------- loop

let last = performance.now();
let acc = 0;
let ecoTimer = 0;
let autosaveTimer = 20;
let cloudTimer = 60;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const w = state.world;
  const r = state.renderer;
  const simulating = state.mode === 'play' || state.mode === 'title';
  if (simulating && w) {
    applyControls();
    acc += dt * (state.mode === 'title' ? 1 : state.speed);
    let steps = 0;
    while (acc >= SIM_DT && steps < 8) {
      w.step(SIM_DT);
      acc -= SIM_DT;
      steps++;
      if (w.pendingRespawn) {
        acc = 0;
        break;
      }
    }
    if (steps >= 8) acc = 0;
  }
  if (r && w) {
    if (state.mode === 'title') {
      // Slow drift across the pond behind the title.
      r.cam.x = w.size / 2 + Math.cos(now / 30000) * 900;
      r.cam.y = w.size / 2 + Math.sin(now / 24000) * 700;
      r.cam.span = 620;
    }
    if (state.mode !== 'editor') {
      r.update(simulating ? dt : 0);
      r.render();
    }
  }
  if (w && state.mode !== 'title') {
    handleEvents();
    if (state.mode === 'play') {
      hud.tick(dt);
      hud.update(dt, w, r);
      checkGoals(dt);
      // Autosave: locally every 20 s, to the account every minute.
      autosaveTimer -= dt;
      cloudTimer -= dt;
      if (autosaveTimer <= 0) {
        autosaveTimer = 20;
        const cloud = cloudTimer <= 0;
        if (cloud) cloudTimer = 60;
        saveGame(cloud);
      }
    }
    if (state.mode === 'eco') {
      ecoTimer -= dt;
      if (ecoTimer <= 0) {
        ecoTimer = 2;
        renderEco(w);
      }
    }
  } else if (w) w.events.length = 0;
  if (state.mode === 'event') drawEventArt(now / 1000);
  updateAudio(dt);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- sound

let dangerTimer = 0;
let danger = 0;
/** How threatened the player is right now (0–1), for the music's danger layer. */
function dangerLevel(w) {
  const p = w.player;
  if (!p) return 0;
  let d = p.infection ? 0.45 : 0;
  const reach = 160 + p.r * 4;
  w.cellHash.query(p.x, p.y, reach, (o) => {
    if (o === p || o.dead || o.speciesId === p.speciesId || o.cyst) return;
    const ph = o.ph;
    const can = (ph.bite > 0 && o.r > p.r * 0.55) || (ph.lytic > 0 && o.r < p.r * 2.5) || (ph.engulf && p.r < o.r * 0.6);
    if (!can) return;
    const dist = Math.hypot(o.x - p.x, o.y - p.y) - o.r - p.r;
    if (dist < reach) d = Math.max(d, 1 - Math.max(0, dist) / reach);
  });
  for (const g of w.giants) {
    const m = g.mouth || g;
    const dist = Math.hypot(m.x - p.x, m.y - p.y);
    if (dist < 520) d = Math.max(d, 1.1 - dist / 520);
  }
  return Math.min(1, d);
}

function updateAudio(dt) {
  const w = state.world;
  if (!audio.ready) return;
  const playing = w && w.player && state.mode !== 'title' && state.mode !== 'over';
  dangerTimer -= dt;
  if (dangerTimer <= 0) {
    dangerTimer = 0.4;
    danger = playing && state.mode === 'play' ? dangerLevel(w) : 0;
  }
  const env = playing ? w.player.env : null;
  const light = env ? Math.min(1, env.light * 1.3) : 0.6;
  const night = w ? Math.max(0, Math.min(1, 1 - w.env.dayLight * 1.6)) : 0;
  audio.update(dt, { mode: state.mode, light, night: state.mode === 'title' ? 0 : night, danger });
}

function syncAudioUI() {
  const st = audio.settings;
  $('vol-music').value = st.music;
  $('vol-sfx').value = st.sfx;
  const on = !st.muted;
  for (const id of ['btn-sound', 'btn-sound-title']) {
    const b = $(id);
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('off', !on);
  }
  $('btn-sound').title = on ? 'Sound on (M)' : 'Sound off (M)';
  $('btn-sound-title').textContent = on ? 'Sound: on' : 'Sound: off';
  $('sound-status').textContent = audio.status();
}
$('btn-sound-test').addEventListener('click', () => {
  if (audio.settings.muted) audio.setMuted(false);
  audio.test();
  setTimeout(syncAudioUI, 300);
});
$('vol-music').addEventListener('input', (e) => audio.setMusicVolume(Number(e.target.value)));
$('vol-sfx').addEventListener('input', (e) => {
  audio.setSfxVolume(Number(e.target.value));
  audio.sfx('absorb');
});
for (const id of ['btn-sound', 'btn-sound-title']) {
  $(id).addEventListener('click', () => {
    audio.toggleMute();
    syncAudioUI();
  });
}
// A soft tick for every button press.
document.addEventListener('click', (e) => {
  if (e.target instanceof Element && e.target.closest('button')) audio.sfx('click');
});
syncAudioUI();

// ---------------------------------------------------------------- boot

buildTitle();
setWorld(makeAttractWorld());
setMode('title');
requestAnimationFrame(frame);

// ---------------------------------------------------------------- installable app

// Only the hosted source version (index.html with its manifest) is an
// installable app; the single-file and claude.ai builds skip all of this.
const installable = !!document.querySelector('link[rel="manifest"]') && /^https?:$/.test(location.protocol);
if (installable && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline play just won't be available */
    });
  });
}
// Ask the browser to keep saved games even when storage runs low.
function keepSaves() {
  try {
    navigator.storage?.persist?.().catch(() => {});
  } catch {
    /* not supported */
  }
}
// Chrome and Edge on Android offer an install prompt; show a button for it.
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('btn-install').hidden = false;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  $('btn-install').hidden = true;
});
$('btn-install').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  try {
    await installPrompt.userChoice;
  } catch {
    /* dismissed */
  }
  installPrompt = null;
  $('btn-install').hidden = true;
});

// Debug handle for the console.
window.primordia = { state, cloneGenome, editor, saves, audio };
