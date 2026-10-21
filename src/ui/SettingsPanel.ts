import { requestTiltPermission } from '../input/InputManager';
import type { ControlScheme, Quality, Settings } from '../settings';
import { el, scrollHint } from './dom';

const HINTS: Record<ControlScheme, string> = {
  joystick:
    'Touch anywhere on the left half to move; push only halfway to sneak. Right buttons: attack, dash, firecracker.',
  tilt: 'Tilt the phone to walk (tilt gently to sneak). Hold it comfortably, then tap Recalibrate.',
  tap: 'Tap the ground to walk there, hold to steer, swipe to attack, double-tap to dash. Orange button: firecracker.',
};

export type SettingKey = keyof Settings;

export class SettingsPanel {
  private readonly el: HTMLDivElement;
  private onClose: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    private readonly settings: Settings,
    private readonly onChange: (key: SettingKey) => void,
    private readonly onCalibrate: () => void,
  ) {
    this.el = el(
      'div',
      'modal',
      `<div class="card settings">
        <div class="scroll-body" data-ref="body">
          <h2>Settings</h2>
          <div class="row">
            <span class="row-label">Controls</span>
            <div class="seg" data-setting="controls">
              <button data-v="joystick">Joystick</button>
              <button data-v="tilt">Tilt</button>
              <button data-v="tap">Tap &amp; swipe</button>
            </div>
          </div>
          <p class="hint" data-ref="hint"></p>
          <div class="row" data-ref="tilt-row">
            <span class="row-label">Tilt</span>
            <label class="check"><input type="checkbox" data-ref="flip" /> Flip direction</label>
            <button class="btn small" data-act="calibrate">Recalibrate</button>
          </div>
          <div class="row">
            <span class="row-label">Graphics</span>
            <div class="seg" data-setting="quality">
              <button data-v="low">Fast</button>
              <button data-v="high">Pretty</button>
            </div>
          </div>
          <div class="row">
            <span class="row-label">Audio</span>
            <label class="check"><input type="checkbox" data-ref="sound" /> Sounds</label>
            <label class="check"><input type="checkbox" data-ref="music" /> Music</label>
            <label class="check"><input type="checkbox" data-ref="vibration" /> Vibration</label>
          </div>
          <div class="row">
            <span class="row-label">FPS</span>
            <label class="check"><input type="checkbox" data-ref="fps" /> Show counter</label>
          </div>
          <p class="hint small">On a PC: WASD / arrows to move (hold C to sneak), Space = attack, Shift = dash, E = firecracker, Esc = pause. Gamepads work too.</p>
        </div>
        <div class="card-foot">
          <button class="btn primary" data-act="close">Done</button>
        </div>
      </div>`,
    );
    this.el.hidden = true;
    parent.appendChild(this.el);
    scrollHint(this.ref('body'));

    this.el.addEventListener('click', (e) => void this.onClick(e));
    const toggles: [string, 'flipTilt' | 'showFps' | 'sound' | 'music' | 'vibration'][] = [
      ['flip', 'flipTilt'],
      ['fps', 'showFps'],
      ['sound', 'sound'],
      ['music', 'music'],
      ['vibration', 'vibration'],
    ];
    for (const [ref, key] of toggles) {
      this.ref<HTMLInputElement>(ref).addEventListener('change', (e) => {
        this.settings[key] = (e.target as HTMLInputElement).checked;
        this.onChange(key);
      });
    }
  }

  open(onClose?: () => void): void {
    this.onClose = onClose ?? null;
    this.refresh();
    this.el.hidden = false;
  }

  close(): void {
    this.el.hidden = true;
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-v],[data-act]');
    if (!t) return;
    if (t.dataset.act === 'close') return this.close();
    if (t.dataset.act === 'calibrate') return this.onCalibrate();

    const key = t.closest<HTMLElement>('[data-setting]')?.dataset.setting;
    const v = t.dataset.v;
    if (!v) return;
    if (key === 'controls') {
      if (v === 'tilt' && !(await requestTiltPermission())) {
        this.ref('hint').textContent = 'Motion sensors are not available or permission was denied.';
        return;
      }
      this.settings.controls = v as ControlScheme;
      this.onChange('controls');
    } else if (key === 'quality') {
      this.settings.quality = v as Quality;
      this.onChange('quality');
    }
    this.refresh();
  }

  private refresh(): void {
    const s = this.settings;
    for (const group of this.el.querySelectorAll<HTMLElement>('[data-setting]')) {
      const current = group.dataset.setting === 'controls' ? s.controls : s.quality;
      for (const b of group.querySelectorAll<HTMLElement>('[data-v]')) b.classList.toggle('active', b.dataset.v === current);
    }
    this.ref('hint').textContent = HINTS[s.controls];
    this.ref('tilt-row').hidden = s.controls !== 'tilt';
    this.ref<HTMLInputElement>('flip').checked = s.flipTilt;
    this.ref<HTMLInputElement>('fps').checked = s.showFps;
    this.ref<HTMLInputElement>('sound').checked = s.sound;
    this.ref<HTMLInputElement>('music').checked = s.music;
    this.ref<HTMLInputElement>('vibration').checked = s.vibration;
  }

  private ref<T extends HTMLElement = HTMLElement>(name: string): T {
    return this.el.querySelector<T>(`[data-ref="${name}"]`)!;
  }
}
