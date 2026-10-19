import type { DataConnection, Peer } from 'peerjs';
import { MAX_PLAYERS } from '../config';
import type { PlayerInput, PlayerSpec, Snapshot } from '../sim/types';
import { encodeSnapshot } from './codec';
import { openPeer, peerErrorType } from './peer';
import {
  decodeInput,
  makeRoomCode,
  PEER_PREFIX,
  PROTOCOL_VERSION,
  sanitizeName,
  sanitizeVariant,
  sanitizeWeapon,
  type ClientMsg,
  type HostMsg,
  type LobbyPlayer,
} from './protocol';

interface Remote {
  conn: DataConnection;
  id: string | null;
}

/**
 * The room creator's side: owns the room code, the lobby, collects the guests' inputs
 * and broadcasts snapshots of the simulation it runs.
 */
export class NetHost {
  readonly players: LobbyPlayer[];
  bots = 0;
  inGame = false;
  /** Lobby changed (someone joined/left, bot count). */
  onChange: (() => void) | null = null;
  /** A guest disconnected during a match. */
  onPlayerLeft: ((id: string) => void) | null = null;

  private readonly remotes: Remote[] = [];
  private readonly inputs = new Map<string, PlayerInput>();

  private constructor(
    private readonly peer: Peer,
    readonly code: string,
    me: Omit<LobbyPlayer, 'id'>,
  ) {
    this.players = [{ ...me, id: 'p1' }];
    peer.on('connection', (conn) => this.accept(conn));
    // Losing the signalling server doesn't break existing connections; reconnect so new guests can join.
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
    });
    peer.on('error', (err) => console.warn('[host] peer error', peerErrorType(err), err));
  }

  static async create(me: Omit<LobbyPlayer, 'id'>): Promise<NetHost> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeRoomCode();
      try {
        const peer = await openPeer(PEER_PREFIX + code);
        return new NetHost(peer, code, me);
      } catch (err) {
        if (peerErrorType(err) !== 'unavailable-id') throw err;
        // Code already taken by another room: try another one.
      }
    }
    throw new Error('Could not create a room. Please try again.');
  }

  get humanCount(): number {
    return this.players.length;
  }

  setBots(n: number): void {
    this.bots = Math.max(0, Math.min(n, MAX_PLAYERS - this.players.length));
    this.broadcastLobby();
    this.onChange?.();
  }

  start(specs: PlayerSpec[]): void {
    this.inGame = true;
    this.inputs.clear();
    this.broadcast({ t: 'start', specs });
  }

  /** Latest input from a guest. A dash press is handed out only once. */
  inputFor(id: string): PlayerInput | undefined {
    const i = this.inputs.get(id);
    if (i?.dash) this.inputs.set(id, { ...i, dash: false });
    return i;
  }

  sendSnapshot(snap: Snapshot): void {
    this.broadcast({ t: 'snap', s: encodeSnapshot(snap) });
  }

  /** After a match: everyone still connected goes back to the lobby. */
  backToLobby(): void {
    this.inGame = false;
    this.inputs.clear();
    const connected = new Set(this.remotes.map((r) => r.id));
    for (let i = this.players.length - 1; i >= 1; i--) {
      if (!connected.has(this.players[i].id)) this.players.splice(i, 1);
    }
    this.bots = Math.min(this.bots, MAX_PLAYERS - this.players.length);
    this.broadcastLobby();
    this.onChange?.();
  }

  close(): void {
    this.broadcast({ t: 'bye', reason: 'The host closed the room.' });
    window.setTimeout(() => this.peer.destroy(), 200);
  }

  private accept(conn: DataConnection): void {
    const r: Remote = { conn, id: null };
    this.remotes.push(r);
    conn.on('data', (data) => this.onData(r, data as ClientMsg));
    conn.on('close', () => this.drop(r));
    conn.on('error', () => this.drop(r));
  }

  private onData(r: Remote, msg: ClientMsg): void {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      if (r.id) return;
      if (msg.v !== PROTOCOL_VERSION) return this.reject(r, 'This room runs a different game version. Reload the page.');
      if (this.inGame) return this.reject(r, 'This game has already started.');
      if (this.players.length >= MAX_PLAYERS) return this.reject(r, 'This room is full.');
      const id = this.freeId();
      r.id = id;
      this.players.push({ id, name: sanitizeName(msg.name), variant: sanitizeVariant(msg.variant), weapon: sanitizeWeapon(msg.weapon) });
      this.bots = Math.min(this.bots, MAX_PLAYERS - this.players.length);
      this.send(r, { t: 'welcome', id });
      this.broadcastLobby();
      this.onChange?.();
    } else if (msg.t === 'input' && r.id) {
      const input = decodeInput(msg.i);
      // Keep an unconsumed dash press until the simulation has seen it.
      if (this.inputs.get(r.id)?.dash) input.dash = true;
      this.inputs.set(r.id, input);
    }
  }

  private drop(r: Remote): void {
    const i = this.remotes.indexOf(r);
    if (i < 0) return;
    this.remotes.splice(i, 1);
    if (!r.id) return;
    this.inputs.delete(r.id);
    if (this.inGame) {
      this.onPlayerLeft?.(r.id);
    } else {
      const p = this.players.findIndex((x) => x.id === r.id);
      if (p >= 0) this.players.splice(p, 1);
      this.broadcastLobby();
      this.onChange?.();
    }
  }

  private freeId(): string {
    for (let n = 2; n <= MAX_PLAYERS; n++) {
      const id = `p${n}`;
      if (!this.players.some((p) => p.id === id)) return id;
    }
    return `p${Date.now()}`;
  }

  private reject(r: Remote, reason: string): void {
    this.send(r, { t: 'reject', reason });
    window.setTimeout(() => r.conn.close(), 300);
  }

  private broadcastLobby(): void {
    this.broadcast({ t: 'lobby', players: this.players, bots: this.bots });
  }

  private broadcast(msg: HostMsg): void {
    for (const r of this.remotes) if (r.id) this.send(r, msg);
  }

  private send(r: Remote, msg: HostMsg): void {
    if (!r.conn.open) return;
    try {
      r.conn.send(msg);
    } catch (err) {
      console.warn('[host] send failed', err);
    }
  }
}
