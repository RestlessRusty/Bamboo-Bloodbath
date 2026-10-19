import type { WeaponType } from './types';

export interface MeleeDef {
  damage: number;
  /** Reach in front of the panda. */
  range: number;
  /** Hit cone width in radians. */
  arc: number;
  knockback: number;
  /** Seconds the zombie is stunned. */
  stun: number;
}

export interface WeaponDef extends MeleeDef {
  label: string;
  /** Seconds into the attack when the hit lands (or the javelin leaves the paw). */
  hitAt: number;
  duration: number;
  cooldown: number;
}

export const WEAPONS: Record<WeaponType, WeaponDef> = {
  knife: { label: 'Knife', damage: 20, range: 1.5, arc: 1.9, knockback: 3, stun: 0.2, hitAt: 0.11, duration: 0.3, cooldown: 0.34 },
  axe: { label: 'Axe', damage: 45, range: 1.9, arc: 2.4, knockback: 9, stun: 0.6, hitAt: 0.3, duration: 0.6, cooldown: 0.75 },
  // Melee stats unused while carrying javelins (they get thrown); see PAW for the empty-handed slap.
  javelin: { label: 'Javelin', damage: 35, range: 1.3, arc: 1.6, knockback: 6, stun: 0.4, hitAt: 0.2, duration: 0.45, cooldown: 0.55 },
};

/** Bare-paw slap when a javelin panda has thrown everything. */
export const PAW: MeleeDef = { damage: 8, range: 1.3, arc: 1.6, knockback: 2, stun: 0.15 };
