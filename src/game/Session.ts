import type { InputManager } from '../input/InputManager';
import type { OpenCommand } from '../sim/open/types';
import type { OpenHud } from '../ui/OpenHud';
import type { PresentContext } from './Presenter';

/** A running match, whether simulated here (solo / host) or received from a host (guest). */
export interface Session {
  frame(dt: number, fps: number | null): void;
  dispose(): void;
  readonly isOver: boolean;
  /** Multiplayer can't be paused: the game keeps running for everyone. */
  readonly canPause: boolean;
  paused: boolean;
  /** "End match" once every human is done and only bots are still out (the host decides in multiplayer). */
  requestEnd(): void;
  /** Infinite mode: the local player builds or crafts (quick play and story ignore it). */
  command(cmd: OpenCommand): void;
}

/** The map of a match is whatever the renderer currently shows (see Renderer.setMap). */
export interface GameContext extends PresentContext {
  input: InputManager;
  /** Infinite mode's HUD (day, hunger, pack, building); sessions start it only in an open world. */
  openHud?: OpenHud;
}
