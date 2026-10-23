# Infinite mode: design and build contract

Infinite mode is an open-world, base-building survival mode. It can be played solo, with 0–3 bot buddies, or in
multiplayer (2–4 phones, the host runs the world). This document is the contract between the modules. The shared
types are in `src/sim/open/types.ts`, the tuning numbers and piece/recipe tables in `src/sim/open/config.ts`.
Treat both as fixed: you may *add* to them if you really must, but never rename or remove anything.

## Status (23 Oct 2026)

All seven modules are written. Four reviews checked them: compile and contract, flows and networking, gameplay
logic, and rendering / UI / phone performance. Two fix rounds followed. **Nothing has been compiled or run yet.**
This document has been brought in line with the final code: where the code differs from the first draft of the
contract, the text below says what the code does. What was fixed and what comes next is in
[infinite-mode-handoff.md](infinite-mode-handoff.md); how it all fits into the rest of the game is in section 8 of
the [developer guide](developer-guide.md).

Ground rules for everyone writing this code:
- Nothing gets compiled or run (no npm, no tsc, no git). Read the code you call and match signatures exactly.
- Match the surrounding style: small classes, doc comments in the same tone, `el()` + `data-act` / `data-ref`
  for DOM, `r1`/`r2` rounding for anything sent over the network, try/catch around storage.
- Target: a mid-range phone. No per-frame allocation in hot loops where avoidable; stream, don't build everything.
- `sim/` never imports DOM or Three.js.

## 1. The game

**Start.** The Infinite menu lists 3 save slots (`OPEN.slots`). An empty slot offers "New world" (name, optional
seed, difficulty, 0–3 bots). A saved slot offers Play (solo), Host (multiplayer room playing this world), and Delete
(with an in-page confirmation). Every world is a 1024 m square (`OPEN.worldSize`) generated from its seed.

**World.** Seven biomes blend smoothly into each other: meadow (the spawn camp is here), bamboo forest (dense hiding
thickets, bamboo groves), pine forest, snowy highlands (frozen ponds, snowfall, pines with snow caps), fen (ponds,
lilies, misty), quarry (rocks and boulders, scrap piles, ridges with passes), farmland (open fields, barns). Rivers
with bridges and fords, ridges with passes, hills and ponds come from the same layout features the normal maps use.
About 25–40 abandoned buildings (POIs: cabin, barn, farmhouse, watchtower, outpost, shed, chapel) are spread around.
They're made of ordinary building pieces, mostly ruined or damaged, plus 1–3 supply crates each.

**Day and night.** `OPEN.dayLength` = 20 minutes. Time of day 0..1, 0 = dawn; night runs `nightStart..nightEnd`.
At night more lone zombies are about, hordes move faster, and the renderer darkens the world (campfires glow).

**Resources.** Bamboo, wood, stone, scrap. You gather by attacking a resource node with no zombie in reach:
- trees give wood
- rocks give stone
- bamboo groves give bamboo
- scrap piles (quarry, farmland, near buildings) give scrap

`OPEN.gatherPerHit` per swing, ×`gatherBonus` with the right tool (`OPEN.goodTool`). Gathering is loud
(`gatherNoise`). Nodes run out and regrow after `nodeRegrow`. Crates give scrap, food, firecrackers, sometimes a
weapon; what doesn't fit in the pack (or past the firecracker cap) is left in a bag at the crate.

**Carrying and the stash.** Each panda carries a backpack (`packMax` units in total). Walking within `depositRadius`
of a storage chest empties the pack into the team stash. Building and crafting use your pack first, then the stash
when a storage chest is within `stashReach` of you. When you die, your pack is dropped as a loot bag where you fell;
anyone can pick it up. Bags are taken partially: walking over one takes what fits in your pack, and firecrackers up
to the cap; the rest stays in the bag (a 'bag' event updates it). With nothing fitting, "Your pack is full" shows
at most every 2 s.

**Hunger.** 0..100, drains `hungerDrain`/s. Below `hungryAt` you're slower (`slowWhenHungry`) and the HUD nags. At 0
you lose `starveDamage` HP/s down to `starveFloor`, never lower. Bamboo snacks (the existing snack spots) heal and
fill `bambooFood`. Bamboo stew (campfire) fills 60.

**Building.** It's a 2 m grid (`OPEN.tile`), one piece per tile. Pieces and prices are in `PIECES`:
- **wall:** upgrades bamboo → wood → stone
- **gate:** upgrades like walls; pandas pass through, zombies don't
- **spikes:** hurt zombies on the tile, wear out
- **campfire:** cooking, light
- **workbench:** crafting
- **bed:** your respawn point; walking within 1.6 m claims it. A bed another panda has claimed stays theirs (a player may take a bot's), and bots only claim beds at the main base.
- **storage:** the team stash
- **lookout:** reveals hordes within `lookoutRange` on the map and adds `siege.lookoutWarn` seconds of warning

**Only the players' pieces count.** A piece is the players' when a player built it, or when someone repaired or
upgraded an abandoned building's piece. Repairing or upgrading a world piece (owner '') makes it the repairer's.
Only these pieces make up bases (beds and storage), lookouts and campfires for the threats, and only such beds can
be claimed (`isPlayers` in `structures.ts`). So an intact bed or chest in an abandoned building does nothing until
it's demolished and rebuilt, or until it gets damaged and someone repairs it. Whether to add a "Claim" action
instead is an open question (see the handoff).

Rules for building:
- **Placing** requires: the tile is free, dry, not on a ridge wall or a steep slope (>0.9 m height difference across the tile), not on a tree / rock / node / crate / POI clearing edge… The tile may be inside a POI. No panda or zombie may stand on it (sim only). It must be within `buildReach`, and you must be able to pay.
- **Repairing** a damaged or ruined piece costs `repairShare` of everything it's worth up to its tier, scaled by the damage. Ruined pieces cost the full share. Repair costs round up and refunds round down, so repairing and demolishing never makes a profit.
- **Demolishing** returns `refundShare` of the price (rubble returns nothing), but only for pieces you or the world own; anyone may demolish ruins. A demolished bed is cleared from whoever had it.
- Pieces lose HP to zombie bites (`ZOMBIE.biteDamage × OPEN.pieceBite`). At 0 HP a piece becomes rubble (`ruined`): passable and inert until repaired.

**Crafting** (`RECIPES`): you stand within `craftReach` of a workbench or campfire. A crafted weapon goes into your
extra slot like a weapon rack. Firecrackers are capped at `CRACKER.max`. Bandages heal right away.

**Zombies.**
- *Lone (ambient) zombies* wander near the pandas: `ambient.day`/`night` + `perPlayer` per panda, about half asleep. They spawn `spawnMin..spawnMax` m away out of sight, never in a base, and never within `campfireLight` of a players' campfire at night (`Threats.campfires()` in the rules, an extra beyond `ThreatContext`). They despawn beyond `ambient.despawn`.
- *Roaming hordes* are abstract markers, `hordes.count` + `perDay`·(day-1), at most `max`, each with `sizeMin..sizeMax` zombies, drifting over the world. They head for loud noises they hear (`hearRange` × radius / `gatherNoise`). Footsteps and groans only wake sleepers and never reach the hordes, and hordes ignore any noise with a radius under 8 m. A horde becomes real zombies (goal = its marker, which keeps moving) when a panda is within `materialize`, and goes back to being a marker (count = survivors) when every panda is beyond `dematerialize`.
- *Sieges* come at random times of day: the first between `firstMin..firstMax` days, then every `gapMin..gapMax` days.
  1. A warning event comes `warn` seconds ahead, plus `lookoutWarn` with a lookout standing.
  2. **Target:** the biggest base (cluster of beds + storage) if any panda is within `baseRange` of it, otherwise the nearest group of pandas.
  3. **Size:** (base + perDay·day + perPlayer·players) × difficulty horde, capped at `max`. Zombies arrive in waves within `zombiesMax` real zombies.
  4. Siege zombies hunt a bit further (sense ×1.5) and bite pieces in their way.
  5. The siege is over when all its zombies are dead (`siegeOver` won) or after `giveUp` seconds. Killing siege zombies drops scrap (`scrapChance`), into a world bag already lying within 3 m if there is one. A zombie that falls out of the world counts neither as a kill nor for scrap. Only zombies that aren't dying count against `zombiesMax`.
  6. The 'siege' event's (x, z) is where the horde comes from, not where it arrives.

**Death.** Downed pandas bleed `OPEN.bleedTime` (30 s); a friend can revive them normally meanwhile (DOWNED.reviveTime).
When it runs out (or `aloneBleedTime` if nobody else is standing), the panda **respawns at their bed** (else the
world camp). They come back with `respawnHp` and `respawnHunger`, and their pack is dropped as a bag. Nobody ever
turns into a zombie in this mode, and the world never ends.

**Multiplayer.**
- **Leash:** a human can't get further than `OPEN.leash` from the nearest other human; the HUD warns from `leashWarn`. The movement component away from them is removed. It only applies with 2+ humans, and bots don't count.
- **Joining:** guests join the host's world any time (drop-in). A newcomer gets a new panda while there are fewer than 4, else takes over a bot, else is refused ("This world is full", sent right after `hello`; the guest then goes back to the menu instead of retrying).
- **Leaving:** a guest's own panda leaves the world with them. Their state is kept in the save under their nickname, and they get it back when they come again. A bot's panda they had taken over goes back to the bot. Players without a nickname get the session's `PandaNNN` stored as their nickname before they play, host or join, so they're recognised next time.
- **Saving:** only the host saves (autosave every `OPEN.autosave` s, on pause, on "Save & quit", and when the page is hidden).

**Score.** Days survived (best day kept in the save); kills.

## 2. Architecture

The open world is a `GameMap` like any other, plus `map.open: OpenWorldData`. The match runs in the same `Simulation`
with `SimOptions.open: OpenRulesApi` (an `OpenRules` instance), the same way story mode plugs in `Mission`.
Simulation calls the rules at fixed points; the rules call back through `OpenHost` (implemented by Simulation).

World changes reach every client as events in the snapshot stream:
- `piece` / `unpiece`
- `node`
- `crate`
- `bag` / `unbag`

Each client (including the host and solo) keeps a `WorldMirror` built from a `WorldJoin` and updated with those
events; the renderer and HUD read the mirror, never the simulation. Per-tick state (clock, hunger, packs, siege,
visible hordes) is in `Snapshot.open: OpenSnap`.

```
WorldSave ──► OpenRules (sim/open/rules.ts) ◄──► Simulation (OpenHost)
                │ join() ─► WorldJoin ─► WorldMirror (every client) ─► Renderer, OpenHud, HudMap
                │ snapshot() ─► Snapshot.open ─► HUD
                └ events (piece/node/crate/bag…) ─► Snapshot.events ─► WorldMirror.apply, Presenter
```

## 3. Modules, owners and their APIs

Each file has exactly one owner (the builder named in brackets). Don't edit files you don't own: if you need
something from another module, rely on the API written here. If the API here is missing something you need, make
the smallest reasonable assumption, write it down in your final report, and the reviewers will reconcile it.

### 3.1 World generation [worldgen]
Files: `src/sim/open/worldgen.ts`, `src/sim/open/worldTerrain.ts`, `src/sim/open/biomes.ts`, `src/sim/open/pois.ts`
(more files under `src/sim/open/world*.ts` / `biomes*.ts` / `pois*.ts` if useful).

- `export function createOpenWorld(seed: number): GameMap` in `worldgen.ts`. It's deterministic: same seed → same world on every device. It should build in under ~2.5 s on a phone, so precompute grids and bucket features spatially.
  - `layout`: a `MapLayout` with `id: OPEN_MAP_ID`, `size = renderSize = OPEN.worldSize`, `start` = `goal` = the spawn camp circle, `goalStyle: 'none'`, `racks: []`, the real `hills/ponds/rivers/ridges/thickets` lists, `landmarks: []`, optional `roads` (dirt tracks between POIs are welcome), `clear` circles for POIs, the meadow theme as `theme`, `density` (unused by render in open mode).
  - `terrain`: a `WorldTerrain` (extends `Terrain`, `worldTerrain.ts`) whose `heightAt`, `isWater`, `isWet`, `isIce`, `isWall`, `ridgeAmount`, `nearRiver`, `groundAt`, `bridgeAt`/`onBridge` read precomputed grids (e.g. heights at 1 m with bilinear filtering, flags at 1–2 m). Results must match the analytic `Terrain` closely. `crossings`, `bridges`, `fords`, `rivers`, `ridges` come from the base class (constructed from the layout) and are used by `detour()` and the renderer. Keep `peak()` meaningful. Height noise and the edge rise should feel like the normal maps, but bigger: hills up to ~10 m, valleys, a rim at the world edge.
  - `route`: `new Route(layout)` (a degenerate route; nothing in open mode relies on it).
  - `props`: `trees`, `rocks`, `stones`, `stalks` (thicket and grove stalks), `bambooSpots` (snacks, ~300–500), `racks: []` for the whole world; `grass`, `flowers`, `lilies` left EMPTY. Those come from `chunkDecor` on demand. Trees and rocks that are resource nodes are normal props too.
  - `grid`: `buildTerrainGrid(terrain, 8, 1)` (a placeholder; never used in open mode).
  - `open`: the `OpenWorldData`. Its contents:
    - biome functions
    - `pois`
    - `poiPieces` (ids 1..n, mostly `ruined: true` or damaged, `poi` set, owner ''), kept within each POI's footprint, aligned to the tile grid, with door gaps / gates; each building gets 1–2 beds, maybe a workbench, storage or campfire
    - `nodes`: every collidable tree (kind 'tree', prop = index), every rock with radius ≥ 0.6 ('rock'), bamboo groves ('grove': clumps of stalks with no collider, r ~1.2, render draws them from `stalks` in the chunk), scrap piles ('scrap', r ~1, near POIs and in quarry/farm)
    - `crates` (inside POIs)
    - chunk index
    - `chunkDecor`
- Spawn camp: in the meadow, near but not at the centre, flat, clear radius ~14 m, with a cabin POI within ~60 m.
- Biomes need distinct `MapTheme`s (`biomes.ts`). Reuse the colour palettes of the existing maps: valley for meadow, snowy pass for snow, Firefly Fen for fen, Quarry Road for quarry, Sprout Farm for farmland.

### 3.2 Rules: economy, building, saving [rules]
Files: `src/sim/open/rules.ts`, `structures.ts`, `economy.ts`, `mirror.ts`, `save.ts`, `clock.ts` (all in `src/sim/open/`).

- `export class OpenRules implements OpenRulesApi` in `rules.ts`:
  - `constructor(map: GameMap, save: WorldSave)`. `map.open` must be set, and the save's seed matches it.
  - It owns the per-survivor state (hunger, pack, bed, respawn timer) keyed by survivor id, the stash, the clock, the structure store, node / crate / bag state, and a `HordeDirectorApi` made with `createHordeDirector(...)` (§3.3).
  - It implements everything in `OpenRulesApi` exactly as documented in `types.ts` and §1, including:
    - `swing()`: gathering
    - `blockingPiece()`: the solid piece on the tile 0.6–1.3 m ahead in (dirX, dirZ), standing, blocking zombies (wall, gate, campfire, workbench, bed, storage, lookout)
    - `damagePiece()`: HP down → 'chomp', at 0 → ruined + 'smash' + `removePieceBody`; emit a 'piece' event when HP crosses a 10 % band
    - spikes in `preStep`
    - `wantsFood`/`ate`
    - leash
    - bleed / respawn
    - `save` / `join`
  - Survivors are keyed by `spec.id`. Saves use `keyOf(spec)`:
    - bot seats (`/^b\d+$/`, `isBotSeat` in `save.ts`) by id, even while a guest plays that panda. They're written with `bot: true` and the bot's own name, which `initSurvivor` remembers in the panda state (`botName`).
    - humans by `spec.name`. A nickname that looks like a seat id is stored as `~b2`, so it can't overwrite a bot's entry.
  - Bases, lookouts and campfires only count the players' pieces, and only such beds can be claimed (`isPlayers`: `poi < 0 || owner !== ''`). `upgrade` and `repair` set `owner` to the repairer's name when it was ''.
  - `Threats` also has `campfires()` (the players' standing campfires, cached in `StructureStore.refresh()`), which `hordes.ts` uses when it's there.
  - `onZombieDeath` always tells the director, but only counts a kill and rolls siege scrap when `z.hp <= 0` (not for a zombie that fell out of the world).
- `structures.ts`: the `StructureStore` (pieces by id, occupancy by tile, bodies via `OpenHost.addPieceBody`, obstacle circles r ~1.15 for standing solid pieces) and the pure helpers used by sim and UI alike:
  - `export function canPlace(map: GameMap, pieceAt: (gx: number, gz: number) => Piece | undefined, kind: PieceKind, gx: number, gz: number): string | null` returns null when OK, else a short reason ("Too steep", "In the water", "Something's in the way", "Tile taken").
  - `export function placeCost(kind: PieceKind): Cost`, `upgradeCost(p: Piece): Cost | null` (null at max tier / not upgradable), `repairCost(p: Piece): Cost | null` (null when at full HP), `maxHp(kind: PieceKind, tier: Tier): number`.
  - `export function canAfford(have: Resources, cost: Cost): boolean`.
- `economy.ts`: packs, stash, paying (pack first, then stash in reach), crafting, gathering yields, crates, bags, hunger.
- `clock.ts`: `export class WorldClock { constructor(clock: number); step(dt: number): void; readonly total: number (getter); readonly day: number; readonly time: number; readonly night: boolean }`. It emits 'dawn'/'dusk' via the rules.
- `mirror.ts`: `export class WorldMirror`:
  - `constructor(map: GameMap, join: WorldJoin)`
  - `readonly map`, `rev: number` (bumped on every change)
  - `readonly pieces: ReadonlyMap<number, Piece>`
  - `pieceAt(gx, gz): Piece | undefined`
  - `nodeLeft(id): number` (full = `world.nodes[id].amount`)
  - `crateOpen(id): boolean`
  - `readonly bags: ReadonlyMap<number, LootBag>`
  - `apply(events: readonly GameEvent[]): void` (handles piece, unpiece, node, crate, bag, unbag)
  - `takeDirty(): { pieces: Set<number>; nodes: Set<number>; crates: Set<number>; bags: boolean }`: chunk keys (`cz * chunks + cx`) touched since the last call, for the renderer. Only the renderer calls it.
  - `baseCenter(): { x: number; z: number } | null`: same clustering idea as the rules' bases, for the HUD arrow and the map.
- `save.ts`:
  - `export function newWorldSave(map: GameMap, slot: number, name: string, difficulty: Difficulty, bots: number, now: number): WorldSave`. `map` is `createOpenWorld(seed)` (the seed is `map.open.seed`); the pieces are a copy of `map.open.poiPieces`, the clock starts at `OPEN.startTime × dayLength`, the hordes are empty with `nextSiege` 0 (the director schedules it when `nextSiege` is 0).
  - `export function sanitizeSave(raw: WorldSave, map: GameMap): WorldSave` (clamps and drops nonsense).
  - `export function botSpecsFor(save: WorldSave): PlayerSpec[]` (bots 'b1'…'bN' with stable names / variants / weapons, from `save.players` when present, else generated from the seed).
  - `export function randomWorldSeed(): number`.

### 3.3 Threats and bots [threats]
Files: `src/sim/open/hordes.ts`, `src/sim/open/openBots.ts`.

- `export function createHordeDirector(seed: number, difficulty: Difficulty, saved: { hordes: HordeSave[]; nextSiege: number; sieges: number } | null, clock: number): HordeDirectorApi`. With `saved` null, or empty hordes, it sets up fresh hordes; with `nextSiege` 0 it schedules the first siege from `clock`. The rules always pass the save's values (a fresh save has empty hordes and nextSiege 0). It runs ambient zombies, roaming hordes (materialise / dematerialise, `Zombie.horde`, `Zombie.goal`), and sieges (schedule, warning event, target choice, waves, `Zombie.siege`, `siegeOver`, scrap drops via the rules?). It does *not* touch pieces: blocked zombies bite pieces through the simulation's normal loop.
  - Scrap drops: the director exposes nothing extra. Instead, `OpenRules.onZombieDeath` checks `z.siege` and rolls `siege.scrapChance` itself, dropping scrap into a bag at the spot (a `bag` with only scrap, owner '').
  - Hordes keep their own ids; `owns(z)` is true for zombies it spawned.
  - Everything is deterministic given its own `Rng` seeded from `seed` + clock, but determinism across devices isn't needed (only the host simulates).
- `export function createOpenBot(slot: number): Brain` in `openBots.ts`: a bot for open mode, using `BotWorld.open` (`OpenView`). Priorities:
  1. revive
  2. flee when low
  3. fight threats near itself or the leader
  4. eat when hungry (snack spots)
  5. during a siege, defend the base near the leader
  6. walk to its pack's storage when the pack is nearly full and the base is within 60 m
  7. gather the nearest node within 12 m of the leader when idle (wood first, then bamboo, stone)
  8. follow the leader

  Bots never place or repair pieces in v1: they can't send commands through `PlayerInput`. Gathered resources land in their own pack like a player's. Reuse `Walker`, `nearest` and the fighting behaviour from `bots.ts` (import, don't copy: if you need a piece of `BotBrain` that's private, compose a `BotBrain` inside and call its `think()` for the fighting / reviving / following parts, overriding the movement target when you have a better one).

### 3.4 Simulation integration [sim]
Files: `src/sim/Simulation.ts`, `src/sim/bots.ts`, `src/sim/steering.ts`, `src/sim/open/physicsChunks.ts`. `src/sim/entities.ts` already has the new zombie fields (`horde`, `siege`, `goal`, `piece`): initialise them in `spawnZombie`.

- `SimOptions.open?: OpenRulesApi`. When set:
  - The world is the open map: `buildStatic` builds the 4 edge walls, the bridges and the ridge walls (global). The terrain trimesh and tree/rock colliders are streamed by `PhysicsChunks` (`physicsChunks.ts`): for each 64 m chunk, a trimesh at ~2 m resolution plus the chunk's tree and rock colliders. A chunk is loaded when any body is within one chunk of it (checked every 15 ticks), and immediately (`ensure(x, z)`) before spawning or teleporting a body there. It's unloaded after 10 s with no body within 2 chunks. Tree/rock colliders must match the normal map's exactly.
  - Steering `Obstacles` hold all trees/rocks of the world (spatial hash, fine), and get `remove(c)` (same object reference) for pieces.
  - No `spawnInitialHorde`, no `updateSpawning`. `cleanupZombies` only removes finished deaths (and never recycles zombies; the director despawns its own via `despawnZombie`).
  - Survivors spawn at `open.spawnPoint(spec)` with `open.initSurvivor(s)` after placement; bots get `createOpenBot(slot)` instead of `BotBrain` (also in `setBot`).
  - `open.init(this)` once, after `buildStatic` and before survivors spawn. `open.preStep(this)` at the start of `step` (after the tick count); `open.postStep(this)` after pickups.
  - **Movement:** `controlSurvivor` multiplies speed by `open.speedMul(s)` and passes (mx, mz) through `open.leash(s, mx, mz)`.
  - **Gathering:** `melee()` counts hits; with no zombie hit it calls `open.swing(this, s, w.range, w.arc)`.
  - **Downed:** the bleed time comes from `open.bleedTime(s, someoneElseActive)`; when it runs out, call `open.bledOut(this, s)` instead of `turnIntoZombie`. The "alone" shortening uses the open value.
  - **Zombies:**
    - with no target and no lure but `z.goal`: walk to the goal at `ZOMBIE.speed × speedMul × 0.8` (siege: full speed), wander when within 3 m of it
    - before steering, when the zombie is moving purposefully (target or goal, not lunging, not via a crossing), `open.blockingPiece(z, dirX, dirZ)`: if a piece comes back, start a 'bite' with `z.piece = id`; at the bite moment call `open.damagePiece(this, id, ZOMBIE.biteDamage × zombieDamage × OPEN.pieceBite)` instead of hurting a survivor; clear `z.piece` after
    - `pickTarget` sense ×1.5 for siege zombies
    - `noise()` is public and also calls `open.onNoise(x, z, radius)`. Footsteps and groans go through the private `wake()` only, so walking never calls the hordes over.
    - `damageZombie` kills call `open.onZombieDeath(z)`
  - **Snacks:** bamboo snacks are eaten when `s.hp < max || open.wantsFood(s)`; then `open.ate(s)` is called too.
  - `checkEnd()` never ends an open match. `afterSurvivor` falling through the world puts them at `open.spawnPoint(spec)`.
  - `snapshot()` adds `open: this.open?.snapshot()`.
- `Simulation implements OpenHost` (public `difficulty`, `ticks`, `spawnZombie(x, z, opts)` with the OpenHost signature, `despawnZombie`, `addPieceBody`, `removePieceBody`, `addObstacle`, `removeObstacle`, `respawnSurvivor`, `giveWeapon`, `noise`, `hurtZombie`, `validSpawn`). The existing private `spawnZombie(x, z, from, sleeper, asleep)` must be renamed (e.g. `createZombie`) so the public OpenHost method can take the name.
- **Piece bodies:** a fixed cuboid per tile (`OPEN.tile/2` half-extents minus 0.02, height `PIECES[kind].height`), on the terrain. 'zombies'-only pieces use Rapier collision groups so survivors pass. Survivor capsules: membership 0x0001, zombie capsules 0x0002 (set in body creation, both filter everything), gates membership 0x0004 / filter 0x0002. 'none' pieces get no body (return -1).
- **Drop-in:**
  - `addOpenSurvivor(spec: PlayerSpec): void` places a newcomer via spawnPoint/initSurvivor.
  - `removeSurvivor(id: string): void` calls `open.forgetSurvivor(s)` first in open mode, then removes the body and splices the survivor out.
  - `command(id: string, cmd: OpenCommand): void` forwards to `open.command(this, id, cmd)` if open.
  - `saveWorld(now: number): WorldSave | null` and `joinWorld(): WorldJoin | null` forward to the rules.
- `BotWorld` gains `readonly open: OpenView | null` (Simulation: `this.open?.view ?? null`).

### 3.5 Rendering [render]
Files: `src/render/Renderer.ts`, new files under `src/render/open/`, plus small changes to `nameTag.ts`, `effects.ts`, `pickups.ts`, `world.ts` (exporting helpers / geometry builders for reuse).

- `Renderer.setMap(map)`: with `map.open`, the world is an `OpenWorldView` (`render/open/OpenWorldView.ts`, same `WorldView`-ish surface: `group`, `update(dt, time, focusX, focusZ)`) instead of `buildWorld`:
  - **Chunk streaming:** chunks within `LOAD` = 110 m of the focus, nearest first, at most one per frame (everything within `PRIME` = 48 m at once on the first frame); chunks beyond `DROP` = 150 m are disposed (checked every 30 frames). The camera never sees much past 50 m, and the far plane (`OPEN_FAR`) and fog hide the edge. (The first draft said ~170 / 230 m.)
  - **Per chunk:** terrain mesh (~1.6–2 m cells, vertex colours from biome-weighted palettes, the same toon look), its water (ponds/rivers clipped to the chunk, or a water plane where any vertex is below water), its trees / rocks / stones / stalks / groves / scrap piles instanced, and decor from `chunkDecor`.
  - Bridges / fords globally (like `buildCrossings`).
  - The spawn camp (reuse `buildCamp` if workable).
- `PickupsView(map)` works unchanged for bamboo snacks (the world's `bambooSpots`), but must not create hundreds of separate meshes: check it and instance if needed.
- **New on `Renderer`** (forwarded to the `OpenWorldView`; both are kept across `setMap`, and a mirror is only used for the world with the same seed):
  - `setOpenMirror(m: WorldMirror | null): void`: pieces (per chunk groups rebuilt from `takeDirty()`; walls/gates by tier with bamboo/wood/stone looks, rubble for ruined, damage darkening), depleted nodes (stumps / pebbles / cut groves instead of the full prop: nodes of a chunk hide their prop instance when depleted), crates (closed / open), loot bags.
  - `setGhost(g: GhostSpec | null): void`: a translucent green/red piece on its tile.
- **Day and night:** from `curr.open.time`, `night`:
  - lerp sky, fog, hemisphere and sun between the biome theme under the focus (from `biomeWeights`, smoothed) and a night palette
  - campfires get small warm point lights (nearest 4, flickering, all on or off together). The renderer compiles the lit shader variants when the match starts (`OpenWorldView.withLightsOn`), so the first dusk doesn't stutter.
  - snowfall only while the focus is in snow
- **Name tags:** use `OPEN.bleedTime` instead of `DOWNED.bleedTime` for the downed bar when `curr.open` is set. Effects keep using `map.terrain`.
- Camera unchanged; fog/far plane hide the streaming edge.

### 3.6 UI, input, audio, presenter [ui]
Files: `src/ui/Menu.ts`, `src/ui/InfiniteMenu.ts` (new), `src/ui/OpenHud.ts` (new), `src/ui/Hud.ts`, `src/ui/HudMap.ts`, `src/ui/Lobby.ts`, `src/ui/HowToPlay.ts`, `src/input/InputManager.ts`, `src/style.css`, `src/game/Presenter.ts`, `src/audio/Sfx.ts`.

- `Menu`: `MenuHandlers.onInfinite(): void` and an "Infinite" mode button. Keep the menu unscrollable at 360 CSS px tall (e.g. Solo row: Story · Quick play · Infinite).
- `InfiniteMenu`:
  - `constructor(parent: HTMLElement, settings: Settings, h: InfiniteMenuHandlers)`, `show(slots: (WorldSlotInfo | null)[]): void`, `hide(): void`.
  - Handlers:
    ```ts
    interface InfiniteMenuHandlers {
      onPlay(slot: number): void;
      onCreate(slot: number, opts: { name: string; seed: number | null; difficulty: Difficulty; bots: number }): void;
      onHost(slot: number): void;
      onDelete(slot: number): void;
      onBack(): void;
    }
    ```
  - Slot cards show name, Day N, difficulty, bots, last played. New-world form: name (default "World N"), seed (optional number), difficulty seg, bots 0–3. Delete asks in-page. No scroll at 360 px.
- `OpenHud` (in-game, open mode only), `constructor(parent: HTMLElement, h: OpenHudHandlers)`:
  - `start(map: GameMap, mirror: WorldMirror, localId: string): void`
  - `stop(): void`
  - `update(snap: Snapshot): void` (called every frame by the session)
  - `readonly building: boolean`
  - `key(k: BuildKey): void`: the build keys from `InputManager.onBuildKey` (main.ts wires them)
  - `deny(why: string): boolean`: shows a refusal; false when the same one went up less than 1.5 s ago, so the Presenter skips its buzz
  - `gained(r: ResourceKind, n: number): void`: the "+2" floater on the pack chip, adding up quick hits
  - Handlers:
    ```ts
    interface OpenHudHandlers {
      onCommand(cmd: OpenCommand): void;
      onGhost(g: GhostSpec | null): void;
      onBuildMode(on: boolean): void;
    }
    ```
  - Shows:
    - a day/clock chip ("Day 3 · 14:20" with sun/moon)
    - a hunger bar
    - the pack (4 resource counts, plus the stash when in reach of storage)
    - a siege banner (direction, countdown, "Defend the base!" / "A horde is hunting you!")
    - a respawn countdown while downed ("Respawning at your bed in 23 s… a friend can still revive you")
    - a leash warning
    - flashes for 'deny' events for the local player
  - **Build button (hammer)** → build mode:
    - a piece palette with costs (greyed when unaffordable)
    - ghost on the tile ~2.5 m in front of the local panda
    - Rotate, Place, Exit
    - when the target tile holds a piece: Upgrade / Repair / Demolish with costs
  - **Craft button**, shown within `craftReach` of a workbench or campfire (from the mirror) → panel of that station's recipes.
  - Keyboard (as built, listed in How to play): B build mode, 1–8 pick a piece (and enter build mode), R rotate, Space / Enter place or upgrade / repair the piece on the tile, X / Delete demolish, F craft. R, Space / Enter and X only act in build mode. M stays the big map. No gamepad build controls.
- `Hud`: with an open map (`setMap(map)` sees `map.open`):
  - the timer shows nothing (the day chip is in OpenHud)
  - the goal arrow points to the siege target during a siege, else to `mirror.baseCenter()`, else to the spawn (the HUD gets the mirror through `setOpenMirror(m: WorldMirror | null, guest = false)`, which also passes it on to the minimap)
  - the "End match" button never shows
  - the pause card says "The world is saved when you leave" and its quit button reads "Save & quit" (host / solo) or "Leave world" (`guest` true: RemoteGame passes it)
- `HudMap` in open mode:
  - the small map shows ~240 m around the local panda (rotate not needed, north up)
  - the big map shows the whole world
  - draw pieces (base) from the mirror, POIs, beds, siege marker and visible hordes from `snap.open`, teammates
  - one 1024 px base picture of the world (built once per world)
- `Lobby`: `RoomView` gains `mode: RoomMode` and `world: { name: string; day: number } | null`; `LobbyHandlers` gain `onMode(mode: RoomMode): void` and `onWorld(dir: number): void` (host cycles saved worlds). With mode 'open', map / bots pickers hide (the world decides) and the world line shows.
- `InputManager`:
  - `setBuildMode(on: boolean)` hides attack / dash / firecracker / switch buttons and makes `sample()` report no attack / cracker / swap while building (movement stays)
  - the keys above, with callbacks for OpenHud: `onBuildKey?: (key: BuildKey) => void`, where `BuildKey = 'toggle' | 'rotate' | 'place' | 'demolish' | 'craft' | number`
- `Presenter`: reaches the open HUD through `PresentContext.openHud?: OpenHud` (`GameContext` extends `PresentContext`). It handles every new event:
  - sounds (new Sfx sounds: build, gather by resource, chomp, smash, crafted, deposit, deny, siege horn, dawn / dusk stingers)
  - effects (dust on build, `Effects.chips()` on gather, `Effects.debris()` on smash)
  - a repeated `bag` event for a bag it already knows is silent; `unbag` with `by: ''` (the world tidying up) is ignored
  - HUD flashes ("Siege incoming from the north-east in 75 s!", "Day 4", "You're hungry", "Respawned at your bed", "<Name> picked up your bag", gather "+2 wood" floaters can be simple flashes for the local player only, rate-limited)
  - 'turned' no longer happens in open mode
- `HowToPlay`: a short "Infinite" section plus the new keys.

### 3.7 Network, sessions, app flow [net]
Files: `src/net/protocol.ts`, `src/net/codec.ts`, `src/net/NetHost.ts`, `src/net/NetClient.ts`, `src/game/LocalGame.ts`, `src/game/RemoteGame.ts`, `src/game/Session.ts`, `src/game/maps.ts`, `src/main.ts`.

- **Protocol:**
  - `PROTOCOL_VERSION = 8`.
  - `ClientMsg` adds `{ t: 'cmd'; c: OpenCommand }`, plus `export function sanitizeCommand(raw: unknown): OpenCommand | null`.
  - `HostMsg 'lobby'` adds `mode: RoomMode` and `world?: { name: string; day: number }`.
  - `'start'` adds `open?: WorldJoin` (set in open mode).
  - In open mode a mid-world `'start'` always has `you` and `open`.
- **Codec:** `EncodedSnapshot.o?` carries `OpenSnap` compactly (rounded). Events go through as they are.
  - **Per-guest interest:** `encodeSnapshot(s, near = null, spots = null)`. In open mode `NetHost.sendSnapshot` encodes per guest with `near` = that guest's panda and `spots` = the world's bamboo snack spots. It keeps only zombies / javelins / crackers / cracker drops within `INTEREST_RANGE` = 110 m (all survivors always).
  - With `spots`, the snack spots go as `bn`, only those within range, as signed 1-based indices (+i: has food, -i: eaten), instead of the full `b` string. `decodeSnapshot` merges them into what the guest already knows, and RemoteGame pads the list to the world's spot count (unknown spots count as having food).
- **NetHost:** `mode: RoomMode`, `world: WorldSlotInfo | null`, `setMode(mode)`, `setWorld(info)`.
  - In open mode, `joinMatch` takes a new seat for a newcomer while there are fewer than `MAX_PLAYERS` pandas; this needs `MatchSeats.addSeat(spec): boolean`, implemented by LocalGame. Otherwise it takes over a bot (`freeBotSeat`), else rejects. `hello` already rejects with "This world is full." when neither is possible.
  - The mid-world `start` gets its `open` from `MatchSeats.joinWorld(): WorldJoin | null` (LocalGame → `sim.joinWorld()`; null outside open mode).
  - A guest who leaves mid-world calls `MatchSeats.removeSeat(id)` for their own panda (it leaves; LocalGame → `sim.removeSurvivor`). A bot's panda they had taken over goes back to the bot under its old name instead. Either way they're taken off the room's player list.
  - `'cmd'` messages go to `onCommand: ((seat: string, cmd: OpenCommand) => void) | null`.
  - `start(specs, map, open?)`.
- **Session:**
  - `command(cmd: OpenCommand): void` (LocalGame: `sim.command(localId, cmd)`; RemoteGame: sends `'cmd'` through `ClientLink.sendCommand`; quick play / story ignore).
  - LocalGame overloads it: `command(cmd)` for the local player and `command(id, cmd)` for the guest playing panda `id` (main.ts wires `NetHost.onCommand` to it).
  - `GameContext` gains `openHud?: OpenHud` (declared on `PresentContext` too, for the Presenter).
- **LocalGame:**
  - With `options.open`, it creates the `WorldMirror` from `sim.joinWorld()`, calls `renderer.setOpenMirror` and `ctx.openHud.start`, applies each snapshot's events to the mirror (before presenting), and calls `openHud.update(curr)` every frame and `hud.setOpenMirror`.
  - `saveWorld(now)` passes through; `addSeat(spec)` / `removeSeat(id)` / `command(id, cmd)` for guests (host).
  - Paused in solo means the world is paused. On dispose, clear the mirror from renderer, HUD and openHud.
- **RemoteGame:** `constructor(ctx, specs, localId, onEnd, link, open: WorldJoin | null = null)`. The extra last parameter is the `start` message's `open` join. It does the same mirror handling, applying the events of every received snapshot in order (even ones too late to draw), and calls `hud.setOpenMirror(mirror, true)`.
- **maps.ts:** `loadMap({ id: OPEN_MAP_ID, seed })` builds `createOpenWorld(seed)` (cached like the others; the open world counts as one cache entry; never preview it in the menu).
- **main.ts:**
  - **Infinite menu:**
    - Create: makes the save with `newWorldSave` + `storeWorld`, then plays.
    - Play (solo): specs = you + `botSpecsFor(save)`; `new OpenRules(map, sanitizeSave(save, map))`; `LocalGame` with `{ open: rules, difficulty: save.difficulty, timeLimit: null, goalRescue: false }`.
    - Host: creates a room in 'open' mode with that slot.
    - Delete.
  - **Autosave:** every `OPEN.autosave` s for solo / host via `storeWorld(session.saveWorld(Date.now()))`, also on pause, on visibility hidden, on quit ("Save & quit"), and when the host leaves.
  - **Host in open mode:** hostStart uses the world's specs (humans in the room + `botSpecsFor(save)` minus seats taken by humans beyond 4).
  - **Guests:** `onStart` with `open` builds the map from `mapRef` (`OPEN_MAP_ID` + seed) and a RemoteGame with the join.
  - Flash on entering: "<World name>: Day N. Build a base before the first siege!" (new world) or "Welcome back to <name>: Day N".
  - `onGameEnd` is never reached in open mode.

## 4. Review checklist (for the reviewers)
- Every API in §3 exists with exactly that signature, and every caller matches it (imports, parameter order, return types).
- `OpenRulesApi` / `OpenHost` / `HordeDirectorApi` / `OpenView` are implemented completely.
- All new `GameEvent`s are produced somewhere and handled in Presenter / WorldMirror where relevant.
- The `switch` over events stays exhaustive-safe.
- Flows work end to end:
  - new world solo
  - continue
  - save & quit and continue again
  - host an existing world, guest joins, guest leaves and comes back, guest drop-in while full
- Quick play and story mode are unchanged in behaviour.
- Phone performance: no whole-world loops per tick except where bounded (pieces ≤ a few thousand, nodes only in loaded chunks or via spatial index); streaming budgets respected.
- Menus fit 360 CSS px tall.
