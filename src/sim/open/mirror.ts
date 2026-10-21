import type { GameMap } from '../gameMap';
import type { GameEvent } from '../types';
import { chunkOf, tileCenter } from './config';
import { clusterBases, tileKey } from './structures';
import type { LootBag, OpenWorldData, Piece, WorldJoin } from './types';

/** Chunk keys touched since the renderer last looked. */
interface Dirty {
  pieces: Set<number>;
  nodes: Set<number>;
  crates: Set<number>;
  bags: boolean;
}

const newDirty = (): Dirty => ({ pieces: new Set(), nodes: new Set(), crates: new Set(), bags: false });

/**
 * Every client's copy of what players changed in the world (pieces, nodes, crates, bags), built from the
 * WorldJoin and kept up to date by the world events in the snapshot stream. The renderer and the HUD read
 * this, never the simulation, so the host, solo and guests all draw the same thing the same way.
 */
export class WorldMirror {
  readonly map: GameMap;
  /** Bumped on every change. */
  rev = 0;
  private readonly world: OpenWorldData;
  private readonly byId = new Map<number, Piece>();
  private readonly byTile = new Map<number, Piece>();
  /** Nodes that aren't full: units left. */
  private readonly left = new Map<number, number>();
  private readonly opened = new Set<number>();
  private readonly bagsById = new Map<number, LootBag>();
  /** Two sets of dirty marks, swapped by takeDirty so nothing is allocated per frame. */
  private dirty: Dirty = newDirty();
  private spare: Dirty = newDirty();
  /** Bumped when a bed or storage chest appears, goes, breaks or is repaired. */
  private baseRev = 0;
  private centerRev = -1;
  private center: { x: number; z: number } | null = null;

  constructor(map: GameMap, join: WorldJoin) {
    if (!map.open) throw new Error('WorldMirror needs the open world');
    this.map = map;
    this.world = map.open;
    for (const p of join.pieces) this.put({ ...p });
    for (const [id, n] of join.nodes) this.setNode(id, n);
    for (const id of join.crates) this.opened.add(id);
    for (const b of join.bags) this.bagsById.set(b.id, { ...b, res: { ...b.res } });
    this.dirty = newDirty();
  }

  get pieces(): ReadonlyMap<number, Piece> {
    return this.byId;
  }

  get bags(): ReadonlyMap<number, LootBag> {
    return this.bagsById;
  }

  /** The piece on a tile (an arrow function, so it can be passed to canPlace as it is). */
  readonly pieceAt = (gx: number, gz: number): Piece | undefined => this.byTile.get(tileKey(gx, gz));

  /** Units a node holds now (full = world.nodes[id].amount). */
  nodeLeft(id: number): number {
    const n = this.left.get(id);
    return n ?? this.world.nodes[id]?.amount ?? 0;
  }

  crateOpen(id: number): boolean {
    return this.opened.has(id);
  }

  apply(events: readonly GameEvent[]): void {
    for (const ev of events) {
      switch (ev.e) {
        case 'piece':
          this.put({ ...ev.p });
          this.rev++;
          break;
        case 'unpiece': {
          const p = this.byId.get(ev.id);
          if (p) {
            this.drop(p);
            this.rev++;
          }
          break;
        }
        case 'node':
          this.setNode(ev.id, ev.left);
          this.rev++;
          break;
        case 'crate': {
          this.opened.add(ev.id);
          const c = this.world.crates[ev.id];
          if (c) this.dirty.crates.add(this.chunkKey(c.x, c.z));
          this.rev++;
          break;
        }
        case 'bag':
          this.bagsById.set(ev.b.id, { ...ev.b, res: { ...ev.b.res } });
          this.dirty.bags = true;
          this.rev++;
          break;
        case 'unbag':
          if (this.bagsById.delete(ev.id)) {
            this.dirty.bags = true;
            this.rev++;
          }
          break;
        default:
          break;
      }
    }
  }

  /** Chunk keys (cz · chunks + cx) changed since the last call. Only the renderer calls this; use the result right away. */
  takeDirty(): { pieces: Set<number>; nodes: Set<number>; crates: Set<number>; bags: boolean } {
    const out = this.dirty;
    const next = this.spare;
    next.pieces.clear();
    next.nodes.clear();
    next.crates.clear();
    next.bags = false;
    this.dirty = next;
    this.spare = out;
    return out;
  }

  /** The middle of the biggest base (cluster of standing beds and chests), or null before there is one. */
  baseCenter(): { x: number; z: number } | null {
    if (this.centerRev !== this.baseRev) {
      this.centerRev = this.baseRev;
      const pts: { x: number; z: number; bed: boolean }[] = [];
      for (const p of this.byId.values()) {
        if (p.ruined || (p.kind !== 'bed' && p.kind !== 'storage')) continue;
        pts.push({ x: tileCenter(p.gx), z: tileCenter(p.gz), bed: p.kind === 'bed' });
      }
      const best = clusterBases(pts)[0];
      this.center = best ? { x: best.x, z: best.z } : null;
    }
    return this.center;
  }

  // ---------------------------------------------------------------- internals

  private chunkKey(x: number, z: number): number {
    return chunkOf(z) * this.world.chunks + chunkOf(x);
  }

  private put(p: Piece): void {
    const old = this.byId.get(p.id);
    const key = tileKey(p.gx, p.gz);
    // A different piece on that tile can only be left over from a missed event: the new one wins.
    const other = this.byTile.get(key);
    if (other && other.id !== p.id) this.drop(other);
    if (old && (old.gx !== p.gx || old.gz !== p.gz)) this.drop(old);
    if (isBasePiece(p) || (old && isBasePiece(old))) {
      if (!old || old.ruined !== p.ruined || old.kind !== p.kind) this.baseRev++;
    }
    this.byId.set(p.id, p);
    this.byTile.set(key, p);
    this.dirty.pieces.add(this.chunkKey(tileCenter(p.gx), tileCenter(p.gz)));
  }

  private drop(p: Piece): void {
    this.byId.delete(p.id);
    const key = tileKey(p.gx, p.gz);
    if (this.byTile.get(key) === p) this.byTile.delete(key);
    if (isBasePiece(p)) this.baseRev++;
    this.dirty.pieces.add(this.chunkKey(tileCenter(p.gx), tileCenter(p.gz)));
  }

  private setNode(id: number, n: number): void {
    const node = this.world.nodes[id];
    if (!node) return;
    if (n >= node.amount) this.left.delete(id);
    else this.left.set(id, Math.max(0, n));
    this.dirty.nodes.add(this.chunkKey(node.x, node.z));
  }
}

function isBasePiece(p: Piece): boolean {
  return p.kind === 'bed' || p.kind === 'storage';
}
