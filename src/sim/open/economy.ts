import { CRACKER, JAVELIN, SURVIVOR } from '../../config';
import type { Survivor } from '../entities';
import type { WeaponType } from '../types';
import { OPEN, type RecipeDef } from './config';
import { emptyResources, RESOURCE_KINDS, type Cost, type NodeKind, type ResourceKind, type Resources } from './types';

/**
 * Resources in infinite mode: backpacks (OPEN.packMax units in all), the team stash, paying for things
 * (pack first, then the stash when a chest is in reach), gathering yields, loot and hunger.
 * Plain functions on plain data; the rules decide who, when and where.
 */

export function packTotal(r: Readonly<Resources>): number {
  return r.bamboo + r.wood + r.stone + r.scrap;
}

/** Units that still fit in a pack. */
export function packRoom(pack: Readonly<Resources>): number {
  return Math.max(0, OPEN.packMax - packTotal(pack));
}

export function copyResources(r: Readonly<Resources>): Resources {
  return { bamboo: r.bamboo, wood: r.wood, stone: r.stone, scrap: r.scrap };
}

export function isEmpty(r: Cost): boolean {
  for (const k of RESOURCE_KINDS) if (r[k]) return false;
  return true;
}

/** Puts up to `n` units of `kind` in the pack, as many as fit; returns how many went in. */
export function addToPack(pack: Resources, kind: ResourceKind, n: number): number {
  const take = Math.max(0, Math.min(Math.floor(n), packRoom(pack)));
  pack[kind] += take;
  return take;
}

/** Moves as much of `res` into the pack as fits (in RESOURCE_KINDS order); returns what didn't fit, or null. */
export function fillPack(pack: Resources, res: Cost): Cost | null {
  let left: Cost | null = null;
  for (const k of RESOURCE_KINDS) {
    const v = res[k] ?? 0;
    if (v <= 0) continue;
    const took = addToPack(pack, k, v);
    if (took < v) {
      if (!left) left = {};
      left[k] = v - took;
    }
  }
  return left;
}

/** No limit: the stash, bags. */
export function addResources(into: Resources, add: Cost): void {
  for (const k of RESOURCE_KINDS) {
    const v = add[k];
    if (v && v > 0) into[k] += Math.floor(v);
  }
}

/** Empties `from` into `into`; true if anything moved (a deposit at a storage chest). */
export function moveAll(from: Resources, into: Resources): boolean {
  let moved = false;
  for (const k of RESOURCE_KINDS) {
    if (from[k] <= 0) continue;
    into[k] += from[k];
    from[k] = 0;
    moved = true;
  }
  return moved;
}

/** Can the pack, plus the stash when one is in reach (`stash` non-null), cover `cost`? */
export function canPay(pack: Readonly<Resources>, stash: Readonly<Resources> | null, cost: Cost): boolean {
  for (const k of RESOURCE_KINDS) {
    const need = cost[k] ?? 0;
    if (need > pack[k] + (stash ? stash[k] : 0)) return false;
  }
  return true;
}

/** Pays `cost` from the pack first, the rest from the stash. False (and nothing taken) if it can't. */
export function pay(pack: Resources, stash: Resources | null, cost: Cost): boolean {
  if (!canPay(pack, stash, cost)) return false;
  for (const k of RESOURCE_KINDS) {
    let need = cost[k] ?? 0;
    if (need <= 0) continue;
    const fromPack = Math.min(need, pack[k]);
    pack[k] -= fromPack;
    need -= fromPack;
    if (need > 0 && stash) stash[k] -= need;
  }
  return true;
}

/** Units one hit takes from a node (before the node's and the pack's limits): more with the right tool. */
export function gatherPerHit(kind: NodeKind, weapon: WeaponType): number {
  const base = OPEN.gatherPerHit[kind];
  return OPEN.goodTool[kind] === weapon ? base * OPEN.gatherBonus : base;
}

/** Why `s` can't use a recipe right now (it would be wasted), or null. Price and station are checked elsewhere. */
export function recipeBlocked(def: RecipeDef, s: Survivor, hunger: number): string | null {
  const w = def.weapon;
  if (w && (s.main === w || s.extra === w) && (w !== 'javelin' || s.ammo >= JAVELIN.ammo)) return 'You already have one';
  if (def.crackers && s.crackers >= CRACKER.max) return "You can't carry more firecrackers";
  if (def.food && !w && !def.heal && hunger >= OPEN.hungerMax - 5) return "You're not hungry";
  if (def.heal && !w && !def.food && s.hp >= SURVIVOR.maxHp) return "You're not hurt";
  return null;
}

/** Hunger after `dt` seconds. */
export function drainHunger(hunger: number, dt: number): number {
  return Math.max(0, hunger - OPEN.hungerDrain * dt);
}

/** Eating: hunger after `food` points. */
export function feed(hunger: number, food: number): number {
  return Math.min(OPEN.hungerMax, hunger + food);
}

/** A fresh bag's contents from loose loot (rounded down, negatives dropped). */
export function bagResources(res: Cost): Resources {
  const out = emptyResources();
  addResources(out, res);
  return out;
}
