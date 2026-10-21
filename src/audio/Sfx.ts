import { LOBBY_TRACK_URL, LobbyTrack } from './LobbyTrack';
import { Music } from './Music';

export type SfxName =
  | 'swing'
  | 'chop'
  | 'throw'
  | 'hit'
  | 'kill'
  | 'bite'
  | 'squeak'
  | 'groan'
  | 'dash'
  | 'eat'
  | 'pickup'
  | 'downed'
  | 'revived'
  | 'turned'
  | 'rescued'
  | 'splash'
  | 'thud'
  | 'snore'
  | 'wake'
  | 'toss'
  | 'pop'
  | 'bang'
  | 'win'
  | 'lose'
  // Infinite mode.
  | 'build'
  | 'gatherWood'
  | 'gatherStone'
  | 'gatherBamboo'
  | 'gatherScrap'
  | 'chomp'
  | 'smash'
  | 'crafted'
  | 'deposit'
  | 'deny'
  | 'siegeHorn'
  | 'dawn'
  | 'dusk';

/** How far away (metres) a sound can still be heard. */
const HEARING = 38;

/** Sound effects are synthesised with WebAudio; the only audio file is the menu music (see LobbyTrack). */
export class Sfx {
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private music: Music | null = null;
  private lobbyTrack: LobbyTrack | null = null;
  private soundOn = true;
  private musicOn = true;
  private wantMusic = false;
  private scene: 'menu' | 'match' = 'menu';
  private lx = 0;
  private lz = 0;

  /** Must be called from a user gesture (tap/click) before anything can play. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.sfxBus.connect(master);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.35;
      this.musicBus.connect(master);

      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      this.music = new Music(ctx, this.musicBus);
      this.lobbyTrack = new LobbyTrack(ctx, this.musicBus, LOBBY_TRACK_URL, () => this.applyEnabled());
      this.applyEnabled();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setEnabled(sound: boolean, music: boolean): void {
    this.soundOn = sound;
    this.musicOn = music;
    this.applyEnabled();
  }

  /** Music plays only while wanted (in a match or the menu) and enabled. */
  setMusic(wanted: boolean): void {
    this.wantMusic = wanted;
    this.applyEnabled();
  }

  /** Menus play the lobby track (the synth tune if it's missing); matches play the synth tune. */
  setScene(scene: 'menu' | 'match'): void {
    this.scene = scene;
    this.applyEnabled();
  }

  setListener(x: number, z: number): void {
    this.lx = x;
    this.lz = z;
  }

  play(name: SfxName, at?: { x: number; z: number }, volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.soundOn) return;

    let vol = volume;
    let pan = 0;
    if (at) {
      const dx = at.x - this.lx;
      const d = Math.hypot(dx, at.z - this.lz);
      if (d > HEARING) return;
      vol *= 1 - d / HEARING;
      pan = Math.max(-1, Math.min(1, dx / 20));
    }
    const out = ctx.createGain();
    out.gain.value = vol;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      out.connect(p);
      p.connect(this.sfxBus);
    } else {
      out.connect(this.sfxBus);
    }
    this.recipe(name, out);
  }

  private applyEnabled(): void {
    if (this.sfxBus) this.sfxBus.gain.value = this.soundOn ? 1 : 0;
    if (!this.music) return;
    const on = this.musicOn && this.wantMusic;
    const track = this.scene === 'menu' && this.lobbyTrack?.ok ? this.lobbyTrack : null;
    if (on && track) track.start();
    else this.lobbyTrack?.stop();
    if (on && !track) this.music.start();
    else this.music.stop();
  }

  private recipe(name: SfxName, out: AudioNode): void {
    const r = (a: number, b: number) => a + Math.random() * (b - a);
    switch (name) {
      case 'swing':
        this.sweep('bandpass', 1200, 3400, 1.2, 0.16, 0.5, out);
        break;
      case 'chop':
        this.sweep('bandpass', 500, 1500, 1, 0.28, 0.6, out);
        this.tone('sine', 140, 70, 0.2, 0.3, out, 0.12);
        break;
      case 'throw':
        this.sweep('bandpass', 900, 2600, 2, 0.3, 0.45, out);
        this.tone('sine', 900, 600, 0.25, 0.06, out);
        break;
      case 'hit':
        this.tone('sine', r(150, 190), 60, 0.16, 0.7, out);
        this.sweep('lowpass', 1200, 400, 0.7, 0.12, 0.5, out);
        break;
      case 'kill':
        this.tone('sine', 170, 55, 0.2, 0.7, out);
        this.sweep('lowpass', 900, 250, 0.8, 0.25, 0.6, out);
        this.tone('square', 520, 180, 0.18, 0.08, out, 0.04);
        break;
      case 'bite':
        this.sweep('lowpass', 1600, 500, 1, 0.08, 0.7, out);
        this.sweep('lowpass', 1600, 500, 1, 0.08, 0.7, out, 0.11);
        this.tone('sine', 120, 80, 0.15, 0.35, out);
        break;
      case 'squeak':
        this.tone('sine', 900, 1500, 0.1, 0.22, out);
        this.tone('sine', 1500, 1100, 0.08, 0.18, out, 0.1);
        break;
      case 'groan':
        this.groan(r(75, 110), r(0.7, 1.1), 0.35, out);
        break;
      case 'dash':
        this.sweep('highpass', 600, 2400, 0.7, 0.22, 0.35, out);
        break;
      case 'eat':
        for (let i = 0; i < 3; i++) this.sweep('lowpass', 1100, 500, 1, 0.07, 0.5, out, i * 0.12);
        this.tone('triangle', 880, 1320, 0.12, 0.15, out, 0.36);
        break;
      case 'pickup':
        this.tone('triangle', 660, 660, 0.08, 0.25, out);
        this.tone('triangle', 990, 990, 0.14, 0.25, out, 0.08);
        break;
      case 'downed':
        [440, 330, 220].forEach((f, i) => this.tone('triangle', f, f * 0.97, 0.22, 0.3, out, i * 0.2));
        break;
      case 'revived':
        [523, 659, 784].forEach((f, i) => this.tone('triangle', f, f, 0.14, 0.28, out, i * 0.1));
        break;
      case 'turned':
        this.groan(60, 1.4, 0.5, out);
        this.tone('sawtooth', 220, 60, 0.9, 0.12, out);
        break;
      case 'rescued':
        [523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, 0.16, 0.3, out, i * 0.09));
        break;
      case 'splash':
        this.sweep('bandpass', 1600, 500, 0.8, 0.35, 0.5, out);
        break;
      case 'thud':
        this.tone('sine', 220, 90, 0.1, 0.4, out);
        this.sweep('lowpass', 900, 300, 1, 0.06, 0.3, out);
        break;
      case 'snore':
        // Breathe in (rising rasp), then a low rumbling breath out.
        this.sweep('lowpass', 300, 900, 4, 0.7, 0.35, out);
        this.groan(r(48, 60), 0.8, 0.22, out, 0.75);
        break;
      case 'wake':
        // A startled, rising "huh?!"
        this.groan(r(90, 120), 0.45, 0.4, out);
        this.tone('sawtooth', 160, 320, 0.25, 0.08, out, 0.1);
        break;
      case 'toss':
        this.sweep('bandpass', 700, 1800, 2, 0.22, 0.35, out);
        this.sweep('highpass', 3000, 6000, 1, 0.4, 0.12, out, 0.05);
        break;
      case 'pop':
        this.sweep('highpass', r(1800, 2600), 900, 0.8, 0.05, 0.9, out);
        this.tone('square', r(700, 1100), 200, 0.04, 0.12, out);
        break;
      case 'bang':
        this.tone('sine', 120, 35, 0.5, 0.9, out);
        this.sweep('lowpass', 3000, 200, 0.7, 0.6, 0.9, out);
        this.sweep('highpass', 4000, 1500, 0.8, 0.15, 0.6, out);
        break;
      case 'win':
        [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, i === 5 ? 0.6 : 0.16, 0.3, out, i * 0.13));
        break;
      case 'lose':
        [392, 370, 349, 294].forEach((f, i) => this.tone('triangle', f, f * 0.98, i === 3 ? 0.8 : 0.3, 0.3, out, i * 0.32));
        break;
      case 'build':
        // Two hammer knocks on wood.
        for (let i = 0; i < 2; i++) {
          this.tone('triangle', r(380, 440), 260, 0.07, 0.35, out, i * 0.13);
          this.sweep('lowpass', 1500, 500, 1, 0.06, 0.45, out, i * 0.13);
        }
        break;
      case 'gatherWood':
        // A dull thunk into a trunk.
        this.sweep('bandpass', 800, 300, 2, 0.12, 0.6, out);
        this.tone('sine', r(170, 200), 90, 0.12, 0.4, out);
        break;
      case 'gatherStone':
        // Pick on rock: a bright clink and grit.
        this.tone('square', r(1400, 1700), 1250, 0.05, 0.1, out);
        this.tone('triangle', r(2300, 2600), 2100, 0.09, 0.14, out);
        this.sweep('highpass', 3200, 1500, 1, 0.07, 0.35, out);
        break;
      case 'gatherBamboo':
        // Hollow "tok" of a bamboo cane.
        this.tone('sine', r(650, 760), 520, 0.09, 0.45, out);
        this.tone('sine', 1050, 800, 0.06, 0.18, out, 0.02);
        break;
      case 'gatherScrap':
        // Rattling tin.
        for (let i = 0; i < 3; i++) this.tone('square', r(900, 1500), r(600, 900), 0.04, 0.07, out, i * 0.05);
        this.sweep('bandpass', 3200, 1900, 6, 0.16, 0.3, out);
        break;
      case 'chomp':
        // A zombie gnawing on a wall.
        this.sweep('lowpass', 1800, 400, 1, 0.1, 0.6, out);
        this.tone('sine', 140, 70, 0.12, 0.3, out);
        break;
      case 'smash':
        // A piece collapsing: a crash, then clattering bits.
        this.sweep('lowpass', 2600, 150, 0.9, 0.7, 0.8, out);
        this.tone('sine', 110, 40, 0.5, 0.6, out);
        for (let i = 0; i < 3; i++) this.sweep('bandpass', r(900, 1800), 500, 3, 0.08, 0.3, out, 0.2 + i * 0.11);
        break;
      case 'crafted':
        this.tone('triangle', 784, 784, 0.1, 0.25, out);
        this.tone('triangle', 1175, 1175, 0.22, 0.25, out, 0.09);
        this.sweep('highpass', 4000, 7000, 1, 0.25, 0.12, out, 0.09);
        break;
      case 'deposit':
        // Stuff tumbling into a chest, and a lid knock.
        for (let i = 0; i < 3; i++) this.sweep('lowpass', 1300, 450, 1, 0.07, 0.4, out, i * 0.07);
        this.tone('triangle', 330, 220, 0.12, 0.3, out, 0.25);
        break;
      case 'deny':
        this.tone('square', 190, 170, 0.1, 0.1, out);
        this.tone('square', 150, 135, 0.14, 0.1, out, 0.13);
        break;
      case 'siegeHorn':
        // Two long, low horn blasts, the second one higher.
        this.horn(98, 1.3, 0.45, out);
        this.horn(131, 1.6, 0.5, out, 1.45);
        break;
      case 'dawn':
        // A soft rising arpeggio and a couple of birds.
        [392, 523, 659, 784].forEach((f, i) => this.tone('triangle', f, f, 0.35, 0.16, out, i * 0.14));
        this.tone('sine', 2400, 3300, 0.07, 0.08, out, 0.75);
        this.tone('sine', 2600, 3500, 0.06, 0.07, out, 0.9);
        break;
      case 'dusk':
        // Falling notes, then an owl.
        [659, 523, 440, 330].forEach((f, i) => this.tone('triangle', f, f * 0.99, 0.4, 0.14, out, i * 0.18));
        this.tone('sine', 430, 380, 0.28, 0.12, out, 1.0);
        this.tone('sine', 410, 360, 0.4, 0.12, out, 1.35);
        break;
    }
  }

  /** A brassy horn note: sawtooth through a low-pass that opens slowly, with a soft attack. */
  private horn(freq: number, dur: number, vol: number, out: AudioNode, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq * 0.94, t);
    osc.frequency.linearRampToValueAtTime(freq, t + 0.25);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(250, t);
    filter.frequency.linearRampToValueAtTime(900, t + dur * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.25);
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filter);
    filter.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private env(gain: GainNode, start: number, dur: number, vol: number): void {
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, out: AudioNode, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, dur, vol);
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Filtered noise whose filter frequency sweeps from f0 to f1. */
  private sweep(type: BiquadFilterType, f0: number, f1: number, q: number, dur: number, vol: number, out: AudioNode, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true; // long sweeps from a random offset would otherwise run off the 1 s buffer
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, dur, vol);
    src.connect(filter);
    filter.connect(g);
    g.connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private groan(freq: number, dur: number, vol: number, out: AudioNode, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq * 1.15, t);
    osc.frequency.linearRampToValueAtTime(freq * 0.85, t + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5 + Math.random() * 3;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = freq * 0.06;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filter);
    filter.connect(g);
    g.connect(out);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }
}
