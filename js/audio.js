// Generative ambient music and synthesized sound effects (Web Audio).
//
// Nothing is pre-recorded. Slow pads, a low drone, glassy bells and a hiss of
// water are built from oscillators and noise, and they follow the game:
//  - each era has its own key and scale,
//  - light brightens the sound and brings more bells; night darkens it,
//  - danger (a predator close by, the rotifer, an infection) adds a low throb,
//  - the editor and pause menu soften it.
// Effects are tuned to the current scale, so eating plays notes that fit.

const KEY = 'primordia.audio.v1';

// root: MIDI note of the key; scale: semitones; pace: how busy it gets.
const MOODS = {
  title: { root: 50, scale: [0, 2, 4, 7, 9], pace: 0.8 },
  primordial: { root: 50, scale: [0, 2, 4, 7, 9], pace: 1 }, // D major pentatonic: warm, open
  oxidation: { root: 52, scale: [0, 2, 3, 5, 7, 9, 10], pace: 1.15 }, // E dorian: brighter, restless
  glaciation: { root: 54, scale: [0, 2, 3, 7, 8], pace: 0.7 }, // F# minor pentatonic-ish: glassy, sparse
  volcanic: { root: 45, scale: [0, 1, 3, 5, 7, 8, 10], pace: 1.2 }, // A phrygian: dark
  blooms: { root: 48, scale: [0, 2, 4, 6, 7, 9, 11], pace: 1 }, // C lydian: lush
};

// Chord roots as scale degrees, and where each tends to move next.
const MOVES = { 0: [3, 4, 5, 1], 1: [4, 0, 3], 3: [0, 4, 1], 4: [0, 5, 3], 5: [3, 1, 4, 0] };

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && typeof s === 'object') return { music: num(s.music, 0.6), sfx: num(s.sfx, 0.7), muted: !!s.muted };
  } catch {
    // Storage can be unavailable (private mode); fall back to defaults.
  }
  return { music: 0.6, sfx: 0.7, muted: false };
}
function num(v, d) {
  return typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : d;
}

export class Audio {
  constructor() {
    this.settings = loadSettings();
    this.ctx = null;
    this.ready = false;
    this.mood = MOODS.title;
    this.moodId = 'title';
    this.degree = 0;
    this.nextChord = 0;
    this.nextBell = 0;
    this.nextBubble = 0;
    this.last = {};
    this.state = { light: 0.6, night: 0, danger: 0, mode: 'title' };
    this.smooth = { light: 0.6, danger: 0 };
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else if (!this.settings.muted) this.ctx.resume();
    });
  }

  // ------------------------------------------------------------ setup

  /** Browsers only allow sound after a tap or key press. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state !== 'running' && !this.settings.muted && !document.hidden) this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC({ latencyHint: 'playback' });
    } catch {
      return;
    }
    this.build();
    this.ready = true;
    this.applyVolumes(true);
    if (this.settings.muted) this.ctx.suspend();
    const now = this.ctx.currentTime;
    this.nextChord = now + 0.3;
    this.nextBell = now + 2;
    this.nextBubble = now + 1;
  }

  build() {
    const ctx = this.ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.02;
    comp.release.value = 0.4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);

    // A long, soft reverb: the inside of a drop of water, magnified.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.6);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.reverb.connect(this.wet);
    this.wet.connect(this.master);

    // Music: everything passes a tone filter that light opens and night closes.
    this.music = ctx.createGain();
    this.toneFilter = ctx.createBiquadFilter();
    this.toneFilter.type = 'lowpass';
    this.toneFilter.frequency.value = 2400;
    this.toneFilter.Q.value = 0.3;
    this.music.connect(this.toneFilter);
    this.toneFilter.connect(this.master);
    this.musicSend = ctx.createGain();
    this.musicSend.gain.value = 0.7;
    this.toneFilter.connect(this.musicSend);
    this.musicSend.connect(this.reverb);
    // Ducking for the editor and pause menu.
    this.duck = ctx.createGain();
    this.duck.connect(this.music);

    // Pads go through one shared filter with a very slow sweep.
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0.16;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 900;
    this.padFilter.Q.value = 0.8;
    this.padBus.connect(this.padFilter);
    this.padFilter.connect(this.duck);
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.045;
    const sweepAmt = ctx.createGain();
    sweepAmt.gain.value = 380;
    sweep.connect(sweepAmt);
    sweepAmt.connect(this.padFilter.frequency);
    sweep.start();

    // Drone: the key's root, two octaves down, with a soft fifth.
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.07;
    this.droneGain.connect(this.duck);
    this.drone = [0, 7, 12].map((iv, i) => {
      const o = ctx.createOscillator();
      o.type = i === 1 ? 'triangle' : 'sine';
      o.frequency.value = mtof(this.mood.root - 24 + iv);
      const g = ctx.createGain();
      g.gain.value = [1, 0.35, 0.4][i];
      o.connect(g);
      g.connect(this.droneGain);
      o.start();
      return { o, iv };
    });
    // The drone breathes.
    const breath = ctx.createOscillator();
    breath.frequency.value = 0.07;
    const breathAmt = ctx.createGain();
    breathAmt.gain.value = 0.025;
    breath.connect(breathAmt);
    breathAmt.connect(this.droneGain.gain);
    breath.start();

    // Water: filtered noise drifting in and out.
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(3);
    noise.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 420;
    wf.Q.value = 0.6;
    const wfl = ctx.createOscillator();
    wfl.frequency.value = 0.06;
    const wfla = ctx.createGain();
    wfla.gain.value = 180;
    wfl.connect(wfla);
    wfla.connect(wf.frequency);
    wfl.start();
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0.05;
    noise.connect(wf);
    wf.connect(this.waterGain);
    this.waterGain.connect(this.duck);
    noise.start();

    // Danger: a dissonant low pulse, silent until something threatens you.
    this.dangerGain = ctx.createGain();
    this.dangerGain.gain.value = 0;
    this.dangerGain.connect(this.duck);
    const am = ctx.createGain();
    am.gain.value = 0.55;
    am.connect(this.dangerGain);
    const pulse = ctx.createOscillator();
    pulse.frequency.value = 1.3;
    const pulseAmt = ctx.createGain();
    pulseAmt.gain.value = 0.45;
    pulse.connect(pulseAmt);
    pulseAmt.connect(am.gain);
    pulse.start();
    const df = ctx.createBiquadFilter();
    df.type = 'lowpass';
    df.frequency.value = 520;
    df.connect(am);
    this.dangerOsc = [1, 6].map((iv, i) => {
      const o = ctx.createOscillator();
      o.type = i ? 'triangle' : 'sawtooth';
      o.frequency.value = mtof(this.mood.root - 24 + iv);
      const g = ctx.createGain();
      g.gain.value = i ? 0.5 : 0.35;
      o.connect(g);
      g.connect(df);
      o.start();
      return { o, iv };
    });

    // Effects.
    this.fx = ctx.createGain();
    this.fx.connect(this.master);
    this.fxSend = ctx.createGain();
    this.fxSend.gain.value = 0.35;
    this.fx.connect(this.fxSend);
    this.fxSend.connect(this.reverb);
  }

  impulse(sec) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (t < 0.01 ? t / 0.01 : 1);
      }
    }
    return buf;
  }

  noiseBuffer(sec) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Brownish noise: softer than white, like distant water.
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04;
      d[i] = last * 3.2;
    }
    return buf;
  }

  // ------------------------------------------------------------ settings

  applyVolumes(instant = false) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const m = this.settings.music * 0.9;
    const s = this.settings.sfx * 0.8;
    if (instant) {
      this.music.gain.value = m;
      this.fx.gain.value = s;
    } else {
      this.music.gain.setTargetAtTime(m, t, 0.1);
      this.fx.gain.setTargetAtTime(s, t, 0.05);
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.settings));
    } catch {
      // Not critical.
    }
  }

  setMusicVolume(v) {
    this.settings.music = num(v, 0.6);
    this.applyVolumes();
    this.save();
  }

  setSfxVolume(v) {
    this.settings.sfx = num(v, 0.7);
    this.applyVolumes();
    this.save();
  }

  toggleMute() {
    this.setMuted(!this.settings.muted);
  }

  setMuted(m) {
    this.settings.muted = m;
    this.save();
    if (!this.ctx) {
      if (!m) this.unlock();
      return;
    }
    if (m) this.ctx.suspend();
    else this.ctx.resume();
  }

  // ------------------------------------------------------------ music

  setEra(id) {
    const mood = MOODS[id] || MOODS.primordial;
    if (mood === this.mood) return;
    this.mood = mood;
    this.moodId = id;
    this.degree = 0;
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    for (const d of this.drone) d.o.frequency.setTargetAtTime(mtof(mood.root - 24 + d.iv), t, 2.5);
    for (const d of this.dangerOsc) d.o.frequency.setTargetAtTime(mtof(mood.root - 24 + d.iv), t, 2.5);
  }

  /** Note `step` steps up the current scale from the root (wraps into octaves). */
  note(step, octave = 0) {
    const sc = this.mood.scale;
    const n = sc.length;
    const o = Math.floor(step / n);
    return this.mood.root + octave * 12 + o * 12 + sc[((step % n) + n) % n];
  }

  /**
   * Called every frame. info: { mode, light (0–1), night (0–1), danger (0–1) }.
   */
  update(dt, info) {
    if (!this.ready || this.ctx.state !== 'running') return;
    Object.assign(this.state, info);
    const st = this.state;
    const k = Math.min(1, dt * 0.8);
    this.smooth.light += (st.light - this.smooth.light) * k;
    this.smooth.danger += (st.danger - this.smooth.danger) * Math.min(1, dt * (st.danger > this.smooth.danger ? 2 : 0.5));
    const t = this.ctx.currentTime;
    const light = this.smooth.light;
    const night = st.night;

    // Light opens the tone; night closes it.
    const cutoff = 700 + 4200 * light * (1 - 0.6 * night);
    this.toneFilter.frequency.setTargetAtTime(cutoff, t, 0.5);
    this.padFilter.frequency.setTargetAtTime(500 + 900 * light, t, 1);
    const duck = st.mode === 'pause' || st.mode === 'help' ? 0.4 : st.mode === 'editor' || st.mode === 'eco' ? 0.7 : 1;
    this.duck.gain.setTargetAtTime(duck, t, 0.4);
    this.dangerGain.gain.setTargetAtTime(this.smooth.danger * 0.16, t, 0.3);
    this.waterGain.gain.setTargetAtTime(0.035 + 0.03 * (1 - light), t, 1);

    const pace = this.mood.pace;
    if (t > this.nextChord - 0.25) this.playChord(Math.max(t, this.nextChord), pace);
    if (t > this.nextBell - 0.15) {
      const when = Math.max(t, this.nextBell);
      // Bells follow the light: sparse in the dark, lively in sunlit water.
      const density = (0.35 + 1.1 * light) * (1 - 0.55 * night) * pace * (1 - 0.6 * this.smooth.danger);
      if (Math.random() < 0.85) this.playBell(when, night);
      if (Math.random() < 0.22 * density) this.playBell(when + rand(0.18, 0.4), night, true);
      this.nextBell = when + rand(1.4, 4.2) / Math.max(0.2, density);
    }
    if (t > this.nextBubble) {
      this.bubble(t + 0.05, 0.03);
      this.nextBubble = t + rand(2, 7);
    }
  }

  playChord(when, pace) {
    const ctx = this.ctx;
    const nextOptions = MOVES[this.degree] || MOVES[0];
    this.degree = Math.random() < 0.25 ? this.degree : pick(nextOptions);
    const dur = rand(9, 14) / pace;
    const attack = dur * 0.35;
    const release = 4.5;
    // A spread voicing: root low, then the third and fifth an octave up.
    const steps = [this.degree, this.degree + 2 + this.mood.scale.length, this.degree + 4];
    if (Math.random() < 0.5) steps.push(this.degree + 6 + this.mood.scale.length);
    for (const s of steps) {
      const f = mtof(this.note(s, -1));
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(1 / steps.length, when + attack);
      g.gain.setValueAtTime(1 / steps.length, when + dur);
      g.gain.linearRampToValueAtTime(0, when + dur + release);
      g.connect(this.padBus);
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det + rand(-2, 2);
        o.connect(g);
        o.start(when);
        o.stop(when + dur + release + 0.1);
      }
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = f;
      sub.connect(g);
      sub.start(when);
      sub.stop(when + dur + release + 0.1);
    }
    this.nextChord = when + dur;
  }

  playBell(when, night, echo = false) {
    const ctx = this.ctx;
    const sc = this.mood.scale.length;
    const step = (Math.random() * sc * 2) | 0;
    const octave = night > 0.5 ? 0 : Math.random() < 0.3 ? 2 : 1;
    const f = mtof(this.note(step, octave));
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * 3.5;
    const modAmt = ctx.createGain();
    modAmt.gain.setValueAtTime(f * 1.2, when);
    modAmt.gain.exponentialRampToValueAtTime(f * 0.02, when + 1.4);
    mod.connect(modAmt);
    modAmt.connect(car.frequency);
    const g = ctx.createGain();
    const peak = (echo ? 0.05 : 0.085) * (night > 0.5 ? 0.8 : 1);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0005, when + 3.2);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    car.connect(g);
    if (pan) {
      pan.pan.value = rand(-0.75, 0.75);
      g.connect(pan);
      pan.connect(this.duck);
    } else g.connect(this.duck);
    car.start(when);
    mod.start(when);
    car.stop(when + 3.4);
    mod.stop(when + 3.4);
  }

  bubble(when, gain) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const f = rand(500, 1100);
    o.frequency.setValueAtTime(f, when);
    o.frequency.exponentialRampToValueAtTime(f * 2.2, when + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.09);
    o.connect(g);
    g.connect(this.duck);
    o.start(when);
    o.stop(when + 0.12);
  }

  // ------------------------------------------------------------ effects

  /** A short enveloped oscillator. */
  tone(o) {
    const ctx = this.ctx;
    const when = o.when ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0, when);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, when + (o.glide ?? o.dur));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(o.gain, when + (o.attack ?? 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, when + o.dur);
    osc.connect(g);
    let out = g;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lp;
      g.connect(f);
      out = f;
    }
    if (o.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = o.pan;
      out.connect(p);
      out = p;
    }
    out.connect(this.fx);
    osc.start(when);
    osc.stop(when + o.dur + 0.05);
  }

  /** A short burst of filtered noise. */
  hiss(o) {
    const ctx = this.ctx;
    const when = o.when ?? ctx.currentTime;
    if (!this._noise) this._noise = this.noiseBuffer(1);
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(o.f0, when);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, when + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(o.gain, when + (o.attack ?? 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, when + o.dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.fx);
    src.start(when, Math.random() * 0.5);
    src.stop(when + o.dur + 0.05);
  }

  /** Play a named effect. Frequent ones are rate-limited. */
  sfx(name) {
    if (!this.ready || this.settings.muted || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const gap = { absorb: 0.16, eat: 0.07, hurt: 0.22, click: 0.04, toxin: 0.3 }[name] || 0.12;
    if (this.last[name] && t - this.last[name] < gap) return;
    this.last[name] = t;
    const N = (step, oct = 0) => mtof(this.note(step, oct));
    const sc = this.mood.scale.length;
    switch (name) {
      case 'absorb':
        this.tone({ f0: N((Math.random() * sc) | 0, 1), dur: 0.35, gain: 0.05, attack: 0.02, pan: rand(-0.3, 0.3) });
        break;
      case 'eat':
        this.tone({ f0: N((Math.random() * sc) | 0, 2), dur: 0.25, gain: 0.09, pan: rand(-0.3, 0.3) });
        this.bubble(t, 0.05);
        break;
      case 'hurt':
        this.tone({ type: 'triangle', f0: 150, f1: 55, dur: 0.25, gain: 0.25 });
        this.hiss({ f0: 900, f1: 300, dur: 0.18, gain: 0.18, q: 1.2 });
        break;
      case 'divide': {
        const base = N(0, 0);
        this.tone({ f0: base, f1: base * 2, dur: 1.1, gain: 0.12, attack: 0.05, glide: 0.6, pan: -0.4 });
        this.tone({ f0: base, f1: base * 1.5, dur: 1.1, gain: 0.12, attack: 0.05, glide: 0.6, pan: 0.4 });
        this.hiss({ filter: 'lowpass', f0: 300, f1: 2400, dur: 0.6, gain: 0.08, attack: 0.2 });
        break;
      }
      case 'chime':
        [0, 2, 4].forEach((s, i) => this.tone({ when: t + i * 0.09, f0: N(s, 1), dur: 1.2, gain: 0.08 }));
        break;
      case 'gene':
        [0, 1, 2, 3, 4].forEach((s, i) => this.tone({ when: t + i * 0.06, f0: N(s * 2, 1), dur: 0.9, gain: 0.06, pan: -0.6 + i * 0.3 }));
        break;
      case 'milestone':
        [0, 2, 4, 7].forEach((s, i) => this.tone({ when: t + i * 0.12, f0: N(s, 1), dur: 2, gain: 0.09 }));
        this.tone({ when: t + 0.48, f0: N(0, 0), dur: 2.5, gain: 0.08, attack: 0.1 });
        break;
      case 'click':
        this.tone({ f0: 1900, dur: 0.04, gain: 0.04 });
        break;
      case 'toxin':
        this.hiss({ filter: 'highpass', f0: 600, f1: 4000, dur: 0.45, gain: 0.12, attack: 0.04, q: 0.7 });
        break;
      case 'engulf':
        this.tone({ f0: 240, f1: 70, dur: 0.45, gain: 0.22, lp: 900 });
        this.bubble(t + 0.1, 0.07);
        this.bubble(t + 0.22, 0.05);
        break;
      case 'infect':
        this.tone({ type: 'triangle', f0: N(4, 0), f1: N(0, -1), dur: 1.3, gain: 0.1, attack: 0.1 });
        this.tone({ type: 'triangle', f0: N(4, 0) * 1.06, f1: N(0, -1) * 1.06, dur: 1.3, gain: 0.08, attack: 0.1 });
        break;
      case 'swell':
        this.hiss({ filter: 'lowpass', f0: 200, f1: 3000, dur: 2.6, gain: 0.08, attack: 2.2 });
        [0, 4, 7 + sc].forEach((s) => this.tone({ when: t + 2, f0: N(s, -1), dur: 4, gain: 0.07, attack: 0.3, type: 'triangle', lp: 1600 }));
        break;
      case 'death':
        this.tone({ type: 'triangle', f0: N(2, 0), f1: N(0, -2), dur: 2, gain: 0.14, attack: 0.05, lp: 1200 });
        break;
      case 'cyst':
        this.tone({ f0: 420, f1: 180, dur: 0.6, gain: 0.12, lp: 800 });
        this.hiss({ filter: 'lowpass', f0: 1600, f1: 200, dur: 0.6, gain: 0.06 });
        break;
    }
  }
}
