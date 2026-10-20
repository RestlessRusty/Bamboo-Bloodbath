import { clamp } from '../core/math';
import type { ControlScheme } from '../settings';
import { NO_INPUT, type PlayerInput } from '../sim/types';
import { el } from '../ui/dom';

export interface InputHooks {
  screenToGround(x: number, y: number): { x: number; z: number } | null;
  playerPos(): { x: number; z: number } | null;
  onPause(): void;
}

const JOY_RADIUS = 56;
const JOY_DEADZONE = 0.12;
const SWIPE_MIN_PX = 35;
const STEER_DELAY_MS = 260;
const TAP_MAX_PX = 20;
const DOUBLE_TAP_MS = 320;
const TILT_DEADZONE_DEG = 2.5;
const TILT_FULL_DEG = 16;
/** Holding the keyboard sneak key walks at this fraction of full speed (quiet enough for sleepers). */
const SNEAK_KEY_SPEED = 0.45;

const ATTACK_ICON =
  '<svg viewBox="0 0 24 24"><path d="M14.5 3.5l6 6-9.5 9.5-6-6z"/><path d="M5 13l6 6M3 21l3.5-3.5"/></svg>';
const DASH_ICON = '<svg viewBox="0 0 24 24"><path d="M3 8h9M2 12h10M3 16h9M14 6l6 6-6 6"/></svg>';
const CRACKER_ICON =
  '<svg viewBox="0 0 24 24"><rect x="5" y="10" width="5" height="11" rx="1"/><rect x="11" y="8" width="5" height="13" rx="1"/>' +
  '<path d="M13.5 8c0-2 1-3.5 3-4M18 2.5l1 1.5M20.5 5l-1.5.5M19 1l-.3 1.2"/></svg>';

interface TapPointer {
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  t: number;
  steering: boolean;
}

/** Ask for motion-sensor access (iOS needs a user gesture; Android just allows it). */
export async function requestTiltPermission(): Promise<boolean> {
  const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } })
    .DeviceOrientationEvent;
  if (!DOE) return false;
  if (typeof DOE.requestPermission !== 'function') return true;
  try {
    return (await DOE.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Merges every input source into one PlayerInput per simulation tick:
 * the selected touch scheme (joystick / tilt / tap & swipe), plus keyboard and gamepad.
 */
export class InputManager {
  private scheme: ControlScheme = 'joystick';
  private enabled = false;
  private flipTilt = false;

  private readonly layer: HTMLDivElement;
  private readonly joyBase: HTMLDivElement;
  private readonly joyKnob: HTMLDivElement;
  private readonly crackerBtn: HTMLButtonElement;
  private readonly crackerCount: HTMLSpanElement;
  private crackersShown = -1;

  private joyId: number | null = null;
  private joyOX = 0;
  private joyOY = 0;
  private joyX = 0;
  private joyY = 0;

  private attackHeld = false;
  private attackPulse = false;
  private dashPulse = false;
  private crackerPulse = false;
  private aimX = 0;
  private aimZ = 0;

  private readonly keys = new Set<string>();
  private padDashHeld = false;
  private padCrackerHeld = false;
  private padPauseHeld = false;

  private beta: number | null = null;
  private gamma: number | null = null;
  private baseBeta = 0;
  private baseGamma = 0;
  private needsCalibration = true;

  private tap: TapPointer | null = null;
  private tapTarget: { x: number; z: number } | null = null;
  private lastTap = { t: 0, x: 0, y: 0 };

  constructor(
    parent: HTMLElement,
    private readonly hooks: InputHooks,
  ) {
    this.layer = el('div', 'touch-layer');
    this.layer.hidden = true;
    this.joyBase = el('div', 'joy-base idle');
    this.joyKnob = el('div', 'joy-knob');
    this.joyBase.appendChild(this.joyKnob);
    const attack = el('button', 'act-btn attack', ATTACK_ICON);
    const dash = el('button', 'act-btn dash', DASH_ICON);
    this.crackerBtn = el('button', 'act-btn cracker', CRACKER_ICON);
    this.crackerCount = el('span', 'act-count');
    this.crackerBtn.appendChild(this.crackerCount);
    attack.setAttribute('aria-label', 'Attack');
    dash.setAttribute('aria-label', 'Dash');
    this.crackerBtn.setAttribute('aria-label', 'Throw firecracker');
    this.layer.append(this.joyBase, attack, dash, this.crackerBtn);
    parent.appendChild(this.layer);

    this.layer.addEventListener('pointerdown', this.onDown);
    this.layer.addEventListener('pointermove', this.onMove);
    this.layer.addEventListener('pointerup', this.onUp);
    this.layer.addEventListener('pointercancel', this.onUp);
    this.layer.addEventListener('contextmenu', (e) => e.preventDefault());

    this.bindButton(attack, (down) => {
      this.attackHeld = down;
      if (down) this.attackPulse = true;
    });
    this.bindButton(dash, (down) => {
      if (down) this.dashPulse = true;
    });
    this.bindButton(this.crackerBtn, (down) => {
      if (down) this.crackerPulse = true;
    });

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('deviceorientation', this.onOrientation);
  }

  setScheme(scheme: ControlScheme): void {
    this.scheme = scheme;
    this.layer.dataset.scheme = scheme;
    this.resetState();
    if (scheme === 'tilt') this.needsCalibration = true;
  }

  setFlipTilt(flip: boolean): void {
    this.flipTilt = flip;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.layer.hidden = !on;
    this.resetState();
    // Treat however the phone is held when play (re)starts as "neutral".
    if (on && this.scheme === 'tilt') this.needsCalibration = true;
  }

  /** Firecrackers carried, shown on the button. */
  setCrackerCount(n: number): void {
    if (n === this.crackersShown) return;
    this.crackersShown = n;
    this.crackerCount.textContent = String(n);
    this.crackerBtn.classList.toggle('empty', n <= 0);
  }

  calibrateTilt(): void {
    if (this.beta === null || this.gamma === null) {
      this.needsCalibration = true;
      return;
    }
    this.baseBeta = this.beta;
    this.baseGamma = this.gamma;
    this.needsCalibration = false;
  }

  /** Call once per simulation tick; one-shot actions (taps, swipes) are consumed here. */
  sample(): PlayerInput {
    if (!this.enabled) return { ...NO_INPUT };

    let mx = 0;
    let mz = 0;
    let attack = this.attackHeld || this.attackPulse;
    let dash = this.dashPulse;
    let cracker = this.crackerPulse;
    const ax = this.aimX;
    const az = this.aimZ;
    this.attackPulse = false;
    this.dashPulse = false;
    this.crackerPulse = false;
    this.aimX = 0;
    this.aimZ = 0;

    const k = this.keys;
    let kx = 0;
    let kz = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) kx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) kx += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) kz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) kz += 1;
    const kl = Math.hypot(kx, kz);
    if (kl > 0) {
      const sneak = k.has('KeyC') || k.has('KeyQ') ? SNEAK_KEY_SPEED : 1;
      mx += (kx / kl) * sneak;
      mz += (kz / kl) * sneak;
    }
    if (k.has('Space') || k.has('KeyJ')) attack = true;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const gx = gp.axes[0] ?? 0;
      const gy = gp.axes[1] ?? 0;
      if (Math.hypot(gx, gy) > 0.18) {
        mx += gx;
        mz += gy;
      }
      const pressed = (i: number) => gp.buttons[i]?.pressed ?? false;
      if (pressed(0) || pressed(2) || pressed(7)) attack = true;
      const dashBtn = pressed(1) || pressed(6);
      if (dashBtn && !this.padDashHeld) dash = true;
      this.padDashHeld = dashBtn;
      const crackerBtn = pressed(3) || pressed(5);
      if (crackerBtn && !this.padCrackerHeld) cracker = true;
      this.padCrackerHeld = crackerBtn;
      const pauseBtn = pressed(9);
      if (pauseBtn && !this.padPauseHeld) this.hooks.onPause();
      this.padPauseHeld = pauseBtn;
    }

    switch (this.scheme) {
      case 'joystick':
        mx += this.joyX;
        mz += this.joyY;
        break;
      case 'tilt': {
        const t = this.tiltVector();
        mx += t.x;
        mz += t.z;
        break;
      }
      case 'tap': {
        const tp = this.tap;
        if (tp && !tp.steering && performance.now() - tp.t > STEER_DELAY_MS) tp.steering = true;
        if (tp?.steering) this.tapTarget = this.hooks.screenToGround(tp.x, tp.y) ?? this.tapTarget;
        const p = this.hooks.playerPos();
        if (this.tapTarget && p) {
          const dx = this.tapTarget.x - p.x;
          const dz = this.tapTarget.z - p.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.4) this.tapTarget = null;
          else {
            const s = Math.min(1, d / 1.0);
            mx += (dx / d) * s;
            mz += (dz / d) * s;
          }
        }
        break;
      }
    }

    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    return { mx, mz, ax, az, attack, dash, cracker };
  }

  private resetState(): void {
    this.joyId = null;
    this.joyX = 0;
    this.joyY = 0;
    this.joyBase.classList.add('idle');
    this.joyBase.style.left = '';
    this.joyBase.style.top = '';
    this.joyKnob.style.transform = '';
    this.attackHeld = false;
    this.attackPulse = false;
    this.dashPulse = false;
    this.crackerPulse = false;
    this.aimX = 0;
    this.aimZ = 0;
    this.tap = null;
    this.tapTarget = null;
  }

  private bindButton(btn: HTMLElement, set: (down: boolean) => void): void {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.setPointerCapture(e.pointerId);
      btn.classList.add('down');
      set(true);
    });
    const up = (e: PointerEvent) => {
      e.stopPropagation();
      btn.classList.remove('down');
      set(false);
    };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    if (this.scheme === 'joystick') {
      if (this.joyId !== null || e.clientX > window.innerWidth * 0.55) return;
      this.joyId = e.pointerId;
      this.joyOX = e.clientX;
      this.joyOY = e.clientY;
      this.joyBase.classList.remove('idle');
      this.joyBase.style.left = `${e.clientX}px`;
      this.joyBase.style.top = `${e.clientY}px`;
      this.joyKnob.style.transform = '';
      this.layer.setPointerCapture(e.pointerId);
    } else if (this.scheme === 'tap') {
      if (this.tap) return;
      const now = performance.now();
      this.tap = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: now, steering: false };
      this.layer.setPointerCapture(e.pointerId);
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId === this.joyId) {
      const dx = e.clientX - this.joyOX;
      const dy = e.clientY - this.joyOY;
      const len = Math.hypot(dx, dy);
      const k = len > JOY_RADIUS ? JOY_RADIUS / len : 1;
      this.joyKnob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      const n = Math.min(1, len / JOY_RADIUS);
      const mag = n < JOY_DEADZONE ? 0 : (n - JOY_DEADZONE) / (1 - JOY_DEADZONE);
      // Screen right = +X, screen down = +Z (the camera never rotates).
      this.joyX = len > 0 ? (dx / len) * mag : 0;
      this.joyY = len > 0 ? (dy / len) * mag : 0;
    } else if (this.tap && e.pointerId === this.tap.id) {
      this.tap.x = e.clientX;
      this.tap.y = e.clientY;
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId === this.joyId) {
      this.joyId = null;
      this.joyX = 0;
      this.joyY = 0;
      this.joyBase.classList.add('idle');
      this.joyBase.style.left = '';
      this.joyBase.style.top = '';
      this.joyKnob.style.transform = '';
      return;
    }
    const tp = this.tap;
    if (!tp || e.pointerId !== tp.id) return;
    this.tap = null;
    if (tp.steering) return; // keep walking to the last steered point

    const now = performance.now();
    const dx = e.clientX - tp.x0;
    const dy = e.clientY - tp.y0;
    const dist = Math.hypot(dx, dy);
    if (dist > SWIPE_MIN_PX) {
      this.aimX = dx / dist;
      this.aimZ = dy / dist;
      this.attackPulse = true;
    } else if (dist < TAP_MAX_PX) {
      const isDouble =
        now - this.lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 60;
      if (isDouble) {
        this.dashPulse = true;
        this.lastTap.t = 0;
      } else {
        this.lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
      const g = this.hooks.screenToGround(e.clientX, e.clientY);
      if (g) this.tapTarget = g;
    }
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (!e.repeat) this.hooks.onPause();
      return;
    }
    this.keys.add(e.code);
    if (!e.repeat && (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyK')) this.dashPulse = true;
    if (!e.repeat && (e.code === 'Space' || e.code === 'KeyJ')) this.attackPulse = true;
    if (!e.repeat && (e.code === 'KeyE' || e.code === 'KeyL')) this.crackerPulse = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  };

  private readonly onOrientation = (e: DeviceOrientationEvent): void => {
    if (e.beta === null || e.gamma === null) return;
    this.beta = e.beta;
    this.gamma = e.gamma;
    if (this.needsCalibration) this.calibrateTilt();
  };

  private tiltVector(): { x: number; z: number } {
    if (this.beta === null || this.gamma === null) return { x: 0, z: 0 };
    const db = this.beta - this.baseBeta;
    const dg = this.gamma - this.baseGamma;
    const raw = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
    const angle = ((raw % 360) + 360) % 360;

    // Map device tilt to screen directions. Landscape: the phone's long axis is screen X.
    let x: number;
    let z: number;
    if (angle === 90) {
      x = db;
      z = -dg;
    } else if (angle === 270) {
      x = -db;
      z = dg;
    } else {
      x = dg;
      z = db;
    }
    if (this.flipTilt) {
      x = -x;
      z = -z;
    }
    const axis = (v: number) => Math.sign(v) * clamp((Math.abs(v) - TILT_DEADZONE_DEG) / (TILT_FULL_DEG - TILT_DEADZONE_DEG), 0, 1);
    return { x: axis(x), z: axis(z) };
  }
}
