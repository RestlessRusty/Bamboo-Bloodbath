import type { DataConnection, Peer } from 'peerjs';
import { MAX_PLAYERS, type Difficulty } from '../config';
import type { MapRef } from '../sim/mapLayout';
import { NO_INPUT, type PlayerInput, type PlayerSpec, type Snapshot } from '../sim/types';
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

/** A guest sends input ~30 times a second; this long without any, their panda stops. */
const INPUT_STALE_MS = 500;

interface Remote {
  conn: DataConnection;
  id: string | null;
  /** Playing in the current match (rather than waiting in the room for the next one). */
  inMatch: boolean;
}

/** The match running on the host, for pandas changing hands mid-match (LocalGame). */
export interface MatchSeats {
  readonly isOver: boolean;
  /** A bot buddy's panda a newcomer can take over, or null. */
  freeBotSeat(): string | null;
  setSpec(spec: PlayerSpec): void;
}

/**
 * The room creator's side: owns the room code, the lobby, collects the guests' inputs
 * and broadcasts snapshots of the simulation it runs.
 *
 * Mid-match, a guest who drops out leaves their panda to a bot and gets it back when they reconnect
 * (recognised by their seat ticket); a newcomer takes over a bot buddy's panda, or waits in the room
 * for the next match when there's none.
 */
export class NetHost {
  readonly players: LobbyPlayer[];
  bots = 0;
  /** The host's map choice (a map id or "random"). */
  mapPick: string;
  difficulty: Difficulty;
  inGame = false;
  /** The running match (set by whoever starts it; null in the lobby). */
  game: MatchSeats | null = null;
  /** Lobby changed (someone joined/left, bot count). */
  onChange: (() => void) | null = null;
  /** Something to tell the host's player mid-match ("Bob left", "Bob is back"). */
  onNotice: ((text: string) => void) | null = null;
  /** A guest pressed "End match". */
  onEndRequest: (() => void) | null = null;

  private readonly remotes: Remote[] = [];
  /** Keyed by panda (survivor id), which for a newcomer is the bot's they took over. */
  private readonly inputs = new Map<string, PlayerInput>();
  private readonly inputAt = new Map<string, number>();
  private match: { specs: PlayerSpec[]; map: MapRef } | null = null;
  /** Player id → the panda they play this match. */
  private readonly seats = new Map<string, string>();
  /** Seat ticket → player id, to recognise a guest coming back. */
  private readonly tickets = new Map<string, string>();

  private constructor(
    private readonly peer: Peer,
    readonly code: string,
    me: Omit<LobbyPlayer, 'id'>,
    mapPick: string,
    difficulty: Difficulty,
  ) {
    this.players = [{ ...me, id: 'p1' }];
    this.mapPick = mapPick;
    this.difficulty = difficulty;
    peer.on('connection', (conn) => this.accept(conn));
    // Losing the signalling server doesn't break existing connections; reconnect so new guests can join.
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
    });
    peer.on('error', (err) => console.warn('[host] peer error', peerErrorType(err), err));
  }

  /** Opens the room under `preferred` (this device's own code) if it's free, else under a random one. */
  static async create(me: Omit<LobbyPlayer, 'id'>, mapPick: string, difficulty: Difficulty, preferred: string): Promise<NetHost> {
    const codes = [preferred, ...Array.from({ length: 5 }, makeRoomCode)];
    for (const code of codes) {
      try {
        const peer = await openPeer(PEER_PREFIX + code);
        return new NetHost(peer, code, me, mapPick, difficulty);
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

  setMap(pick: string): void {
    this.mapPick = pick;
    this.broadcastLobby();
    this.onChange?.();
  }

  setDifficulty(difficulty: Difficulty): void {
    this.difficulty = difficulty;
    this.broadcastLobby();
    this.onChange?.();
  }

  start(specs: PlayerSpec[], map: MapRef): void {
    this.inGame = true;
    this.inputs.clear();
    this.inputAt.clear();
    this.match = { specs: specs.map((s) => ({ ...s })), map };
    this.seats.clear();
    for (const p of this.players) if (p.id !== 'p1') this.seats.set(p.id, p.id);
    for (const r of this.remotes) r.inMatch = r.id !== null;
    this.broadcast({ t: 'start', specs, map, difficulty: this.difficulty });
  }

  /** Latest input for a guest's panda. Dash, firecracker and switch presses are handed out only once; a guest gone quiet stands still. */
  inputFor(id: string): PlayerInput | undefined {
    const i = this.inputs.get(id);
    if (!i) return undefined;
    if (performance.now() - (this.inputAt.get(id) ?? 0) > INPUT_STALE_MS) return { ...NO_INPUT };
    if (i.dash || i.cracker || i.swap) this.inputs.set(id, { ...i, dash: false, cracker: false, swap: false });
    return i;
  }

  sendSnapshot(snap: Snapshot): void {
    this.broadcast({ t: 'snap', s: encodeSnapshot(snap) }, true);
  }

  /** After a match: everyone still connected goes back to the lobby (including anyone who was waiting). */
  backToLobby(): void {
    this.inGame = false;
    this.game = null;
    this.match = null;
    this.seats.clear();
    this.inputs.clear();
    this.inputAt.clear();
    for (const r of this.remotes) r.inMatch = false;
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
    const r: Remote = { conn, id: null, inMatch: false };
    this.remotes.push(r);
    conn.on('data', (data) => this.onData(r, data as ClientMsg));
    conn.on('close', () => this.drop(r));
    conn.on('error', () => this.drop(r));
  }

  private onData(r: Remote, msg: ClientMsg): void {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      this.hello(r, msg);
    } else if (msg.t === 'input' && r.id && r.inMatch) {
      const seat = this.seats.get(r.id);
      if (!seat) return;
      const input = decodeInput(msg.i);
      // Keep unconsumed dash / firecracker / switch presses until the simulation has seen them.
      const prev = this.inputs.get(seat);
      if (prev?.dash) input.dash = true;
      if (prev?.cracker) input.cracker = true;
      if (prev?.swap) input.swap = true;
      this.inputs.set(seat, input);
      this.inputAt.set(seat, performance.now());
    } else if (msg.t === 'end' && r.id && r.inMatch && this.inGame) {
      this.onEndRequest?.();
    }
  }

  private hello(r: Remote, msg: Extract<ClientMsg, { t: 'hello' }>): void {
    if (r.id) return;
    if (msg.v !== PROTOCOL_VERSION) return this.reject(r, 'This room runs a different game version. Reload the page.');
    const ticket = typeof msg.seat === 'string' ? msg.seat.slice(0, 64) : '';
    const back = ticket ? this.tickets.get(ticket) : undefined;
    if (back && this.players.some((p) => p.id === back)) {
      // Coming back, maybe before we noticed the old connection died: this one replaces it.
      const old = this.remotes.find((x) => x !== r && x.id === back);
      if (old) {
        this.remotes.splice(this.remotes.indexOf(old), 1);
        old.id = null;
        old.conn.close();
      }
      r.id = back;
    } else {
      if (this.players.length >= MAX_PLAYERS) return this.reject(r, 'This room is full.');
      r.id = this.freeId();
      this.players.push({ id: r.id, name: sanitizeName(msg.name), variant: sanitizeVariant(msg.variant), weapon: sanitizeWeapon(msg.weapon) });
      this.bots = Math.min(this.bots, MAX_PLAYERS - this.players.length);
    }
    if (ticket) this.tickets.set(ticket, r.id);
    this.send(r, { t: 'welcome', id: r.id });
    if (this.inGame) {
      this.joinMatch(r, back === r.id);
    } else {
      this.broadcastLobby();
      this.onChange?.();
    }
  }

  /** Someone connected while a match is on: back into their panda, into a bot's, or wait for the next match. */
  private joinMatch(r: Remote, returning: boolean): void {
    const id = r.id!;
    const p = this.players.find((x) => x.id === id)!;
    const game = this.game;
    const live = this.match && game && !game.isOver ? this.match : null;
    let seat = live ? (this.seats.get(id) ?? null) : null;
    const own = seat !== null;
    if (live && !seat) seat = game!.freeBotSeat();
    if (!live || !seat) {
      this.seats.delete(id);
      this.send(r, this.lobbyMsg(true));
      this.onNotice?.(`${p.name} ${returning ? 'is back' : 'joined'}: they'll play the next match.`);
      return;
    }
    // A panda someone else had and then left behind goes to the newcomer for good.
    for (const [pid, s] of this.seats) if (s === seat && pid !== id) this.seats.delete(pid);
    this.seats.set(id, seat);
    const botName = live.specs.find((s) => s.id === seat)?.name ?? 'a bot';
    this.updateSeat(seat, false, p.name);
    r.inMatch = true;
    this.send(r, { t: 'start', specs: live.specs, map: live.map, difficulty: this.difficulty, you: seat });
    this.onNotice?.(own ? `${p.name} is back!` : `${p.name} joined and took over ${botName}'s panda!`);
  }

  /** A panda changes hands: tell the game and every guest in the match. */
  private updateSeat(seat: string, bot: boolean, name?: string): void {
    const m = this.match;
    if (!m) return;
    const i = m.specs.findIndex((s) => s.id === seat);
    if (i < 0) return;
    const spec = { ...m.specs[i], bot, name: name ?? m.specs[i].name };
    m.specs[i] = spec;
    this.game?.setSpec(spec);
    this.broadcast({ t: 'specs', specs: m.specs }, true);
  }

  private drop(r: Remote): void {
    const i = this.remotes.indexOf(r);
    if (i < 0) return;
    this.remotes.splice(i, 1);
    if (!r.id) return;
    const id = r.id;
    const name = this.players.find((x) => x.id === id)?.name ?? 'A player';
    const seat = r.inMatch ? this.seats.get(id) : undefined;
    if (seat) {
      this.inputs.delete(seat);
      this.inputAt.delete(seat);
    }
    if (!this.inGame) {
      this.removePlayer(id);
      this.broadcastLobby();
      this.onChange?.();
    } else if (seat) {
      // Their panda keeps going on autopilot; they stay on the list in case they come back.
      if (this.game && !this.game.isOver) {
        this.updateSeat(seat, true);
        this.onNotice?.(`${name} left. A bot takes over their panda.`);
      }
    } else if (!r.inMatch) {
      // Was waiting for the next match.
      this.removePlayer(id);
    }
  }

  private removePlayer(id: string): void {
    const p = this.players.findIndex((x) => x.id === id);
    if (p >= 0) this.players.splice(p, 1);
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

  /** `playing`: sent to someone waiting while the others play. */
  private lobbyMsg(playing = false): HostMsg {
    return { t: 'lobby', players: this.players, bots: this.bots, map: this.mapPick, difficulty: this.difficulty, playing };
  }

  private broadcastLobby(): void {
    this.broadcast(this.lobbyMsg());
  }

  /** `matchOnly`: just the guests playing the current match. */
  private broadcast(msg: HostMsg, matchOnly = false): void {
    for (const r of this.remotes) if (r.id && (!matchOnly || r.inMatch)) this.send(r, msg);
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
