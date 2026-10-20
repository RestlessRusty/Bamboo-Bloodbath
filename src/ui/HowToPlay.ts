import type { ControlScheme, Settings } from '../settings';
import { el } from './dom';

type Device = 'touch' | 'keys' | 'pad';
/** [action, how] rows; `how` may contain <kbd> markup. */
type Rows = readonly (readonly [string, string])[];

const BUTTONS: Rows = [
  ['Attack', 'Big red button (hold to keep swinging)'],
  ['Dash', 'Blue button'],
  ['Firecracker', 'Orange button'],
];

const TOUCH: Record<ControlScheme, { name: string; rows: Rows }> = {
  joystick: {
    name: 'Joystick',
    rows: [['Move', 'Drag anywhere on the left half'], ['Sneak', 'Push the stick only halfway'], ...BUTTONS],
  },
  tilt: {
    name: 'Tilt',
    rows: [['Move', 'Tilt the phone'], ['Sneak', 'Tilt gently'], ...BUTTONS],
  },
  tap: {
    name: 'Tap & swipe',
    rows: [
      ['Move', 'Tap the ground to walk there, hold to steer'],
      ['Attack', 'Swipe in a direction'],
      ['Dash', 'Double-tap'],
      ['Firecracker', 'Orange button'],
      ['Sneak', 'Tricky in this mode: try Joystick'],
    ],
  },
};

const KEYS: Rows = [
  ['Move', '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows'],
  ['Sneak', 'Hold <kbd>C</kbd> while moving'],
  ['Attack', '<kbd>Space</kbd>'],
  ['Dash', '<kbd>Shift</kbd>'],
  ['Firecracker', '<kbd>E</kbd>'],
  ['Pause', '<kbd>Esc</kbd>'],
];

const PAD: Rows = [
  ['Move', 'Left stick (push gently to sneak)'],
  ['Attack', '<kbd>A</kbd> / <kbd>X</kbd> / <kbd>RT</kbd>'],
  ['Dash', '<kbd>B</kbd> / <kbd>LT</kbd>'],
  ['Firecracker', '<kbd>Y</kbd> / <kbd>RB</kbd>'],
  ['Pause', '<kbd>Start</kbd>'],
];

const RULES: Rows = [
  ['Bamboo', 'Snacks heal you. Hide in thickets: zombies only spot you up close.'],
  ['Sleepers', 'Zzz… Walk slowly to sneak past, or creep up for a one-hit kill. Running, dashing and splashing wake them.'],
  ['Firecrackers', 'Throw one to pull zombies in, then BANG: they’re stunned. Carry up to 3; zombies drop more.'],
  ['Weapons', 'Walk over a rack to swap. Knife: fast and quiet. Axe: big hits, but loud. Javelins: throw, then pick them up.'],
  ['Downed?', 'Stand next to a downed friend to revive them. After 10 seconds they turn into a zombie!'],
  ['Water', 'Zombies can’t swim: they cross only at bridges and shallow fords. You can, slowly. Ice is slippery!'],
];

const rowsHtml = (rows: Rows) => rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');

/** "How to play" card: goal, controls for the chosen input device, and the main rules. */
export class HowToPlay {
  private readonly el: HTMLDivElement;
  private device: Device = 'touch';

  constructor(
    parent: HTMLElement,
    private readonly settings: Settings,
  ) {
    this.el = el(
      'div',
      'modal',
      `<div class="card howto">
        <h2>How to play</h2>
        <p class="howto-goal">Reach the <b>rescue hut</b> before time runs out: the arrow shows the way. Story chapters set their own goals.</p>
        <div class="howto-cols">
          <section>
            <div class="seg" data-ref="devices">
              <button data-v="touch">Touch</button>
              <button data-v="keys">Keyboard</button>
              <button data-v="pad">Gamepad</button>
            </div>
            <dl class="howto-list" data-ref="controls"></dl>
            <p class="hint small" data-ref="note"></p>
          </section>
          <section>
            <dl class="howto-list">${rowsHtml(RULES)}</dl>
          </section>
        </div>
        <button class="btn primary" data-act="close">Got it!</button>
      </div>`,
    );
    this.el.hidden = true;
    parent.appendChild(this.el);

    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-v],[data-act]');
      if (!t) return;
      if (t.dataset.act === 'close') return this.close();
      if (t.dataset.v) {
        this.device = t.dataset.v as Device;
        this.refresh();
      }
    });
  }

  open(): void {
    this.device = defaultDevice(); // a gamepad may have been plugged in since last time
    this.refresh();
    this.el.hidden = false;
  }

  close(): void {
    this.el.hidden = true;
  }

  private refresh(): void {
    for (const b of this.ref('devices').querySelectorAll<HTMLElement>('[data-v]')) {
      b.classList.toggle('active', b.dataset.v === this.device);
    }
    let rows: Rows;
    let note = '';
    if (this.device === 'touch') {
      const t = TOUCH[this.settings.controls];
      rows = t.rows;
      note = `Touch controls: ${t.name}. Change them in Settings.`;
    } else {
      rows = this.device === 'keys' ? KEYS : PAD;
    }
    this.ref('controls').innerHTML = rowsHtml(rows);
    this.ref('note').textContent = note;
    this.ref('note').hidden = !note;
  }

  private ref<T extends HTMLElement = HTMLElement>(name: string): T {
    return this.el.querySelector<T>(`[data-ref="${name}"]`)!;
  }
}

function defaultDevice(): Device {
  if (window.matchMedia('(pointer: coarse)').matches) return 'touch';
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  return pads.some(Boolean) ? 'pad' : 'keys';
}
