import './style.css';
import { Sfx } from './audio/Sfx';
import { MATCH_TIME } from './config';
import { LocalGame } from './game/LocalGame';
import { cyclePick, hutDirection, isMapRef, isValidPick, loadMap, previewMap, resolvePick } from './game/maps';
import { RemoteGame } from './game/RemoteGame';
import type { GameContext, Session } from './game/Session';
import { InputManager, requestTiltPermission } from './input/InputManager';
import { NetClient } from './net/NetClient';
import { NetHost } from './net/NetHost';
import type { LobbyPlayer } from './net/protocol';
import { Renderer } from './render/Renderer';
import { loadSettings, saveSettings } from './settings';
import { botName } from './sim/bots';
import type { MapRef } from './sim/mapLayout';
import { DEFAULT_MAP, refOf } from './sim/maps';
import { initPhysics } from './sim/physics';
import { PANDA_VARIANTS, WEAPON_TYPES, type PlayerSpec, type Snapshot } from './sim/types';
import { el, formatTime } from './ui/dom';
import { Hud, type EndMode } from './ui/Hud';
import { Lobby } from './ui/Lobby';
import { Menu } from './ui/Menu';
import { SettingsPanel, type SettingKey } from './ui/SettingsPanel';

// ------------------------------------------------------------------ error reporting

// Phones have no dev console, so surface errors on screen.
function showError(msg: string): void {
  let box = document.querySelector<HTMLDivElement>('.error-box');
  if (!box) {
    box = el('div', 'error-box');
    box.title = 'Tap to dismiss';
    box.addEventListener('click', () => box?.remove());
    document.body.appendChild(box);
  }
  box.textContent += `${msg}\n`;
}
window.addEventListener('error', (e) => showError(String(e.message)));
window.addEventListener('unhandledrejection', (e) => showError(String(e.reason)));
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ------------------------------------------------------------------ core objects

const appEl = document.getElementById('app')!;
const uiEl = document.getElementById('ui')!;

const settings = loadSettings();
if (!isValidPick(settings.map)) settings.map = DEFAULT_MAP.id;
const renderer = new Renderer(appEl, previewMap(settings.map) ?? loadMap(refOf(DEFAULT_MAP)), settings.quality);
const physicsReady = initPhysics();
const sfx = new Sfx();
sfx.setEnabled(settings.sound, settings.music);

let session: Session | null = null;
let mode: EndMode = 'solo';
let localId = 'p1';
let host: NetHost | null = null;
let client: NetClient | null = null;
/** Bumped whenever we leave multiplayer, so late network replies are ignored. */
let netToken = 0;
let wakeLock: { release(): Promise<void> } | null = null;
const fallbackName = `Panda${Math.floor(100 + Math.random() * 900)}`;

const input = new InputManager(uiEl, {
  screenToGround: (x, y) => renderer.screenToGround(x, y),
  playerPos: () => renderer.localPlayerPos(),
  onPause: () => {
    if (session && !session.isOver) setPaused(!session.paused);
  },
});
input.setScheme(settings.controls);
input.setFlipTilt(settings.flipTilt);

const settingsPanel = new SettingsPanel(uiEl, settings, onSettingChanged, () => input.calibrateTilt());

const hud = new Hud(uiEl, {
  onPause: () => setPaused(true),
  onResume: () => setPaused(false),
  onSettings: () => settingsPanel.open(),
  onRestart: () => void startSolo(),
  onLobby: () => hostBackToLobby(),
  onQuit: () => leaveToMenu(),
});

const menu = new Menu(uiEl, settings, {
  onPlaySolo: () => void startSolo(),
  onMultiplayer: () => {
    unlockAudio();
    menu.hide();
    lobby.showChoose();
  },
  onSettings: () => settingsPanel.open(),
  onPreview: () => renderer.setShowcase(settings.variant, settings.weapon),
  onMapPreview: () => showMenuMap(),
  onChange: () => saveSettings(settings),
});

const lobby = new Lobby(uiEl, {
  onCreate: () => void createRoom(),
  onJoin: (code) => void joinRoom(code),
  onStart: () => void hostStart(),
  onBots: (n) => host?.setBots(n),
  onMap: (dir) => {
    if (!host) return;
    settings.map = cyclePick(host.mapPick, dir);
    saveSettings(settings);
    host.setMap(settings.map);
  },
  onLeave: () => leaveToMenu(),
});

const ctx: GameContext = { renderer, input, hud, sfx, settings };

renderer.setShowcase(settings.variant, settings.weapon);

// ------------------------------------------------------------------ helpers

function onSettingChanged(key: SettingKey): void {
  saveSettings(settings);
  if (key === 'quality') renderer.setQuality(settings.quality);
  if (key === 'controls') input.setScheme(settings.controls);
  if (key === 'flipTilt') input.setFlipTilt(settings.flipTilt);
  if (key === 'sound' || key === 'music') sfx.setEnabled(settings.sound, settings.music);
}

/** Behind the menu: the chosen map's camp ("random" keeps whatever is showing). */
function showMenuMap(): void {
  const map = previewMap(settings.map);
  if (map) renderer.setMap(map);
  renderer.setShowcase(settings.variant, settings.weapon);
}

function unlockAudio(): void {
  sfx.unlock();
  sfx.setMusic(true);
}
document.addEventListener('pointerdown', unlockAudio, { once: true });

function nickname(): string {
  return settings.nickname.trim() || fallbackName;
}

function profile(): Omit<LobbyPlayer, 'id'> {
  return { name: nickname(), variant: settings.variant, weapon: settings.weapon };
}

function botSpecs(count: number): PlayerSpec[] {
  const offset = Math.floor(Math.random() * 10);
  return Array.from({ length: count }, (_, i) => ({
    id: `b${i + 1}`,
    name: botName(offset + i),
    variant: PANDA_VARIANTS[Math.floor(Math.random() * PANDA_VARIANTS.length)],
    weapon: WEAPON_TYPES[Math.floor(Math.random() * WEAPON_TYPES.length)],
    bot: true,
  }));
}

/** Must run inside a tap (browsers require a user gesture). */
function enterFullscreenLandscape(): void {
  if (!window.matchMedia('(pointer: coarse)').matches) return;
  const root = document.documentElement;
  const lock = () => {
    // Older iOS has no screen.orientation at all, and some browsers throw instead of rejecting.
    const orientation = screen.orientation as unknown as { lock?: (o: string) => Promise<void> } | undefined;
    try {
      orientation?.lock?.('landscape')?.catch(() => undefined);
    } catch {
      // Not supported: the CSS rotate hint covers portrait.
    }
  };
  if (!document.fullscreenElement && root.requestFullscreen) {
    root.requestFullscreen({ navigationUI: 'hide' }).then(lock, () => undefined);
  } else {
    lock();
  }
}

/**
 * Must run inside a tap. iOS forgets motion-sensor permission on reload, so a saved "tilt"
 * choice asks again here; without sensors we fall back to the joystick rather than a stuck panda.
 */
function ensureTiltPermission(): void {
  if (settings.controls !== 'tilt') return;
  void requestTiltPermission().then((ok) => {
    if (ok || settings.controls !== 'tilt') return;
    settings.controls = 'joystick';
    saveSettings(settings);
    input.setScheme('joystick');
    hud.flash('Motion sensors unavailable: switched to joystick controls.');
  });
}

async function requestWakeLock(): Promise<void> {
  try {
    const wl = (navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (wl && !wakeLock) wakeLock = await wl.request('screen');
  } catch {
    // Not supported or denied: the screen may dim during long matches.
  }
}

function releaseWakeLock(): void {
  wakeLock?.release().catch(() => undefined);
  wakeLock = null;
}

// ------------------------------------------------------------------ sessions

function clearSession(): void {
  session?.dispose();
  session = null;
}

function enterGame(mapRef: MapRef, create: () => Session): void {
  clearSession();
  renderer.clearShowcase();
  const map = loadMap(mapRef);
  renderer.setMap(map);
  hud.setRoute(map.route);
  menu.hide();
  lobby.hide();
  hud.show();
  session = create();
  input.setEnabled(true);
  void requestWakeLock();
  hud.flash(`${map.layout.name}: reach the rescue hut to the ${hutDirection(map.layout)}!`, 3500);
  const { tip } = map.layout;
  const started = session;
  if (tip) {
    window.setTimeout(() => {
      if (started && session === started && !started.isOver) hud.flash(tip, 4500);
    }, 3800);
  }
}

async function startSolo(): Promise<void> {
  enterFullscreenLandscape();
  ensureTiltPermission();
  unlockAudio();
  await physicsReady;
  mode = 'solo';
  localId = 'p1';
  const specs: PlayerSpec[] = [
    { id: 'p1', name: nickname(), variant: settings.variant, weapon: settings.weapon, bot: false },
    ...botSpecs(settings.bots),
  ];
  enterGame(resolvePick(settings.map), () => new LocalGame(ctx, specs, localId, onGameEnd));
}

function onGameEnd(snap: Snapshot): void {
  input.setEnabled(false);
  releaseWakeLock();
  const won = snap.phase === 'won';
  sfx.play(won ? 'win' : 'lose');

  const me = snap.survivors.find((s) => s.id === localId);
  const kills = me ? ` You bonked ${me.kills} zombie${me.kills === 1 ? '' : 's'}.` : '';
  let text: string;
  if (won) {
    const who = snap.survivors.length > 1 ? `${snap.rescued} of ${snap.survivors.length} pandas made it` : 'You made it';
    text = `${who} in ${formatTime(MATCH_TIME - snap.timeLeft)}.${kills}`;
  } else {
    text = (snap.timeLeft <= 0 ? "Time's up! The rescue hut left without you." : 'The zombies got everyone…') + kills;
  }
  hud.showEnd(won, text, mode);
}

function setPaused(on: boolean): void {
  if (!session || session.isOver) return;
  session.paused = on;
  hud.setPaused(on, session.canPause);
  input.setEnabled(!on);
}

function leaveToMenu(message = ''): void {
  netToken++;
  clearSession();
  host?.close();
  host = null;
  client?.close();
  client = null;
  input.setEnabled(false);
  hud.hide();
  lobby.hide();
  releaseWakeLock();
  showMenuMap();
  menu.show(message);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && session?.canPause) setPaused(true);
});

// ------------------------------------------------------------------ multiplayer

function showRoom(): void {
  if (host) {
    lobby.showRoom({ code: host.code, players: host.players, bots: host.bots, mapPick: host.mapPick, isHost: true, myId: 'p1' });
  } else if (client) {
    lobby.showRoom({ code: client.code, players: client.players, bots: client.bots, mapPick: client.mapPick, isHost: false, myId: client.myId });
  }
}

async function createRoom(): Promise<void> {
  const token = ++netToken;
  lobby.showBusy('Creating room…');
  try {
    const h = await NetHost.create(profile(), settings.map);
    if (token !== netToken) {
      h.close();
      return;
    }
    host = h;
    h.onChange = () => {
      if (!session) showRoom();
    };
    h.onPlayerLeft = (id) => {
      if (session instanceof LocalGame) session.convertToBot(id);
      const name = h.players.find((p) => p.id === id)?.name ?? 'A player';
      hud.flash(`${name} left. A bot takes over their panda.`);
    };
    showRoom();
  } catch (err) {
    if (token === netToken) lobby.showChoose(errorText(err));
  }
}

async function joinRoom(code: string): Promise<void> {
  enterFullscreenLandscape();
  ensureTiltPermission();
  const token = ++netToken;
  lobby.showBusy(`Joining room ${code}…`);
  try {
    const c = await NetClient.join(code, profile());
    if (token !== netToken) {
      c.close();
      return;
    }
    client = c;
    c.onLobby = () => {
      if (session) {
        // The host went back to the lobby after a match.
        clearSession();
        hud.hide();
        input.setEnabled(false);
        renderer.setShowcase(settings.variant, settings.weapon);
      }
      showRoom();
    };
    c.onStart = (specs, mapRef) => {
      mode = 'guest';
      localId = c.myId;
      // Same protocol version means the same maps, so this fallback should never be needed.
      const ref = isMapRef(mapRef) ? mapRef : refOf(DEFAULT_MAP);
      enterGame(ref, () => new RemoteGame(ctx, specs, c.myId, onGameEnd, c));
    };
    c.onSnapshot = (snap) => {
      if (session instanceof RemoteGame) session.receive(snap);
    };
    c.onClosed = (reason) => leaveToMenu(reason);
    showRoom();
  } catch (err) {
    if (token === netToken) lobby.showChoose(errorText(err));
  }
}

async function hostStart(): Promise<void> {
  const h = host;
  if (!h) return;
  enterFullscreenLandscape();
  ensureTiltPermission();
  unlockAudio();
  await physicsReady;
  if (host !== h) return;
  const specs: PlayerSpec[] = [...h.players.map((p) => ({ ...p, bot: false })), ...botSpecs(h.bots)];
  mode = 'host';
  localId = 'p1';
  const mapRef = resolvePick(h.mapPick);
  h.start(specs, mapRef);
  enterGame(mapRef, () => new LocalGame(ctx, specs, localId, onGameEnd, h));
}

function hostBackToLobby(): void {
  clearSession();
  hud.hide();
  input.setEnabled(false);
  renderer.setShowcase(settings.variant, settings.weapon);
  host?.backToLobby();
  showRoom();
}

// ------------------------------------------------------------------ main loop

let last = performance.now();
let fpsTime = 0;
let fpsFrames = 0;
let fps = 0;

function frame(now: number): void {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  fpsTime += dt;
  fpsFrames++;
  if (fpsTime >= 0.5) {
    fps = Math.round(fpsFrames / fpsTime);
    fpsTime = 0;
    fpsFrames = 0;
  }

  if (session) session.frame(dt, settings.showFps ? fps : null);
  else renderer.updateShowcase(dt);
  renderer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

document.getElementById('boot')?.remove();
