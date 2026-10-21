import type { MapLayout } from '../mapLayout';
import type { StoryDeviceKind, StoryItemKind } from '../types';

export interface Pt {
  x: number;
  z: number;
}

/**
 * Who says a line. 'you' is the player's nickname, 'buddy' the first bot (skipped without bots),
 * 'bristle' Professor Bristle over a loudspeaker or radio (he never shows up in person).
 */
export type Speaker = 'you' | 'doc' | 'radio' | 'buddy' | 'bristle';

export interface Line {
  who: Speaker;
  /** `{you}` is replaced with the player's nickname. */
  text: string;
}

/** Doc either stays at a spot (and is left alone by zombies while nobody is near) or tags along. */
export type DocMode = 'wait' | 'follow';

interface StageBase {
  /** Objective shown in the HUD the whole time, so skipping the story never leaves you lost. */
  label: string;
  /** Starting this stage saves a checkpoint: a retry puts the group here at the start of this stage. */
  checkpoint?: Pt;
  /** Doc's behaviour from this stage on (default: as before; 'wait' at the start). */
  doc?: DocMode;
  /** Where Doc waits from this stage on (default: as before, or the chapter's Doc spawn). */
  docPost?: Pt;
  /** Lines when the stage starts / when it's done. */
  say?: readonly Line[];
  done?: readonly Line[];
  /** Gates (indices into the chapter's devices) that swing open when this stage is done. */
  opens?: readonly number[];
}

/** Get there. If Doc is following, Doc has to get there too. */
export interface ReachStage extends StageBase {
  kind: 'reach';
  at: Pt;
  r: number;
}

/** Pick up one item at each spot (anyone in the group can). */
export interface CollectStage extends StageBase {
  kind: 'collect';
  item: StoryItemKind;
  spots: readonly Pt[];
}

/** Stay inside the zone for `time` seconds (the clock pauses while nobody is in) while zombies keep coming. */
export interface HoldStage extends StageBase {
  kind: 'hold';
  at: Pt;
  r: number;
  time: number;
  /** A wave of `waveSize` zombies (+1 per two extra pandas) every `waveEvery` seconds. */
  waveEvery: number;
  waveSize: number;
  /** Lines at a fraction of the way through. */
  cues?: readonly { at: number; line: Line }[];
}

/**
 * Switch some of the chapter's machinery (levers, pumps, valves), in any order: a panda (bots too)
 * has to stay at each one for `time` seconds. Progress slowly winds back while nobody's there.
 */
export interface ActivateStage extends StageBase {
  kind: 'activate';
  /** Indices into the chapter's devices. */
  devices: readonly number[];
  /** What the HUD counts, e.g. "Pumps". */
  noun: string;
  time: number;
  /** Stand this close to a device to work it. Default 2.6. */
  r?: number;
  /** Hunters sent after the group each time a device is done (+1 per two extra pandas). */
  waveSize?: number;
  /** Line after the 1st, 2nd… device is done. */
  after?: readonly Line[];
}

/**
 * Push the chapter's cart along `path` (its first point is where the cart stands at the start of the stage).
 * It rolls while a panda (bots too) is beside it and no zombie is on it.
 */
export interface EscortStage extends StageBase {
  kind: 'escort';
  path: readonly Pt[];
  /** Waves of hunters while the cart is on its way. */
  waveEvery?: number;
  waveSize?: number;
  /** Lines at a fraction of the way. */
  cues?: readonly { at: number; line: Line }[];
}

export type Stage = ReachStage | CollectStage | HoldStage | ActivateStage | EscortStage;

/** A piece of story machinery, on the map for the whole chapter. */
export interface Device extends Pt {
  kind: StoryDeviceKind;
  /** Front of the machine faces this point; a gate's boom swings across towards it. */
  face: Pt;
}

export interface HordeRules {
  base: number;
  perSurvivor: number;
  progressBonus: number;
  max: number;
}

/** A page of the story between chapters. */
export interface Card {
  title?: string;
  /** `{you}` is replaced with the player's nickname. */
  text: string;
  /** Picture for this page (default: the chapter's). */
  art?: StoryArt;
}

export type StoryArt =
  | 'radio'
  | 'clinic'
  | 'mountain'
  | 'fen'
  | 'lab'
  | 'end'
  | 'sniff'
  | 'farm'
  | 'bristle'
  | 'cart'
  | 'pumps'
  | 'glasshouse'
  | 'factory'
  | 'balloon';

export interface Chapter {
  title: string;
  /** One line for the chapter list. */
  blurb: string;
  map: MapLayout;
  art: StoryArt;
  /** Seconds, or null for no clock. */
  timeLimit: number | null;
  horde: HordeRules;
  /** Share of the starting horde that's asleep. */
  sleepShare: number;
  /** Doc is on the map from the start, here (unless following the group). */
  doc?: { spawn: Pt };
  /** Machinery for "activate" stages (and gates they open). */
  devices?: readonly Device[];
  stages: readonly Stage[];
  /** End-screen line when the chapter is won (default "<title>: done!"). */
  wonText?: string;
  /** End-screen line when the clock runs out. */
  timeoutText?: string;
  intro: readonly Card[];
  outro: readonly Card[];
}
