import type { InputManager } from '../input/InputManager';
import type { GameMap } from '../sim/gameMap';
import type { PresentContext } from './Presenter';

/** A running match, whether simulated here (solo / host) or received from a host (guest). */
export interface Session {
  frame(dt: number, fps: number | null): void;
  dispose(): void;
  readonly isOver: boolean;
  /** Multiplayer can't be paused: the game keeps running for everyone. */
  readonly canPause: boolean;
  paused: boolean;
}

export interface GameContext extends PresentContext {
  map: GameMap;
  input: InputManager;
}
