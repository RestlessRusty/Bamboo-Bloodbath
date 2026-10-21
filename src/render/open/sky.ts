import * as THREE from 'three';
import { damp, smoothstep } from '../../core/math';
import type { MapTheme } from '../../sim/mapLayout';
import { OPEN } from '../../sim/open/config';
import { BIOME_IDS, type BiomeId, type OpenWorldData } from '../../sim/open/types';

/** Moonlit blue: what every biome's light turns into at night (campfires do the rest). */
const NIGHT = {
  sky: 0x1b2442,
  hemiSky: 0x52659a,
  hemiGround: 0x1c2130,
  hemiIntensity: 0.8,
  sun: 0x9fb2ff,
  sunIntensity: 0.4,
  /** Fog comes in a little closer at night. */
  fogScale: 0.85,
};
/** Sunrise and sunset glow. */
const GLOW_SKY = 0xf3a271;
const GLOW_SUN = 0xffa45c;
/** How fast the light follows the biome under the camera (per second). */
const BLEND_RATE = 1.2;

/** 0 by day, 1 at night, easing in through dusk and out at dawn (`time`: 0..1 of a day, 0 = dawn). */
export function nightAmount(time: number): number {
  const mid = (OPEN.nightStart + OPEN.nightEnd) / 2;
  return time < mid
    ? smoothstep(OPEN.nightStart - 0.05, OPEN.nightStart + 0.01, time)
    : 1 - smoothstep(OPEN.nightEnd - 0.01, OPEN.nightEnd + 0.03, time);
}

/** Warm glow around sunset and sunrise, 0..1. */
function glowAmount(time: number): number {
  return Math.max(bell(time, OPEN.nightStart - 0.02, 0.05), bell(time, OPEN.nightEnd + 0.015, 0.035));
}

/** 1 at `c`, 0 from `w` away, going round the clock. */
function bell(time: number, c: number, w: number): number {
  let d = Math.abs(time - c);
  d = Math.min(d, 1 - d);
  return 1 - smoothstep(0, w, d);
}

interface ThemeLight {
  sky: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  sun: THREE.Color;
  hemiIntensity: number;
  sunIntensity: number;
  fogNear: number;
  fogFar: number;
}

const lightOf = (t: MapTheme): ThemeLight => ({
  sky: new THREE.Color(t.sky),
  hemiSky: new THREE.Color(t.hemiSky),
  hemiGround: new THREE.Color(t.hemiGround),
  sun: new THREE.Color(t.sun),
  hemiIntensity: t.hemiIntensity,
  sunIntensity: t.sunIntensity,
  fogNear: t.fogNear,
  fogFar: t.fogFar,
});

/**
 * Open-world lighting: the sky, fog, hemisphere and sun of the biomes under the camera (blended by
 * their weights and eased so walking over a border is a slow shift), turned towards a night palette
 * by the clock. The renderer copies the result into the scene every frame.
 */
export class OpenSky {
  readonly sky = new THREE.Color();
  readonly hemiSky = new THREE.Color();
  readonly hemiGround = new THREE.Color();
  readonly sun = new THREE.Color();
  hemiIntensity = 1;
  sunIntensity = 1;
  fogNear = 50;
  fogFar = 130;
  /** How much of the view is snowy highlands (smoothed): snowfall fades in with it. */
  snow = 0;
  /** 0 by day, 1 at night. */
  night = 0;

  private readonly themes: ThemeLight[];
  private readonly nightSky = new THREE.Color(NIGHT.sky);
  private readonly nightHemiSky = new THREE.Color(NIGHT.hemiSky);
  private readonly nightHemiGround = new THREE.Color(NIGHT.hemiGround);
  private readonly nightSun = new THREE.Color(NIGHT.sun);
  private readonly glowSky = new THREE.Color(GLOW_SKY);
  private readonly glowSun = new THREE.Color(GLOW_SUN);
  private readonly target: Record<BiomeId, number> = { meadow: 1, bamboo: 0, pine: 0, snow: 0, fen: 0, quarry: 0, farm: 0 };
  private readonly weights = new Float32Array(BIOME_IDS.length);
  private readonly snowIndex = BIOME_IDS.indexOf('snow');
  private primed = false;

  constructor(private readonly world: OpenWorldData) {
    this.themes = BIOME_IDS.map((id) => lightOf(world.biomes[id].theme));
  }

  /** Jump straight to the light at the next update (new world, or a long way away). */
  reset(): void {
    this.primed = false;
  }

  /** `time`: time of day 0..1 (Snapshot.open.time). */
  update(dt: number, fx: number, fz: number, time: number): void {
    this.world.biomeWeights(fx, fz, this.target);
    const k = this.primed ? damp(BLEND_RATE, dt) : 1;
    this.primed = true;
    const w = this.weights;
    let sum = 0;
    for (let b = 0; b < w.length; b++) {
      w[b] += (this.target[BIOME_IDS[b]] - w[b]) * k;
      sum += w[b];
    }
    const inv = sum > 1e-4 ? 1 / sum : 1;
    this.snow = w[this.snowIndex] * inv;

    this.sky.setRGB(0, 0, 0);
    this.hemiSky.setRGB(0, 0, 0);
    this.hemiGround.setRGB(0, 0, 0);
    this.sun.setRGB(0, 0, 0);
    let hemiI = 0;
    let sunI = 0;
    let near = 0;
    let far = 0;
    for (let b = 0; b < this.themes.length; b++) {
      const wb = w[b] * inv;
      if (wb <= 0) continue;
      const t = this.themes[b];
      addScaled(this.sky, t.sky, wb);
      addScaled(this.hemiSky, t.hemiSky, wb);
      addScaled(this.hemiGround, t.hemiGround, wb);
      addScaled(this.sun, t.sun, wb);
      hemiI += t.hemiIntensity * wb;
      sunI += t.sunIntensity * wb;
      near += t.fogNear * wb;
      far += t.fogFar * wb;
    }

    const glow = glowAmount(time);
    this.sky.lerp(this.glowSky, glow * 0.45);
    this.sun.lerp(this.glowSun, glow * 0.6);
    const n = nightAmount(time);
    this.night = n;
    this.sky.lerp(this.nightSky, n);
    this.hemiSky.lerp(this.nightHemiSky, n);
    this.hemiGround.lerp(this.nightHemiGround, n);
    this.sun.lerp(this.nightSun, n);
    this.hemiIntensity = hemiI + (NIGHT.hemiIntensity - hemiI) * n;
    const daySun = sunI * (1 - glow * 0.25);
    this.sunIntensity = daySun + (NIGHT.sunIntensity - daySun) * n;
    const fog = 1 + (NIGHT.fogScale - 1) * n;
    this.fogNear = near * fog;
    this.fogFar = far * fog;
  }
}

function addScaled(out: THREE.Color, c: THREE.Color, k: number): void {
  out.r += c.r * k;
  out.g += c.g * k;
  out.b += c.b * k;
}
