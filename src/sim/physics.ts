import RAPIER from '@dimforge/rapier3d-compat';

let ready: Promise<void> | null = null;

/** Loads Rapier's WASM once. Await before constructing a Simulation. */
export function initPhysics(): Promise<void> {
  return (ready ??= RAPIER.init());
}

export { RAPIER };
