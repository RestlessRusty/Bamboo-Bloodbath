import type { InputManager } from '../input/InputManager';
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

/** The map of a match is whatever the renderer currently shows (see Renderer.setMap). */
export interface GameContext extends PresentContext {
  input: InputManager;
}
