# Bamboo Bloodbath: developer guide

## 1. What it is

A landscape phone browser game. 1–4 panda survivors cross a map to a rescue hut while AI zombie pandas hunt them. Modes:
- **Quick play:** solo with 0–3 bots.
- **Multiplayer:** 2–4 phones, peer-to-peer.
- **Story:** 10 solo chapters with objectives.

**Stack:** Vite + TypeScript, Three.js (rendering), Rapier (physics), PeerJS (WebRTC networking). It's deployed to GitHub Pages as an installable web app with offline support.

**Status:** most features from 21 Oct 2026 onward haven't been compiled yet. The first build will likely turn up errors.

## 2. Running and deploying

- `npm install`, then `npm run dev` (HTTPS with a self-signed certificate, so phones on the same Wi-Fi can connect), `npm run build`, `npm run typecheck`.
- Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.
- `public/sw.js` is the offline service worker, registered in production only:
  - the page is fetched network-first (falls back to the saved copy after 4 s)
  - hashed build files are served from the saved copy first
  - other files are served from the saved copy and refreshed in the background
- `public/manifest.webmanifest` makes it installable, fullscreen and landscape.
- Phone errors show in a red on-screen box (`showError` in `main.ts`).

## 3. Code layout

```
src/
  main.ts          app wiring: menus, sessions, multiplayer flow, main loop
  config.ts        all tuning numbers
  settings.ts      saved player settings
  records.ts       personal bests (quick play / multiplayer)
  storyProgress.ts unlocked chapters
  core/            math helpers, seeded RNG
  sim/             game rules, no DOM or Three.js
    Simulation.ts  the match: survivors, zombies, weapons, pickups, win/lose
    bots.ts        bot buddy AI
    weapons.ts     weapon stats, slot helpers
    maps/          hand-made layouts, Random Valley generator, story maps
    story/         chapters, Mission (objectives), Doc's AI
    terrain, props, river, route, steering, physics, gameMap
  game/            sessions that run a match
    LocalGame.ts   simulation runs here (solo, story, multiplayer host)
    RemoteGame.ts  multiplayer guest: draws the host's snapshots
    Presenter.ts   turns game events into sounds, effects, HUD messages
  net/             PeerJS host/client, protocol, snapshot codec, invites, rejoin
  render/          Three.js scene: world, pandas, horde, pickups, effects
  ui/              DOM screens and HUD (plain DOM, no framework)
  input/           touch, tilt, keyboard and gamepad → PlayerInput
  audio/           synthesised sound effects and music, menu music file
```

**The key boundary:** `sim/` knows nothing about the screen or the network. It takes inputs and produces snapshots, which is why the same simulation serves solo, story and multiplayer hosting.

## 4. How a match runs

**Each frame**, `main.ts` calls `session.frame(dt)`.

`LocalGame` (solo, story, multiplayer host):
- steps the simulation at a fixed 60 Hz (`SIM_DT`), collecting one input per survivor:
  - the local player's from `InputManager.sample()`
  - guests' from `NetHost.inputFor(id)`
  - bots compute their own inside the simulation
- after each step, takes a `Snapshot`, gives its events to the `Presenter`, and as host sends every third snapshot (`NET_SEND_EVERY`, ~20 Hz) to the guests
- renders by interpolating between the last two snapshots

`RemoteGame` (multiplayer guest):
- samples input every frame and sends it at 30 Hz, merging one-shot presses (dash, firecracker, switch) so none are lost between sends
- buffers incoming snapshots and renders slightly behind the newest (`NET_INTERP_TICKS`) so it can interpolate smoothly

**Data types** (in `sim/types.ts`):
- `PlayerInput`: move vector, aim vector, and the attack / dash / cracker / swap flags.
- `PlayerSpec`: id, name, look, starting weapon, `bot`, `npc`. Ids: `p1` is the local or host player, `p2`–`p4` are guests, `b1`–`b3` are bots, `doc` is the story character.
- `Snapshot`: everything needed to draw one tick, plus `events` (sounds, hits, messages since the previous snapshot).

## 5. The simulation (`sim/Simulation.ts`)

One instance per match: `new Simulation(map, specs, options)`, then `step(inputs)` and `snapshot()`.

**Survivors** have physics bodies, HP, a state (`active` / `downed` / `rescued` / `dead`), firecrackers and two weapon slots:
- **Slots:** `main` is the starting weapon and is never lost; `extra` is filled at racks. `weapon` is the one in hand. Switching has a 0.3 s draw time (`SWITCH_TIME`). When javelins run out, you switch automatically.
- **Downed:** at 0 HP. A teammate standing nearby revives them. After 10 s (`DOWNED.bleedTime`) they turn into a zombie that keeps their name.
- **Bots** are survivors with a `BotBrain`. `setBot(id, bot, name)` hands a panda to or from the AI; multiplayer uses it when guests leave, rejoin or drop in.

**Zombies:**
- States: walk, bite, lunge, stun, dying, sleep, wake.
- They chase the nearest visible survivor. Bamboo thickets hide you except up close.
- They can't swim: across rivers they route via bridges and fords (`via`).
- **Sleepers** sit along the route. Noise wakes them: dashing, splashing, axe swings, thuds, fast walking. A sneak attack on a sleeper does ×2.5 damage.
- **The horde size** follows `DIFFICULTY` and the player count. Zombies are recycled ahead of the group; starting sleepers are kept until the group has passed.

**Weapons** (`weapons.ts`, `JAVELIN` in `config.ts`):
- Knife: fast and quiet.
- Axe: one-hit kill, wide arc, loud.
- Javelin: thrown, one-hit kill, pierces into a second zombie, carved back every 8 s. With no javelins and no second weapon you slap (`PAW`).

**Pickups:**
- Bamboo snacks heal and grow back.
- Weapon racks give their weapon, then stand empty for 30 s.
- Thrown javelins can be picked up again.
- Zombies sometimes drop firecrackers. A thrown firecracker lures zombies for a few seconds, then bangs and stuns them.

**Ending:**
- Quick play is won when anyone reaches the hut and everyone else is done, and lost when the timer runs out (6:30) or everyone is gone.
- `endEarly()` backs the **End match** button: once every human is done, it stops waiting for bots.
- In story mode, the `Mission` decides.

**Difficulty** (Easy / Normal / Hard) scales horde size, zombie damage and speed, and how many sleep. It applies to every mode; in multiplayer the host picks it.

## 6. Maps (`sim/maps/`, `sim/mapLayout.ts`)

A map is a **`MapLayout`**: plain data with no code. It contains:
- size, start and goal circles, optional route waypoints
- hills, ponds (can be frozen), rivers with bridges and fords, ridges with passes, bamboo thickets
- story landmarks and roads
- rack weapons, prop density
- a full colour theme

`createGameMap(layout)` (`gameMap.ts`) builds the **`GameMap`**: terrain heights, water, ice, props (trees, rocks, racks, snacks, all placed from the layout's seed) and the route for the HUD arrow and bots. Props are always kept off bridges, fords and passes.

**Map ids:**
- `MAP_IDS` (`maps/index.ts`) lists the quick play maps: Valley, River Crossing, Snowy Pass, and Random Valley (id `generated`).
- A match is identified by a **`MapRef`** `{ id, seed }`. For Random Valley the seed drives `randomValley.ts`, so multiplayer only sends the ref, never the map.
- `game/maps.ts` wraps all this for the UI: the map picker's "random" choice, previews, and a small cache of built maps.

**Story maps** live in `sim/maps/story/` and are only reached through chapters.

**To add a quick play map:** write a layout file next to `valley.ts`, add it to `MAPS` in `maps/index.ts`, and bump `PROTOCOL_VERSION` (every phone must have the same maps).

## 7. Story mode (`sim/story/`)

`chapters.ts` holds all 10 chapters:
- Act 1 *Find the Cure*: chapters 1–5.
- Act 2 *New Threat*: chapters 6–10, against Professor Bristle.

A **`Chapter`** is data:
- its map layout, time limit (or none), horde rules, sleeper share, an optional Doc spawn
- story machinery (`devices`)
- intro and outro cards, and a list of **stages**

**Stage kinds:**
- `reach`: get to a point.
- `collect`: pick up items at spots.
- `hold`: stay in a circle while waves come.
- `activate`: several short holds at devices.
- `escort`: push a cart that only moves with a panda next to it and jams when a zombie is close.

Stages can carry dialogue lines (`say` / `done` / `cues`), a checkpoint, gates to open, and Doc's behaviour (wait or follow).

**`Mission.ts`** runs the stages inside the simulation through `SimOptions` and the `MissionHost` interface. It spawns waves, tracks progress, sets checkpoints and decides win or loss. It's also why `Simulation` has helpers like `addSurvivor`, `spawnHunter`, `addBlock` and `placeCart`.

**Doc** is an npc survivor driven by `docBrain.ts`; if she turns, the chapter is lost.

**Main flow** (`main.ts`): story cards → `startChapter(index, fromStage, clock)` → `onStoryEnd`. Retrying restarts from the last checkpoint with the clock as it was then. Story is solo only and never goes over the network.

**UI:** `StoryMenu` (chapter list), `StoryCards` (skippable cards with art from `storyArt.ts`), `StoryHud` (objective line and dialogue). Unlocks are saved by `storyProgress.ts`.

**To add a chapter:** add a map in `sim/maps/story/`, then append a `Chapter` to `CHAPTERS`. Item and device coordinates were placed by hand without test runs, so check them in game.

## 8. Multiplayer (`net/`)

**Topology:** the host's phone runs the simulation, and guests send inputs and draw snapshots. The public PeerJS server is only used to introduce the phones. The room code `K7QX` is the host's PeerJS id `bamboo-bloodbath-v1-K7QX`.

**Messages** (`protocol.ts`; bump `PROTOCOL_VERSION`, currently 7, whenever messages, maps or the snapshot format change):
- Guest → host: `hello` (version, profile, seat ticket), `input` (5 numbers, flags as bits), `end` (the End match button).
- Host → guest: `welcome`, `reject`, `lobby` (players, bots, map, difficulty, `playing`), `start` (specs, `MapRef`, difficulty, `you` when joining mid-match), `specs` (pandas changed hands), `snap` (compact snapshot from `codec.ts`, about 2–3 KB), `bye`.

**`NetHost`** owns the lobby and the match. Mid-match it maps each player to the panda they control (`seats`), because a newcomer controls a bot's panda (e.g. `b2`), not one with their own id.
- **Rejoin:** each guest device keeps a random **seat ticket** per room (`rooms.ts`). A returning ticket gets its panda back, and a still-open old connection is replaced.
- **Drop-in:** a new player takes over a free bot buddy (`LocalGame.freeBotSeat`). If none is free, they wait in the room for the next match.
- When a guest leaves, a bot takes over their panda.

**`NetClient`** is the guest side.
- `main.ts` (`useClient`, `reconnect`): if the connection drops mid-match, it retries for 45 s.
- After that, or after a reload, the menu offers **Rejoin CODE** for 15 minutes.

**Invites:**
- each device has a permanent room code (`ownRoomCode`)
- the lobby has Copy / Share / QR buttons
- `?room=CODE` links open the menu with a **Join CODE** button (`invite.ts`, `qr.ts` using `qrcode-generator`)

**Limits:**
- If the host leaves or backgrounds the app, the match freezes or ends; there's no host hand-over.
- Neither side notices a silently dead connection.
- Snapshots go over a reliable, ordered channel, so a lost packet delays the following ones.
- Strict mobile networks depend on public relay servers.

## 9. Rendering and audio

**`render/Renderer.ts`** owns the Three.js scene and camera:
- `setMap` builds the world mesh from a `GameMap` (`world.ts`)
- `setPlayers` / `updateSpecs` create panda models and name tags
- `updateGame` draws two snapshots blended
- the menu "showcase" is the drag-to-spin panda at the camp

Supporting files:
- `pandaModel.ts`: procedural pandas with variants and zombie tint.
- `weaponModels.ts`: shared geometry per weapon.
- `horde.ts`: instanced zombies.
- `pickups.ts`: snacks, racks, javelins, firecrackers.
- `effects.ts`: particles and screen shake.
- `storyView.ts` / `storyBuildings.ts`: landmarks, carts, devices.
- `minimap.ts`: the map picker preview.

Everything uses a toon look (`toon.ts`). Graphics quality defaults to low on touch devices.

**Audio:** `Sfx.ts` and `Music.ts` synthesise everything with WebAudio. On menus, `LobbyTrack.ts` streams `public/music/lobby.mp3` if present; otherwise the synth tune plays.

## 10. UI, input and saved data

**Screens** are plain DOM classes built with `el()` from `ui/dom.ts`:
- `Menu` (name, panda, weapon, modes), `QuickPlayMenu`, `Lobby`, `StoryMenu`
- modals: `SettingsPanel`, `HowToPlay`, `RecordsCard`, the `InstallPrompt` card
- `Hud` (in game: health, ammo, team, timer, pause and end screens)

All of them use `data-act` / `data-ref` attributes for clicks and lookups. Long screens use `scrollHint()` so nothing silently cuts off.

**Layout constraint:** nothing should need scrolling at about 360 CSS px tall (a 1080×2400 phone in landscape). Check this whenever you add to the menus.

**Input:** `InputManager` merges three touch schemes (joystick, tilt, tap & swipe) with keyboard and gamepad into one `PlayerInput` per tick. One-shot presses are consumed on `sample()`. The on-screen buttons (attack, dash, firecracker, switch weapon) live in its touch layer.

**Saved on the device** (localStorage, all wrapped in try/catch):
- settings
- story progress
- records: per map × difficulty × bot count, quick play and multiplayer only
- own room code and the rejoin ticket

## 11. Tuning and extending

**Balance** lives in `config.ts`: survivor and zombie stats, `DIFFICULTY`, horde sizes, `MATCH_TIME`, `NOISE`, `SLEEP`, `CRACKER`, `JAVELIN`, `PICKUP`, `CAMERA`, network rates. Melee weapon stats are in `sim/weapons.ts`.

**Checklist for a change:**
- **Changes what's sent between phones** (input, snapshot fields, messages, maps): bump `PROTOCOL_VERSION` and update `codec.ts` / `protocol.ts` on both sides.
- **A new input:** add it to `PlayerInput` and `NO_INPUT`, the bot and Doc brains' output, `InputManager.sample()`, `encodeInput` / `decodeInput`, the one-shot handling in `NetHost.inputFor` and in `RemoteGame`, plus the How to play card and the README.
- **A new event:** add it to `GameEvent`, then handle it in `Presenter`.

## 12. Known open issues

- **Gameplay:**
  - zombies sometimes pick the wrong crossing
  - the Snowy Pass route runs into cliffs
  - zombie lunges can end up in water
  - iOS audio can stay muted after an interruption
- **Multiplayer:** see the limits in section 8.
- **Untested:** almost everything from 21 Oct onward. Story chapters 6–10, the escort and activate objectives, the menu split, rocks and terrain, End match, records, the install and fullscreen buttons, invites, rejoin and drop-in, and the weapon slots all need a first build and play-testing on phones.
