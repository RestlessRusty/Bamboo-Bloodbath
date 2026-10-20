import type { RigidBody } from '@dimforge/rapier3d-compat';
import type { Brain } from './bots';
import type { PlayerSpec, SurvivorState, WeaponType, ZombieState } from './types';

/** Internal (host-side) state of the simulation's entities. */

export interface Survivor {
  spec: PlayerSpec;
  body: RigidBody | null;
  x: number;
  y: number;
  z: number;
  rot: number;
  faceX: number;
  faceZ: number;
  speed: number;
  inWater: boolean;
  hidden: boolean;
  hp: number;
  state: SurvivorState;
  weapon: WeaponType;
  ammo: number;
  kills: number;
  /** Seconds since the current attack started, -1 when idle. */
  attackTime: number;
  attackHit: boolean;
  attackCd: number;
  throwing: boolean;
  dashTime: number;
  dashCd: number;
  dashX: number;
  dashZ: number;
  bleed: number;
  revive: number;
  hurt: number;
  /** Rack we just swapped at; it won't swap again until we walk away. */
  lastRack: number;
  crackers: number;
  crackerCd: number;
  brain: Brain | null;
  /** Story character (Doc): not counted as a teammate for the horde size or the goal. */
  npc: boolean;
  /** Zombies leave this survivor alone (Doc waiting somewhere while nobody is around). */
  shielded: boolean;
}

export interface Zombie {
  id: number;
  body: RigidBody | null;
  x: number;
  y: number;
  z: number;
  rot: number;
  faceX: number;
  faceZ: number;
  speed: number;
  hp: number;
  state: ZombieState;
  stateTime: number;
  stun: number;
  hurt: number;
  look: number;
  from: string | null;
  /** Placed on the map at match start; not recycled until the group has gone past it. */
  sleeper: boolean;
  /** Sent after the group (story siege waves): knows where everyone is, however far. */
  hunt: boolean;
  speedMul: number;
  target: Survivor | null;
  /** A crackling firecracker it's heading for instead of a survivor. */
  lure: { x: number; z: number } | null;
  /** Bridge or ford end to walk to first when water is in the way of the target (or lure). */
  via: { x: number; z: number } | null;
  retarget: number;
  biteCd: number;
  biteDone: boolean;
  lungeCd: number;
  lungeX: number;
  lungeZ: number;
  wanderT: number;
  wanderX: number;
  wanderZ: number;
  groanCd: number;
}

export interface Javelin {
  id: number;
  owner: Survivor | null;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  flying: boolean;
  age: number;
}

export interface Cracker {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  flying: boolean;
  age: number;
  /** Seconds of crackling left once landed. */
  fuse: number;
  popCd: number;
}

export interface CrackerDrop {
  id: number;
  x: number;
  y: number;
  z: number;
  age: number;
}

export interface BambooSpot {
  x: number;
  y: number;
  z: number;
  active: boolean;
  respawn: number;
}

export interface RackSlot {
  x: number;
  y: number;
  z: number;
  weapon: WeaponType;
}
