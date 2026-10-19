const BPM = 104;
const STEP = 60 / BPM / 2; // eighth notes
const LOOKAHEAD = 0.25;

// A cheerful 4-bar pentatonic loop (MIDI notes, -1 = rest), one entry per eighth note.
const MELODY = [
  76, -1, 79, 76, 74, -1, 72, -1, 81, -1, 79, 76, 79, -1, -1, -1, 72, -1, 74, 76, 79, -1, 76, 74, 72, -1, 74, -1, 76, -1, -1, -1,
];
// C, Am, F, G
const BASS = [48, 45, 41, 43];

const freq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Tiny scheduler-based background tune: marimba-ish plucks over a soft bass. */
export class Music {
  private timer = 0;
  private step = 0;
  private next = 0;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
  ) {}

  start(): void {
    if (this.timer) return;
    this.next = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 60);
  }

  stop(): void {
    if (!this.timer) return;
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  private schedule(): void {
    while (this.next < this.ctx.currentTime + LOOKAHEAD) {
      const i = this.step % MELODY.length;
      const note = MELODY[i];
      if (note > 0) this.pluck(freq(note), this.next, 0.09, 0.35);
      if (i % 8 === 0 || i % 8 === 4) this.pluck(freq(BASS[Math.floor(i / 8)]), this.next, 0.12, 0.5, 'sine');
      if (i % 2 === 1) this.pluck(freq(note > 0 ? note + 12 : 84), this.next, 0.012, 0.05);
      this.step++;
      this.next += STEP;
    }
  }

  private pluck(f: number, t: number, vol: number, dur: number, type: OscillatorType = 'triangle'): void {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
}
