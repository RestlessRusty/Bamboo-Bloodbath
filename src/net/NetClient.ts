import type { DataConnection, Peer } from 'peerjs';
import type { Difficulty } from '../config';
import type { OpenCommand, RoomMode, WorldJoin } from '../sim/open/types';
import type { PlayerInput, PlayerSpec, Snapshot } from '../sim/types';
import { decodeSnapshot } from './codec';
import { openPeer, peerErrorType } from './peer';
import {
  encodeInput,
  PEER_PREFIX,
  PROTOCOL_VERSION,
  sanitizeDifficulty,
  sanitizeJoin,
  sanitizeMode,
  sanitizeRoomWorld,
  type ClientMsg,
  type HostMsg,
  type LobbyPlayer,
  type RoomWorld,
} from './protocol';

/** The host turned a join away (full world or room, another game version): trying again won't help. */
export class JoinRejected extends Error {}

/** A guest's connection to the host's room. */
export class NetClient {
  players: LobbyPlayer[] = [];
  bots = 0;
  /** The host's map choice as sent (validate before use). */
  mapPick = '';
  /** The host's difficulty (sanitized). */
  difficulty: Difficulty = 'normal';
  /** Quick play matches, or an infinite-mode world (sanitized). */
  mode: RoomMode = 'quick';
  /** Infinite mode: the world the room plays (sanitized; from the lobby, or from the start of a world we joined). */
  world: RoomWorld | null = null;
  /** The host is in a match we're not part of: we play the next one. */
  playing = false;
  onLobby: (() => void) | null = null;
  /**
   * `map` is unvalidated wire data (should be a MapRef). `you`: the panda we play when joining a match
   * already running (null at a normal start: our own id). `open`: an infinite-mode world as it is now
   * (sanitized), null in a normal match.
   */
  onStart: ((specs: PlayerSpec[], map: unknown, difficulty: Difficulty, you: string | null, open: WorldJoin | null) => void) | null =
    null;
  /** Mid-match: pandas changed hands. */
  onSpecs: ((specs: PlayerSpec[]) => void) | null = null;
  onSnapshot: ((snap: Snapshot) => void) | null = null;
  /** `retry`: the connection dropped (worth reconnecting), rather than the host closing the room. */
  onClosed: ((reason: string, retry: boolean) => void) | null = null;
  private closed = false;
  /** Last known state of every bamboo snack spot this match (infinite mode only sends the ones near us). */
  private readonly snacks: boolean[] = [];

  private constructor(
    private readonly peer: Peer,
    private readonly conn: DataConnection,
    readonly myId: string,
    readonly code: string,
  ) {
    conn.on('data', (data) => this.onData(data as HostMsg));
    conn.on('close', () => this.lost('Lost connection to the host.', true));
    conn.on('error', () => this.lost('Lost connection to the host.', true));
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
    });
  }

  /** `seat`: this device's ticket for the room (see rooms.ts). */
  static async join(code: string, me: Omit<LobbyPlayer, 'id'>, seat: string): Promise<NetClient> {
    const peer = await openPeer();
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (message: string, rejected = false) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        peer.destroy();
        reject(rejected ? new JoinRejected(message) : new Error(message));
      };
      const timer = window.setTimeout(() => fail('Could not connect to the room. Check the code and try again.'), 15000);

      const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
      peer.on('error', (err) => {
        const type = peerErrorType(err);
        if (type === 'peer-unavailable') fail(`Room ${code} not found. Check the code.`);
        else if (!settled) fail(`Connection problem (${type || 'unknown'}).`);
      });
      conn.on('open', () => {
        conn.send({ t: 'hello', v: PROTOCOL_VERSION, name: me.name, variant: me.variant, weapon: me.weapon, seat });
      });
      conn.on('data', (data) => {
        if (settled) return;
        const msg = data as HostMsg;
        if (msg?.t === 'welcome') {
          settled = true;
          window.clearTimeout(timer);
          resolve(new NetClient(peer, conn, msg.id, code));
        } else if (msg?.t === 'reject') {
          fail(typeof msg.reason === 'string' && msg.reason ? msg.reason : 'The host turned us away.', true);
        }
      });
    });
  }

  sendInput(input: PlayerInput): void {
    if (this.closed || !this.conn.open) return;
    try {
      this.conn.send({ t: 'input', i: encodeInput(input) });
    } catch {
      // Channel hiccup; the next input will follow shortly.
    }
  }

  requestEnd(): void {
    if (this.closed || !this.conn.open) return;
    try {
      this.conn.send({ t: 'end' });
    } catch {
      // Channel hiccup; the button can be pressed again.
    }
  }

  /** Infinite mode: build / craft (the host's rules check it and say no with a 'deny' event). */
  sendCommand(cmd: OpenCommand): void {
    if (this.closed || !this.conn.open) return;
    try {
      this.conn.send({ t: 'cmd', c: cmd } satisfies ClientMsg);
    } catch {
      // Channel hiccup; the player can tap again.
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.conn.close();
    window.setTimeout(() => this.peer.destroy(), 100);
  }

  private onData(msg: HostMsg): void {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'lobby':
        this.players = Array.isArray(msg.players) ? msg.players : [];
        this.bots = typeof msg.bots === 'number' ? msg.bots : 0;
        this.mapPick = typeof msg.map === 'string' ? msg.map : '';
        this.difficulty = sanitizeDifficulty(msg.difficulty);
        this.mode = sanitizeMode(msg.mode);
        this.world = this.mode === 'open' ? sanitizeRoomWorld(msg.world) : null;
        this.playing = msg.playing === true;
        this.onLobby?.();
        break;
      case 'start':
        if (Array.isArray(msg.specs)) {
          this.difficulty = sanitizeDifficulty(msg.difficulty);
          this.playing = false;
          const you = typeof msg.you === 'string' && msg.specs.some((s) => s?.id === msg.you) ? msg.you : null;
          const open = sanitizeJoin(msg.open);
          this.snacks.length = 0;
          if (open) {
            this.mode = 'open';
            this.world = sanitizeRoomWorld(msg.world) ?? this.world;
          }
          this.onStart?.(msg.specs, msg.map, this.difficulty, you, open);
        }
        break;
      case 'reject':
        // After 'welcome' only when an infinite-mode world turned out to be full.
        this.lost(msg.reason || 'The host turned us away.', false);
        break;
      case 'specs':
        if (Array.isArray(msg.specs)) this.onSpecs?.(msg.specs);
        break;
      case 'snap':
        if (msg.s && typeof msg.s === 'object') this.onSnapshot?.(decodeSnapshot(msg.s, this.snacks));
        break;
      case 'bye':
        this.lost(msg.reason || 'The host left.', false);
        break;
      default:
        break;
    }
  }

  private lost(reason: string, retry: boolean): void {
    if (this.closed) return;
    this.closed = true;
    this.peer.destroy();
    this.onClosed?.(reason, retry);
  }
}
