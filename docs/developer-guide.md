# Bamboo Bloodbath: developer guide

## 1. What it is

A landscape phone browser game. 1–4 panda survivors cross a map to a rescue hut while AI zombie pandas hunt them. Modes:
- **Quick play:** solo with 0–3 bots.
- **Multiplayer:** 2–4 phones, peer-to-peer.
- **Story:** 10 solo chapters with objectives.
- **Infinite:** an open world with base building and no end, solo, with bots or in multiplayer (section 8).

**Stack:** Vite + TypeScript, Three.js (rendering), Rapier (physics), PeerJS (WebRTC networking). It's deployed to GitHub Pages as an installable web app with offline support.

**Status:** most features from 21 Oct 2026 onward haven't been compiled yet, Infinite mode included (written 21 Oct, reviewed and fixed by 23 Oct). The first build will likely turn up errors.

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
  openSaves.ts     Infinite mode worlds in localStorage (one entry per slot)
  core/            math helpers, seeded RNG
  sim/             game rules, no DOM or Three.js
    Simulation.ts  the match: survivors, zombies, weapons, pickups, win/lose
    bots.ts        bot buddy AI
    weapons.ts     weapon stats, slot helpers
    maps/          hand-made layouts, Random Valley generator, story maps
    story/         chapters, Mission (objectives), Doc's AI
    open/          Infinite mode: contract (types, config), world generator, rules, hordes, bots, saves
    terrain, props, river, route, steering, physics, gameMap
  game/            sessions that run a match
    LocalGame.ts   simulation runs here (solo, story, multiplayer host)
    RemoteGame.ts  multiplayer guest: draws the host's snapshots
    Presenter.ts   turns game events into sounds, effects, HUD messages
  net/             PeerJS host/client, protocol, snapshot codec, invites, rejoin
  render/          Three.js scene: world, pandas, horde, pickups, effects
    open/          the streamed open world: chunks, pieces, build ghost, day and night
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
- **Downed:** at 0 HP. A teammate standing nearby revives them. After 10 s (`DOWNED.bleedTime`) they turn into a zombie that keeps their name. (Infinite mode: 30 s, then they respawn at their bed instead.)
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
- An Infinite mode match never ends; the players leave it (Save & quit / Leave world).

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

## 8. Infinite mode (`sim/open/`)

An open world with base building that never ends, played solo, with 0–3 bots, or in multiplayer. The design and the module contract are in [infinite-mode.md](infinite-mode.md); the shared types are in `sim/open/types.ts` and every tuning number, piece and recipe is in `sim/open/config.ts`.

**The world** is a `GameMap` like any other, built by `createOpenWorld(seed)` (`worldgen.ts`, with `worldLayout.ts`, `worldTerrain.ts`, `worldProps.ts`, `worldIndex.ts`, `biomes.ts`, `pois.ts`), plus `map.open: OpenWorldData`:
- a 1024 m square of seven blended biomes, rivers, ridges, hills and ponds
- abandoned buildings (POIs) made of ordinary pieces, mostly ruined, with supply crates
- resource nodes (trees, rocks, bamboo groves, scrap piles)
- a chunk index (`chunkContents`) and render-only decor per chunk (`chunkDecor`)

It's deterministic, so every device generates the same world from the seed, and multiplayer only sends `MapRef { id: OPEN_MAP_ID, seed }`. `game/maps.ts` builds and caches it like the other maps.

**How it plugs into the simulation** (the same way story mode plugs in `Mission`):
- `SimOptions.open` takes an `OpenRulesApi`: an `OpenRules` (`rules.ts`) made from the map and a `WorldSave`. Simulation calls it at fixed points: `init`, `preStep` / `postStep`, spawn points, speed (hunger) and leash, gathering on a swing that hit no zombie, bleed-out and respawn, snacks, zombies blocked by a piece, noise, zombie deaths, commands, snapshot, save and join.
- The rules call back through `OpenHost`, which `Simulation` implements: spawn and despawn zombies, add and remove piece bodies and steering obstacles, respawn a survivor, give a weapon, make noise, hurt a zombie.
- `OpenRules` owns the clock (`clock.ts`), hunger, packs and the stash (`economy.ts`), the pieces (`StructureStore` in `structures.ts`, which also holds the pure price and placement helpers the build UI shares), nodes, crates, bags and beds. The zombies are run by the horde director (`hordes.ts`): ambient zombies, roaming hordes (markers that turn into real zombies within 90 m of a panda and back beyond 150 m) and sieges. Bots get `createOpenBot(slot)` (`openBots.ts`); they fight, revive, eat, defend, gather and deposit, but never build.
- Player actions that aren't movement or fighting are `OpenCommand`s (place, upgrade, repair, demolish, craft). They go through `Session.command(cmd)` to `Simulation.command(id, cmd)`, and the rules check them and answer a refusal with a `deny` event.
- Some rules worth knowing:
  - Only the players' pieces count. A piece built by a player, or an abandoned building's piece that someone repaired or upgraded (which makes it theirs), can make up bases, lookouts and campfires, and only such beds can be claimed.
  - Bags are taken partially: what fits in the pack, and firecrackers up to the cap. The rest stays in the bag.
  - Footsteps only wake sleepers. Only louder noises (gathering, axes, firecrackers) reach the hordes.

**World events and `WorldMirror`.** Every change to the world goes out as an event in the snapshot: `piece`, `unpiece`, `node`, `crate`, `bag`, `unbag`. Each client keeps a `WorldMirror` (`mirror.ts`), built from a `WorldJoin` and updated with those events. That includes the host and solo: `LocalGame` builds it from `sim.joinWorld()` and applies each snapshot's events before presenting them. `RemoteGame` builds it from the `start` message's `open` and applies the events of every snapshot it receives, even one too late to draw. The renderer (`setOpenMirror`), the HUD (`setOpenMirror(m, guest)`), the minimap and `OpenHud` read the mirror, never the simulation. Per-tick state (clock, hunger, packs, stash, siege, visible hordes, leash) travels in `Snapshot.open: OpenSnap`. Other new events (`gather`, `built`, `smash`, `chomp`, `crafted`, `deny`, `deposit`, `respawn`, `siege`, `siegeOver`, `dawn`, `dusk`, `hungry`, `bed`) are handled by `Presenter`.

**Chunk streaming** (64 m chunks, 16 × 16):
- **Physics** (`physicsChunks.ts`): the static world only has the edge walls, bridges and ridge walls. Each chunk's terrain trimesh (2 m cells) and its tree and rock colliders load when a body is within one chunk of it (checked every 15 ticks, at most 2 outer-ring chunks per check). They unload 10 s after no body has been within 2 chunks. `ensure(x, z)` builds the ground right away before a body is spawned or teleported there.
- **Rendering** (`render/open/OpenWorldView.ts`): chunks within 110 m of the camera's focus are built, one per frame, nearest first (everything within 48 m at once on the first frame). They're dropped beyond 150 m. Bridges, fords, roads and the spawn camp are built once. Pieces, depleted nodes, opened crates and bags come from the mirror's `takeDirty()`. The sky blends the biome themes under the focus with a night palette (`sky.ts`). The nearest 4 campfires light up the night; their shader variants are compiled when the match starts, not at the first dusk.

**Saving** (only the device that runs the simulation saves):
- `openSaves.ts` keeps 3 slots (`OPEN.slots`) in localStorage under `bamboo-bloodbath:world-v1:<slot>`. A `WorldSave` is everything that isn't derived from the seed: the pieces, nodes and crates that changed, bags, stash, clock, hordes, next siege, players.
- `main.ts` (`saveOpenWorld`) saves every `OPEN.autosave` (60) s, on pause, when the page is hidden, on Save & quit and when the host leaves. On load, `sanitizeSave` cleans the save against its map; `newWorldSave` makes a fresh one.
- Players are keyed by nickname (a nickname that looks like a bot seat id is stored as `~b2`). That's why `nickname()` stores the fallback `PandaNNN` in the settings the first time: otherwise each page load would be a new player. Bot seats are keyed by id (`b1`…) under the bot's own name, even while a guest plays that panda (`keyOf` in `rules.ts`).
- A panda saved while downed comes back on their feet at their bed. A siege in progress isn't saved (see section 13).

**Multiplayer differences:**
- The host switches the room to `mode: 'open'` and picks a saved world (`NetHost.setMode` / `setWorld`; the lobby hides the map, bot and difficulty pickers, since the world decides those). Specs are the room's humans plus the world's bots, `MAX_PLAYERS` in all.
- **Drop-in:** a newcomer gets a panda of their own while there are fewer than 4 (`MatchSeats.addSeat` → `Simulation.addOpenSurvivor`, restored from the save by nickname). Otherwise they take over a bot's panda, or they're rejected with "This world is full." (already at `hello`). Their `start` message always has `you` and `open` (`MatchSeats.joinWorld()`).
- **Leaving** removes the guest's own panda from the world (`MatchSeats.removeSeat` → `Simulation.removeSurvivor` → `forgetSurvivor`, which keeps it for the save). A bot's panda they had taken over goes back to the bot. They're also taken off the room's list, so coming back counts as a fresh join.
- **Per-guest interest:** `NetHost.sendSnapshot` encodes once per guest, with only the zombies, javelins, firecrackers and cracker drops within 110 m (`INTEREST_RANGE`) of that guest's panda. All survivors always go in. Bamboo snack spots go as `bn` (only the spots in range, as signed 1-based indices), and `RemoteGame` merges them into the full list.
- **Leash:** with 2+ humans, nobody gets more than `OPEN.leash` (250 m) from the nearest other human (the move away from them is removed); the HUD warns from 220 m. Bots don't count.
- Solo can pause (the world stops); multiplayer can't.

**Tuning** is all in `sim/open/config.ts`:
- `OPEN`: world and chunk size, day length and night, bleed and respawn, hunger, pack size and reaches, repair and refund shares, gathering yields and regrowth, leash, zombie caps, ambient zombies, `hordes`, `siege`, piece bites, spikes, lookout range, campfire light, autosave.
- `PIECES` (prices, upgrades, HP per tier, what they block, height) and `RECIPES`.
- `DIFFICULTY` in `config.ts` still scales zombies and siege sizes.
- Renderer numbers are in `OpenWorldView.ts` (streaming distances, campfire light strength) and `sky.ts` (night palette). World generation densities are in `worldProps.ts`, `biomes.ts` and `pois.ts`.
- Changing the world generator changes every existing world, because node and crate ids shift. Bump `PROTOCOL_VERSION` and expect old saves to look odd.

**To add a building piece:**
1. Add it to `PieceKind` and `PIECE_KINDS` in `types.ts`. The palette and the `1`–`8` keys follow that order; a ninth piece needs `Digit9` in `InputManager.buildKey`.
2. Add a `PIECES` entry in `config.ts`.
3. Add it to `StructureStore.kinds` in `structures.ts`, and to `isLandmark()` if it should count towards bases or the threat director.
4. Add any behaviour to `rules.ts`.
5. Add its model to `render/open/pieces.ts` (`standingLook`, `RUBBLE_OF`, `RUBBLE_SCALE`) and its colour to `PIECE_FILL` in `ui/HudMap.ts`.
6. Bump `PROTOCOL_VERSION`.

**To add a recipe:**
1. Add it to `RecipeId` and `RECIPE_IDS` in `types.ts`.
2. Add a `RECIPES` entry with its station, cost and result (weapon, crackers, food or heal). The craft panel lists it on its own, and `rules.ts craft()` handles those four results.
3. If it needs a new kind of result, extend `RecipeDef`, `craft()` and `recipeBlocked()` in `economy.ts`.
4. Bump `PROTOCOL_VERSION` (`sanitizeCommand` checks recipe ids).

## 9. Multiplayer (`net/`)

**Topology:** the host's phone runs the simulation, and guests send inputs and draw snapshots. The public PeerJS server is only used to introduce the phones. The room code `K7QX` is the host's PeerJS id `bamboo-bloodbath-v1-K7QX`.

**Messages** (`protocol.ts`; bump `PROTOCOL_VERSION`, currently 8, whenever messages, maps, the open world's generator or the snapshot format change):
- Guest → host: `hello` (version, profile, seat ticket), `input` (5 numbers, flags as bits), `end` (the End match button), `cmd` (an Infinite mode `OpenCommand`, checked by `sanitizeCommand` and then by the rules).
- Host → guest:
  - `welcome`, `reject` (also "This world is full." right after `hello`)
  - `lobby` (players, bots, map, difficulty, `playing`, `mode` 'quick' / 'open', `world` name and day)
  - `start` (specs, `MapRef`, difficulty, `you` when joining mid-match; in Infinite mode `open`, the `WorldJoin`, and `world`)
  - `specs` (pandas changed hands, or joined / left an open world)
  - `snap` (compact snapshot from `codec.ts`, about 2–3 KB; in Infinite mode with `o`, the `OpenSnap`, and encoded per guest, see section 8)
  - `bye`

**`NetHost`** owns the lobby and the match. Mid-match it maps each player to the panda they control (`seats`), because a newcomer controls a bot's panda (e.g. `b2`), not one with their own id.
- **Rejoin:** each guest device keeps a random **seat ticket** per room (`rooms.ts`). A returning ticket gets its panda back, and a still-open old connection is replaced.
- **Drop-in:** a new player takes over a free bot buddy (`LocalGame.freeBotSeat`). If none is free, they wait in the room for the next match. (Infinite mode differs: see section 8.)
- When a guest leaves, a bot takes over their panda (Infinite mode: their panda leaves the world).

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

## 10. Rendering and audio

**`render/Renderer.ts`** owns the Three.js scene and camera:
- `setMap` builds the world mesh from a `GameMap` (`world.ts`); for the open world it makes a streaming `OpenWorldView` instead (section 8)
- `setOpenMirror` / `setGhost`: Infinite mode's world state and the build preview
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
- `open/`: the open world: `OpenWorldView.ts` (streaming, campfires, bags), `chunk.ts` and `terrainChunk.ts` (one chunk's ground, water, props and nodes), `pieces.ts` (building pieces, rubble, gates, the ghost), `sky.ts` (day and night), `assets.ts`, `bake.ts`, `context.ts` (shared geometry, materials and palettes).

Everything uses a toon look (`toon.ts`). Graphics quality defaults to low on touch devices.

**Audio:** `Sfx.ts` and `Music.ts` synthesise everything with WebAudio. On menus, `LobbyTrack.ts` streams `public/music/lobby.mp3` if present; otherwise the synth tune plays.

## 11. UI, input and saved data

**Screens** are plain DOM classes built with `el()` from `ui/dom.ts`:
- `Menu` (name, panda, weapon, modes), `QuickPlayMenu`, `Lobby`, `StoryMenu`, `InfiniteMenu` (save slots, new world, Play / Host / Delete)
- modals: `SettingsPanel`, `HowToPlay`, `RecordsCard`, the `InstallPrompt` card
- `Hud` (in game: health, ammo, team, timer, pause and end screens)
- `OpenHud` (Infinite mode: day chip, hunger, pack and stash, siege, leash and respawn warnings, build mode, craft panel). Its public surface: `start` / `stop` / `update`, `building`, `key(k)` for the build keys, `deny(why)` (false when the same refusal is already showing, so the caller skips its buzz) and `gained(r, n)` for the "+2" floaters. `Presenter` reaches it through `PresentContext.openHud`.

All of them use `data-act` / `data-ref` attributes for clicks and lookups. Long screens use `scrollHint()` so nothing silently cuts off.

**Layout constraint:** nothing should need scrolling at about 360 CSS px tall (a 1080×2400 phone in landscape). Check this whenever you add to the menus.

**Input:** `InputManager` merges three touch schemes (joystick, tilt, tap & swipe) with keyboard and gamepad into one `PlayerInput` per tick. One-shot presses are consumed on `sample()`. The on-screen buttons (attack, dash, firecracker, switch weapon) live in its touch layer.
- Infinite mode: `setBuildMode(on)` hides the fight buttons and stops `sample()` reporting attacks, firecrackers and switches.
- `onBuildKey` sends the build keys to `OpenHud.key`. B, F and 1–8 always work; R, Space / Enter and X / Delete only while building, where they'd otherwise switch weapons or attack.
- There are no gamepad build controls.

**Saved on the device** (localStorage, all wrapped in try/catch):
- settings
- story progress
- records: per map × difficulty × bot count, quick play and multiplayer only
- own room code and the rejoin ticket
- Infinite mode worlds, 3 slots (`openSaves.ts`, see section 8)

## 12. Tuning and extending

**Balance** lives in `config.ts`: survivor and zombie stats, `DIFFICULTY`, horde sizes, `MATCH_TIME`, `NOISE`, `SLEEP`, `CRACKER`, `JAVELIN`, `PICKUP`, `CAMERA`, network rates. Melee weapon stats are in `sim/weapons.ts`. Infinite mode's tuning, pieces and recipes are in `sim/open/config.ts` (section 8).

**Checklist for a change:**
- **Changes what's sent between phones** (input, snapshot fields, messages, maps, the open world's generator, pieces or recipes): bump `PROTOCOL_VERSION` and update `codec.ts` / `protocol.ts` on both sides.
- **A new input:** add it to `PlayerInput` and `NO_INPUT`, the bot and Doc brains' output, `InputManager.sample()`, `encodeInput` / `decodeInput`, the one-shot handling in `NetHost.inputFor` and in `RemoteGame`, plus the How to play card and the README.
- **A new event:** add it to `GameEvent`, then handle it in `Presenter`. If it changes the open world, it must also go into `WorldMirror.apply` (and into `WorldJoin`, so a guest joining later gets the change).
- **A new `OpenSnap` field:** `encodeOpen` / `decodeOpen` in `codec.ts`.
- **A new `OpenCommand`:** the type in `types.ts`, `sanitizeCommand` in `protocol.ts`, `OpenRules.run`, and a button / key in `OpenHud` (plus `InputManager.buildKey` and How to play for a key).
- **A new field in `WorldSave` / `PlayerSave`:** fill it in `newWorldSave` and `OpenRules.save` / `playerSave`, and give old saves a default in `sanitizeSave`. Saves stay `v: 1` until a change can't be defaulted.
- **A new piece or recipe:** see section 8.

## 13. Known open issues

- **Gameplay:**
  - zombies sometimes pick the wrong crossing
  - the Snowy Pass route runs into cliffs
  - zombie lunges can end up in water
  - iOS audio can stay muted after an interruption
- **Infinite mode:**
  - Intact beds and storage chests in abandoned buildings can't be claimed or used for bases. Only damaged ones can, by repairing them. This is an open design question: keep it (demolish and rebuild) or add a "Claim" action.
  - Saving during a siege drops that siege instead of resuming it.
  - Bots have no pathfinding. They push through a gate when stuck, but a walled base with no gate can trap them.
  - Host and guests each generate the world. A tiny maths difference between browsers could, very rarely, shift a node or crate id.
  - Autosave turns the whole world into one JSON string every 60 s, which may hitch on a phone. Generating a world takes about 1 s and 6–7 MB (estimated), plus about 65k terrain samples for the minimap picture.
  - There are no gamepad build controls.
  - Guesses that need play-testing: night light strength, horde and siege sizes, hunger rate, node yields, world generation densities.
- **Multiplayer:** see the limits in section 9.
- **Untested:** almost everything from 21 Oct onward:
  - story chapters 6–10, the escort and activate objectives
  - the menu split, rocks and terrain, End match, records
  - the install and fullscreen buttons, invites, rejoin and drop-in, the weapon slots
  - all of Infinite mode, which has never been compiled. That covers world generation and its speed on a phone, both kinds of chunk streaming, building on touch, saving and continuing, sieges, bots in the open world, hosting a world with guests dropping in and out, per-guest interest, the leash, and whether the menus fit at 360 px tall (the Solo row is tight).

  All of these need a first build and play-testing on phones.
