import type { DataConnection, Peer } from 'peerjs';
import { MAX_PLAYERS, type Difficulty } from '../config';
import type { MapRef } from '../sim/mapLayout';
import { OPEN } from '../sim/open/config';
import type { OpenCommand, RoomMode, WorldJoin, WorldSlotInfo } from '../sim/open/types';
import { NO_INPUT, type PlayerInput, type PlayerSpec, type Snapshot } from '../sim/types';
import { encodeSnapshot } from './codec';
import { openPeer, peerErrorType } from './peer';
import {
  decodeInput,
  makeRoomCode,
  PEER_PREFIX,
  PROTOCOL_VERSION,
  sanitizeCommand,
  sanitizeName,
  sanitizeVariant,
  sanitizeWeapon,
  type ClientMsg,
  type HostMsg,
  type LobbyPlayer,
  type RoomWorld,
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
  /** Infinite mode: a new panda for a newcomer. False when the world can't take one. */
  addSeat(spec: PlayerSpec): boolean;
  /** Infinite mode: a guest's panda leaves the world with them. */
  removeSeat(id: string): void;
  /** Infinite mode: the world as it is right now, for a guest joining (null in other matches). */
  joinWorld(): WorldJoin | null;
}

const dayOf = (clock: number) => Math.floor(clock / OPEN.dayLength) + 1;

/**
 * The room creator's side: owns the room code, the lobby, collects the guests' inputs
 * and broadcasts snapshots of the simulation it runs.
 *
 * Mid-match, a guest who drops out leaves their panda to a bot and gets it back when they reconnect
 * (recognised by their seat ticket); a newcomer takes over a bot buddy's panda, or waits in the room
 * for the next match when there's none.
 *
 * Infinite mode (`mode` 'open') works differently once the world is running: a newcomer gets a panda of
 * their own while there are fewer than MAX_PLAYERS, else a bot buddy's, else "This world is full". A guest
 * who leaves takes their panda out of the world (the host's save keeps it under their name).
 */
export class NetHost {
  readonly players: LobbyPlayer[];
  bots = 0;
  /** The host's map choice (a map id or "random"). */
  mapPick: string;
  difficulty: Difficulty;
  /** Quick play matches, or an infinite-mode world (`world`). */
  mode: RoomMode = 'quick';
  /** Infinite mode: the saved world this room plays. */
  world: WorldSlotInfo | null = null;
  inGame = false;
  /** The running match (set by whoever starts it; null in the lobby). */
  game: MatchSeats | null = null;
  /** Lobby changed (someone joined/left, bot count). */
  onChange: (() => void) | null = null;
  /** Something to tell the host's player mid-match ("Bob left", "Bob is back"). */
  onNotice: ((text: string) => void) | null = null;
  /** A guest pressed "End match". */
  onEndRequest: (() => void) | null = null;
  /** Infinite mode: a guest's build / craft request (already sanitised) for the panda `seat`. */
  onCommand: ((seat: string, cmd: OpenCommand) => void) | null = null;

  private readonly remotes: Remote[] = [];
  /** Keyed by panda (survivor id), which for a newcomer is the bot's they took over. */
  private readonly inputs = new Map<string, PlayerInput>();
  private readonly inputAt = new Map<string, number>();
  /** `open`: an infinite-mode world. */
  private match: { specs: PlayerSpec[]; map: MapRef; open: boolean } | null = null;
  /** Player id → the panda they play this match. */
  private readonly seats = new Map<string, string>();
  /** Seat ticket → player id, to recognise a guest coming back. */
  private readonly tickets = new Map<string, string>();
  /** Infinite mode: bot buddies' names while a guest plays their panda, to hand it back when they leave. */
  private readonly botNames = new Map<string, string>();

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

  setMode(mode: RoomMode): void {
    this.mode = mode;
    this.broadcastLobby();
    this.onChange?.();
  }

  /** Infinite mode: which saved world the room plays (lobby only: a lobby message mid-match ends it for guests). */
  setWorld(info: WorldSlotInfo | null): void {
    this.world = info;
    this.broadcastLobby();
    this.onChange?.();
  }

  /** `open`: the world as it is now when this is an infinite-mode world. */
  start(specs: PlayerSpec[], map: MapRef, open?: WorldJoin): void {
    this.inGame = true;
    this.inputs.clear();
    this.inputAt.clear();
    this.match = { specs: specs.map((s) => ({ ...s })), map, open: !!open };
    this.seats.clear();
    this.botNames.clear();
    for (const p of this.players) if (p.id !== 'p1') this.seats.set(p.id, p.id);
    for (const r of this.remotes) r.inMatch = r.id !== null;
    this.broadcast({ t: 'start', specs, map, difficulty: this.difficulty, open, world: open ? this.roomWorld(open) : undefined });
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
    if (!snap.open) {
      this.broadcast({ t: 'snap', s: encodeSnapshot(snap) }, true);
      return;
    }
    // An open world is too big to send every zombie to everyone: each guest gets what's around their panda.
    for (const r of this.remotes) {
      if (!r.id || !r.inMatch) continue;
      const seat = this.seats.get(r.id);
      const me = seat ? snap.survivors.find((s) => s.id === seat) : undefined;
      this.send(r, { t: 'snap', s: encodeSnapshot(snap, me ?? null) });
    }
  }

  /** After a match: everyone still connected goes back to the lobby (including anyone who was waiting). */
  backToLobby(): void {
    this.inGame = false;
    this.game = null;
    this.match = null;
    this.seats.clear();
    this.botNames.clear();
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
    } else if (msg.t === 'cmd' && r.id && r.inMatch && this.inGame) {
      const seat = this.seats.get(r.id);
      const cmd = sanitizeCommand(msg.c);
      if (seat && cmd) this.onCommand?.(seat, cmd);
    }
  }

  private hello(r: Remote, msg: Extract<ClientMsg, { t: 'hello' }>): void {
    if (r.id) return;
    if (msg.v !== PROTOCOL_VERSION) return this.reject(r, 'This room runs a different game version. Reload the page.');
    const ticket = typeof msg.seat === 'string' ? msg.seat.slice(0, 64) : '';
    const back = ticket ? this.tickets.get(ticket) : undefined;
    const known = back !== undefined && this.players.some((p) => p.id === back) ? back : null;
    const world = this.inGame && this.match?.open === true;
    // A running world with no panda left for them: say so before welcoming them in.
    if (world && !(known && this.seats.has(known)) && !this.canSeat()) return this.reject(r, 'This world is full.');
    if (known) {
      // Coming back, maybe before we noticed the old connection died: this one replaces it.
      const old = this.remotes.find((x) => x !== r && x.id === known);
      if (old) {
        this.remotes.splice(this.remotes.indexOf(old), 1);
        old.id = null;
        old.conn.close();
      }
      r.id = known;
    } else {
      if (this.players.length >= MAX_PLAYERS) return this.reject(r, world ? 'This world is full.' : 'This room is full.');
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
    // Infinite mode: a panda of their own while the world has room (the rules restore it from the save by name).
    let fresh = false;
    if (live && !seat && live.open && live.specs.length < MAX_PLAYERS && !live.specs.some((s) => s.id === id)) {
      const spec: PlayerSpec = { id, name: p.name, variant: p.variant, weapon: p.weapon, bot: false };
      if (game!.addSeat(spec)) {
        live.specs.push(spec);
        seat = id;
        fresh = true;
      }
    }
    if (live && !seat) seat = game!.freeBotSeat();
    if (!live || !seat) {
      this.seats.delete(id);
      if (live?.open) return this.reject(r, 'This world is full.');
      this.send(r, this.lobbyMsg(true));
      this.onNotice?.(`${p.name} ${returning ? 'is back' : 'joined'}: they'll play the next match.`);
      return;
    }
    // A panda someone else had and then left behind goes to the newcomer for good.
    for (const [pid, s] of this.seats) if (s === seat && pid !== id) this.seats.delete(pid);
    this.seats.set(id, seat);
    const botName = live.specs.find((s) => s.id === seat)?.name ?? 'a bot';
    if (fresh) {
      this.broadcast({ t: 'specs', specs: live.specs }, true);
    } else {
      if (live.open && !own) this.botNames.set(seat, botName);
      this.updateSeat(seat, false, p.name);
    }
    r.inMatch = true;
    const open = live.open ? (game!.joinWorld() ?? undefined) : undefined;
    this.send(r, {
      t: 'start',
      specs: live.specs,
      map: live.map,
      difficulty: this.difficulty,
      you: seat,
      open,
      world: open ? this.roomWorld(open) : undefined,
    });
    if (fresh) this.onNotice?.(`${p.name} ${returning ? 'is back' : 'joined the world'}!`);
    else this.onNotice?.(own ? `${p.name} is back!` : `${p.name} joined and took over ${botName}'s panda!`);
  }

  /** Infinite mode: room for one more panda in the running world, or a bot buddy's to take over. */
  private canSeat(): boolean {
    const m = this.match;
    const game = this.game;
    if (!m || !game || game.isOver) return false;
    return m.specs.length < MAX_PLAYERS || game.freeBotSeat() !== null;
  }

  /** The world's name and its day right now (`join`), for the guests' welcome. */
  private roomWorld(join: WorldJoin): RoomWorld | undefined {
    return this.world ? { name: this.world.name, day: dayOf(join.clock) } : undefined;
  }

  /**
   * Infinite mode: a guest's own panda leaves the world with them (the save keeps it under their name);
   * a bot buddy's panda they had taken over goes back to the bot. They're off the room's list too, so
   * someone else can have the place; coming back they're welcomed like a newcomer and get their panda back.
   */
  private leaveWorld(id: string, seat: string, name: string): void {
    const m = this.match;
    if (!m) return;
    this.seats.delete(id);
    this.removePlayer(id);
    const bot = this.botNames.get(seat);
    if (bot !== undefined) {
      this.botNames.delete(seat);
      this.updateSeat(seat, true, bot);
      this.onNotice?.(`${name} left. ${bot} is back on autopilot.`);
      return;
    }
    this.game?.removeSeat(seat);
    const i = m.specs.findIndex((s) => s.id === seat);
    if (i >= 0) m.specs.splice(i, 1);
    this.broadcast({ t: 'specs', specs: m.specs }, true);
    this.onNotice?.(`${name} left the world.`);
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
      if (this.game && !this.game.isOver && this.match?.open) {
        this.leaveWorld(id, seat, name);
      } else if (this.game && !this.game.isOver) {
        // Their panda keeps going on autopilot; they stay on the list in case they come back.
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
    const w = this.mode === 'open' ? this.world : null;
    return {
      t: 'lobby',
      players: this.players,
      bots: this.bots,
      map: this.mapPick,
      difficulty: this.difficulty,
      playing,
      mode: this.mode,
      world: w ? { name: w.name, day: w.day } : undefined,
    };
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
