import './style.css';
import { Sfx } from './audio/Sfx';
import { DIFFICULTY, MATCH_TIME, type Difficulty } from './config';
import { LocalGame } from './game/LocalGame';
import { cyclePick, hutDirection, isMapRef, isValidPick, loadMap, previewMap, resolvePick } from './game/maps';
import { RemoteGame } from './game/RemoteGame';
import type { GameContext, Session } from './game/Session';
import { InputManager, requestTiltPermission } from './input/InputManager';
import { NetClient } from './net/NetClient';
import { NetHost } from './net/NetHost';
import type { LobbyPlayer } from './net/protocol';
import { Renderer } from './render/Renderer';
import { addResult } from './records';
import { loadSettings, saveSettings } from './settings';
import { botName } from './sim/bots';
import type { MapRef } from './sim/mapLayout';
import { DEFAULT_MAP, refOf } from './sim/maps';
import { initPhysics } from './sim/physics';
import { CHAPTERS } from './sim/story/chapters';
import { chapterOptions, DOC_SPEC, hasDoc } from './sim/story/Mission';
import type { Card } from './sim/story/types';
import { PANDA_VARIANTS, WEAPON_TYPES, type PlayerSpec, type Snapshot } from './sim/types';
import { completeChapter, loadProgress } from './storyProgress';
import { el, formatTime } from './ui/dom';
import { HowToPlay } from './ui/HowToPlay';
import { Hud, type EndMode } from './ui/Hud';
import { Lobby } from './ui/Lobby';
import { Menu } from './ui/Menu';
import { SettingsPanel, type SettingKey } from './ui/SettingsPanel';
import { StoryCards } from './ui/StoryCards';
import { StoryHud } from './ui/StoryHud';
import { StoryMenu } from './ui/StoryMenu';

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
const progress = loadProgress(CHAPTERS.length);
/** The quick-play match being played (solo, host or guest), for the records. */
let match: { mapId: string; difficulty: Difficulty } | null = null;
/** Story chapter being played, and where a retry starts (stage and the clock at that point). */
let run: { chapter: number; checkpoint: number; clock: number | null } | null = null;

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
const howToPlay = new HowToPlay(uiEl, settings);

const hud = new Hud(uiEl, {
  onPause: () => setPaused(true),
  onResume: () => setPaused(false),
  onSettings: () => settingsPanel.open(),
  onRestart: () => {
    if (mode === 'story' && run) void startChapter(run.chapter, 0, null);
    else void startSolo();
  },
  onLobby: () => hostBackToLobby(),
  onQuit: () => leaveToMenu(),
  onNext: () => continueStory(),
  onCheckpoint: () => {
    if (run) void startChapter(run.chapter, run.checkpoint, run.clock);
  },
  onChapters: () => openStory(run?.chapter),
});

const menu = new Menu(uiEl, settings, {
  onStory: () => {
    unlockAudio();
    openStory();
  },
  onPlaySolo: () => void startSolo(),
  onMultiplayer: () => {
    unlockAudio();
    menu.hide();
    lobby.showChoose();
  },
  onSettings: () => settingsPanel.open(),
  onHowTo: () => howToPlay.open(),
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
  onDifficulty: (difficulty) => {
    if (!host) return;
    settings.difficulty = difficulty;
    saveSettings(settings);
    host.setDifficulty(difficulty);
  },
  onLeave: () => leaveToMenu(),
});

const storyHud = new StoryHud(uiEl);
const storyMenu = new StoryMenu(uiEl, CHAPTERS, settings, {
  onPlay: (i) => beginChapter(i),
  onSelect: (i) => showChapterMap(i),
  onBack: () => {
    storyMenu.hide();
    showMenuMap();
    menu.show();
  },
  onChange: () => saveSettings(settings),
});
const cards = new StoryCards(uiEl);

const ctx: GameContext = { renderer, input, hud, sfx, settings, story: storyHud };

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
  storyHud.reset();
}

/** `intro`: what to flash at the start instead of the map name and tip (story chapters). */
function enterGame(mapRef: MapRef, create: () => Session, intro?: string): void {
  clearSession();
  renderer.clearShowcase();
  const map = loadMap(mapRef);
  renderer.setMap(map);
  hud.setRoute(map.route);
  menu.hide();
  lobby.hide();
  storyMenu.hide();
  hud.show();
  session = create();
  input.setEnabled(true);
  void requestWakeLock();
  if (intro) {
    hud.flash(intro, 3000);
    return;
  }
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
  const mapRef = resolvePick(settings.map);
  const difficulty = settings.difficulty;
  match = { mapId: mapRef.id, difficulty };
  enterGame(mapRef, () => new LocalGame(ctx, specs, localId, onGameEnd, null, { difficulty }));
}

function onGameEnd(snap: Snapshot): void {
  input.setEnabled(false);
  releaseWakeLock();
  const won = snap.phase === 'won';
  sfx.play(won ? 'win' : 'lose');

  const me = snap.survivors.find((s) => s.id === localId);
  const kills = me ? ` You bonked ${me.kills} zombie${me.kills === 1 ? '' : 's'}.` : '';
  const time = MATCH_TIME - snap.timeLeft;
  let text: string;
  if (won) {
    const who = snap.survivors.length > 1 ? `${snap.rescued} of ${snap.survivors.length} pandas made it` : 'You made it';
    text = `${who} in ${formatTime(time)}.${kills}`;
  } else {
    text = (snap.timeLeft <= 0 ? "Time's up! The rescue hut left without you." : 'The zombies got everyone…') + kills;
  }
  hud.showEnd(won, text, mode);

  if (!match) return;
  const res = addResult(match.mapId, match.difficulty, won, time, me?.kills ?? 0);
  const r = res.record;
  const news = [res.newBestTime && 'New best time!', res.newMostKills && 'New kill record!'].filter(Boolean).join(' ');
  const best = r.bestTime !== null ? `best ${formatTime(r.bestTime)} · ` : '';
  hud.showRecords(`${news ? `${news} ` : ''}${DIFFICULTY[match.difficulty].label}: ${best}won ${r.wins}/${r.plays} · most kills ${r.mostKills}`, !!news);
  match = null;
}

// ------------------------------------------------------------------ story mode

/** The chapter list (from the main menu, or after a chapter). */
function openStory(chapter?: number): void {
  clearSession();
  cards.cancel();
  run = null;
  input.setEnabled(false);
  hud.hide();
  releaseWakeLock();
  menu.hide();
  storyMenu.show(progress, chapter);
}

/** A chapter's map behind the story menu and cards, with your panda at the camp. */
function showChapterMap(i: number): void {
  renderer.setMap(loadMap(refOf(CHAPTERS[i].map)));
  renderer.setShowcase(settings.variant, settings.weapon);
}

/** Chapter picked in the list: its intro cards, then the chapter. Runs inside a tap. */
function beginChapter(i: number): void {
  enterFullscreenLandscape();
  ensureTiltPermission();
  unlockAudio();
  storyMenu.hide();
  showChapterMap(i);
  const ch = CHAPTERS[i];
  cards.play(ch.intro, ch.art, nickname(), () => void startChapter(i, 0, null));
}

/** Plays chapter `index` from stage `from` (0, or a checkpoint); `clock`: time left at that checkpoint. */
async function startChapter(index: number, from: number, clock: number | null): Promise<void> {
  enterFullscreenLandscape();
  ensureTiltPermission();
  unlockAudio();
  await physicsReady;
  const ch = CHAPTERS[index];
  mode = 'story';
  localId = 'p1';
  run = { chapter: index, checkpoint: from, clock };
  const bots = botSpecs(settings.bots);
  const specs: PlayerSpec[] = [
    { id: 'p1', name: nickname(), variant: settings.variant, weapon: settings.weapon, bot: false },
    ...bots,
    ...(hasDoc(ch) ? [DOC_SPEC] : []),
  ];
  const intro = from > 0 ? `Chapter ${index + 1}: back at the checkpoint` : `Chapter ${index + 1}: ${ch.title}`;
  const options = { ...chapterOptions(ch, from, clock), difficulty: settings.difficulty };
  enterGame(refOf(ch.map), () => new LocalGame(ctx, specs, localId, onStoryEnd, null, options), intro);
  storyHud.start(ch, nickname(), bots[0]?.name ?? null);
}

function onStoryEnd(snap: Snapshot): void {
  input.setEnabled(false);
  releaseWakeLock();
  const r = run;
  if (!r) return;
  const won = snap.phase === 'won';
  sfx.play(won ? 'win' : 'lose');
  const me = snap.survivors.find((s) => s.id === localId);
  const kills = me ? ` You bonked ${me.kills} zombie${me.kills === 1 ? '' : 's'}.` : '';

  if (won) {
    completeChapter(progress, r.chapter);
    const last = r.chapter === CHAPTERS.length - 1;
    hud.showEnd(true, (last ? 'The cure is brewing. You did it!' : `${CHAPTERS[r.chapter].title}: done!`) + kills, 'story', 'Chapter complete!');
    return;
  }

  const st = snap.story;
  if (st) {
    r.checkpoint = st.checkpoint;
    r.clock = st.checkpointTime >= 0 ? st.checkpointTime : null;
  }
  const reason =
    st?.fail === 'doc'
      ? 'Doc turned into a zombie. No Doc, no cure…'
      : st?.fail === 'time'
        ? 'Time’s up! The storm caught you.'
        : 'The zombies got you…';
  hud.showEnd(false, reason + kills, 'story', 'Game over', r.checkpoint > 0);
}

/** After a won chapter: its closing cards, then the next chapter's opening cards (one Skip skips both). */
function continueStory(): void {
  const r = run;
  if (!r) return;
  const ch = CHAPTERS[r.chapter];
  const next = r.chapter + 1;
  clearSession();
  hud.hide();
  input.setEnabled(false);
  const withArt = (list: readonly Card[], art: Card['art']): Card[] => list.map((c) => ({ art, ...c }));

  if (next < CHAPTERS.length) {
    const nextCh = CHAPTERS[next];
    showChapterMap(next);
    cards.play([...withArt(ch.outro, ch.art), ...withArt(nextCh.intro, nextCh.art)], nextCh.art, nickname(), () =>
      void startChapter(next, 0, null),
    );
  } else {
    renderer.setShowcase(settings.variant, settings.weapon);
    cards.play(ch.outro, ch.art, nickname(), () => openStory(r.chapter), 'Chapters');
  }
}

// ------------------------------------------------------------------ pause & leaving

function setPaused(on: boolean): void {
  if (!session || session.isOver) return;
  session.paused = on;
  hud.setPaused(on, session.canPause);
  input.setEnabled(!on);
}

function leaveToMenu(message = ''): void {
  netToken++;
  clearSession();
  cards.cancel();
  storyMenu.hide();
  run = null;
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
    const h = host;
    lobby.showRoom({ code: h.code, players: h.players, bots: h.bots, mapPick: h.mapPick, difficulty: h.difficulty, isHost: true, myId: 'p1' });
  } else if (client) {
    const c = client;
    lobby.showRoom({ code: c.code, players: c.players, bots: c.bots, mapPick: c.mapPick, difficulty: c.difficulty, isHost: false, myId: c.myId });
  }
}

async function createRoom(): Promise<void> {
  const token = ++netToken;
  lobby.showBusy('Creating room…');
  try {
    const h = await NetHost.create(profile(), settings.map, settings.difficulty);
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
    c.onStart = (specs, mapRef, difficulty) => {
      mode = 'guest';
      localId = c.myId;
      // Same protocol version means the same maps, so this fallback should never be needed.
      const ref = isMapRef(mapRef) ? mapRef : refOf(DEFAULT_MAP);
      match = { mapId: ref.id, difficulty };
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
  const difficulty = h.difficulty;
  h.start(specs, mapRef);
  match = { mapId: mapRef.id, difficulty };
  enterGame(mapRef, () => new LocalGame(ctx, specs, localId, onGameEnd, h, { difficulty }));
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

// ------------------------------------------------------------------ offline support

// Production only: in dev a saved copy would get in the way of hot reloading.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        // Everything this build loaded, so the worker can save it (and drop older builds' files).
        const urls = performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((u) => u.startsWith(location.origin) || /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u));
        reg.active?.postMessage({ t: 'warm', urls });
      })
      .catch((err) => console.warn('[offline] service worker not available', err));
  });
}
