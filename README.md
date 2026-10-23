# Bamboo Bloodbath

Cute, cartoon-gory co-op survival for phones (landscape). 1–4 panda survivors with knives, axes and
javelins must cross a nature valley from the start camp to the rescue hut in the opposite corner,
while a horde of zombie pandas tries to eat them. Or they settle down in **Infinite mode**: a big
open world where they gather, build a base and survive as many days as they can.

> **Status:** Infinite mode (21–23 Oct 2026) is written and reviewed but has **not been compiled or
> run yet**. Expect a round of type errors on the first `npm run typecheck`.

Web app (Vite + TypeScript + Three.js + Rapier physics + PeerJS), hosted on GitHub Pages and
installable on a phone's home screen. Can later be wrapped as an Android app.

How the code fits together (for developers): [docs/developer-guide.md](docs/developer-guide.md).

## Run it

Requires [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
npm run dev        # dev server with hot reload
npm run build      # production build into dist/
npm run preview    # serve the production build
npm run typecheck  # TypeScript type check (the build does not type-check)
```

### Testing on a phone

`npm run dev` prints a **Network** URL like `https://192.168.1.23:5173`. Open it on a phone on the
same Wi-Fi. The dev server uses a self-signed certificate (HTTPS is required for motion sensors and
WebRTC), so the browser will warn once: choose *Advanced → Proceed*.

If something breaks on the phone, errors appear in a red box at the bottom of the screen (tap to
dismiss).

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository (branch `main`).
2. In the repo: **Settings → Pages → Source: GitHub Actions**.
3. Every push to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml), which
   builds the game and publishes it to `https://<user>.github.io/<repo>/`.

On the phone, open the URL and use the browser's *Add to Home screen* to install it fullscreen.
In the browser, the top-right corner of the menus has **Install** (Chrome/Android: the browser's
install prompt, once it offers one; iPhone/iPad: how to add it via Share) and a fullscreen button
(matches go fullscreen on their own when they start).

### Offline

The production build registers a service worker ([public/sw.js](public/sw.js)) that keeps a copy of
the game on the device after the first visit, so solo, story and Infinite mode start without a connection
(multiplayer still needs one). The page is always fetched fresh when online, so a new deploy shows
up on the next launch; files from older builds are dropped automatically. The dev server doesn't
register it.

## How to play

- Pick a **map** in the menu: Bamboo Valley, River Crossing, Snowy Pass, or **Random Valley** (a new
  generated layout every match). *Random* picks any of them. In multiplayer the host picks.
- Walk from the camp to the **rescue hut** (follow the yellow arrow and the light beam) before the
  6:30 timer runs out. The arrow follows the map's route, e.g. through passes. The match is won if at least one panda makes it.
- **Zombie pandas** wander the valley and chase anyone within ~16 m. More appear the further you get.
  They bite, sometimes lunge, and **can't swim**: ponds and rivers are safe (but slow) spots.
  They cross rivers only on bridges and at shallow fords, where everyone wades slowly.
- **Sleeping zombies** (curled up, snoring, *z z z*): most of the zombies already out on the map are
  asleep. Noise wakes them: running, dashing, splashing, swinging (the axe is loud, the knife quiet),
  javelins landing. **Walk slowly** (push the stick only halfway, tilt gently, or hold C) to sneak
  past. Hitting a sleeper is a **sneak attack** that finishes it in one hit. A waking zombie groans,
  which can wake its neighbours.
- **Firecrackers** (orange button): you start with 2 and carry up to 3; killed zombies sometimes drop
  more. A thrown firecracker crackles for 4 s and pulls every zombie within ~20 m to it (unless one is
  already right next to you), then bangs and knocks over anything close. It wakes sleepers too, and
  fizzles out in water.
- **Ridges** (Snowy Pass) can't be climbed: go through the passes, where the arrow leads, or squeeze
  through a narrow shortcut. **Frozen ponds** are walkable but slippery for everyone.
- **Bamboo thickets** hide you: zombies only notice you when they're very close (attacking reveals you).
- **Bamboo snacks** (glowing green) heal 35 HP and grow back after a while.
- **Two weapon slots.** You always keep the weapon you picked in the menu. Walking into a **weapon
  rack** (glowing yellow) puts its weapon in your second slot (replacing whatever was there) and in
  your paw; the purple button switches between the two (a short draw before you can attack). A rack
  stands empty for 30 s after someone took from it; a javelin rack also tops up javelins you carry.
  - Knife: fast, short. Axe: slow, big hits and knockback.
  - Javelin: thrown (2 carried). One throw kills and goes through the first zombie into a second.
    Walk over thrown javelins to pick them up; missing ones are also carved back, one every 8 s.
    Out of javelins you switch to your other weapon automatically, or slap if you have none.
- At 0 HP you're **downed**. A teammate standing next to you for 2.5 s revives you. Nobody comes
  within 10 s → you **turn into a zombie** and keep your name… in green.
- **Bot buddies** (0–3) follow you, fight, revive and eat on their own.
- **Difficulty** (Easy / Normal / Hard, in the menu, story menu and room): scales the horde size, how
  hard and fast zombies are, and how many start asleep (see `DIFFICULTY` in `config.ts`). It applies to
  story chapters too. In multiplayer the host picks it.
- **Records** (saved on the device, per map, difficulty and number of bot buddies): matches played and
  won, best time for a won match, and most kills. Quick play → **Records** opens a card per map with a
  Best time / Most kills switch and a difficulty × bots table; the end screen shows the line for the
  match just played. Story chapters don't count.
- Bridges, fords and ridge passes, plus a few metres before and after each, are always kept free of
  trees and rocks.

## Infinite mode

Menu → **Infinite**: an open-world, base-building survival mode that never ends. Play it solo, with
0–3 bot buddies, or host it for friends (Multiplayer → Create room → switch the room to Infinite).

- **Worlds:** 3 save slots on the device. A new world takes a name, an optional seed, a difficulty
  and 0–3 bots. Each world is a 1 km square generated from its seed, with seven biomes (meadow,
  bamboo forest, pine forest, snowy highlands, fen, quarry, farmland), rivers, ridges and 25–40
  abandoned buildings to loot and repair. It's saved every minute, on pause, when the page is
  hidden and on **Save & quit**.
- **Day and night:** a day lasts 20 minutes. Nights bring more zombies and faster hordes; campfires
  glow and keep lone zombies from appearing next to them.
- **Gathering:** hit trees (wood), rocks (stone), bamboo groves (bamboo) and scrap piles (scrap) with
  no zombie in reach. An axe chops and mines faster, a knife cuts bamboo and scrap faster. It's loud,
  and hordes may come to look. Nodes regrow after 10 minutes. Supply crates in the buildings hold
  scrap, food, firecrackers and sometimes a weapon.
- **Pack and stash:** your backpack holds 60 units. Walk up to a storage chest to empty it into the
  team stash; building and crafting use the stash when a chest is near.
- **Building** (hammer button or **B**): one piece per 2 m tile, on the tile in front of you. Walls
  and gates (pandas walk through, zombies don't) upgrade from bamboo to wood to stone; also spikes,
  campfire, workbench, bed, storage chest and lookout tower. Pieces get chewed down to rubble; repair
  or upgrade them (that also makes an abandoned building's piece yours), or demolish your own for
  half the price back.
- **Crafting** (anvil button or **F**) at a workbench (knife, axe, javelins, firecrackers, bandage)
  or a campfire (bamboo stew).
- **Hunger** drains slowly; bamboo snacks and stew fill it. Hungry pandas are slower, starving hurts.
- **Beds:** walk up to a bed you or a friend built to make it yours. Downed and not revived within
  30 s, you respawn at your bed (else at the camp); your pack stays where you fell as a bag anyone can
  pick up. Nobody turns into a zombie here.
- **Hordes and sieges:** lone zombies wander about, roaming hordes drift over the world, and every
  day or two a siege comes for your base (or for you, if nobody is near the base), with a warning
  first. A lookout tower spots hordes from afar and gives more warning.
- **Multiplayer:** friends can drop in any time (a panda of their own while there are fewer than 4,
  else a bot's). Leaving takes your panda out of the world; the host's save keeps it under your
  nickname for next time. Nobody can get more than 250 m from the nearest other player. Only the
  host saves.

## Story mode

Menu → **Story**: *Find the Cure*, five chapters on their own hand-made maps, solo with 0–3 bot
buddies. Finishing a chapter unlocks the next (saved on the device).

1. **The Signal** (Ember Woods): fix the ranger radio with batteries found around the woods.
2. **House Call** (Willow River): reach Doc Mapo's clinic across the river, hold it while she packs,
   then escort her out.
3. **Over the Mountains** (Frostbite Ridge): pick snow lotus on both sides of a ridge, 10-minute clock.
4. **Glowcaps** (Firefly Fen): hide Doc in a bamboo thicket, collect glowing mushrooms, come back for her.
5. **The Brew** (Old Research Station): get Doc through the gate, then defend the yard while the cure brews.

- **Doc** follows you (or waits somewhere), revives anyone who's down, and slowly heals pandas next
  to her when no zombie is close. If she turns into a zombie, the chapter is lost.
- The **objective** is always shown at the top, and the arrow points to it. Story cards between
  chapters and the lines during play each have one **Skip** button.
- **Hold** objectives: stay inside the glowing circle until the bar fills (the clock pauses while
  nobody is in it); zombies keep coming from every side.
- Losing offers **Retry from checkpoint** (most chapters save one mid-way) or **Restart chapter**.

## Multiplayer

Menu → **Multiplayer** → **Create room** shows a 4-letter code. Friends tap **Multiplayer**, type
the code, **Join**. The host can add bots to fill up to 4 pandas and presses **Start**.

Each device has its **own room code**, made once and kept, so every room it creates gets the same
code (a random one only if that's busy, e.g. right after a reload) and friends can keep the link.

Beside the room code: **Copy** (the code), **Share** (the phone's share sheet, or the clipboard, with
a `?room=CODE` link that opens the game with a red **Join CODE** button next to Multiplayer, so the
friend can still pick a name and panda first) and **QR** (the same link as a QR code to scan with the
camera).

- Peer-to-peer: the host's phone runs the game and sends it to the others ~20×/s; guests send their
  controls. The free public PeerJS server is only used to introduce the phones to each other.
- If a guest leaves mid-match, a bot takes over their panda until they're back. A guest whose
  connection drops keeps reconnecting for 45 s on their own; after that (or if the game was closed),
  the menu shows **Rejoin CODE** for 15 minutes. The host recognises them by a seat ticket saved on
  their device and hands their panda back. If the host leaves, the room closes.
- **Join mid-match:** someone joining a running match takes over a bot buddy's panda (with their
  name). With no bot free (or the match ending), they wait in the room and play the next match.
- Multiplayer can't be paused, and the host should keep the game in the foreground.
- Most connections work on Wi-Fi and mobile data; some strict mobile networks may block direct
  connections (PeerJS falls back to its public relay servers where it can).

## Controls

| Scheme | Move (sneak) | Attack | Dash | Firecracker | Switch weapon |
|---|---|---|---|---|---|
| Joystick (default) | Thumb on the left half (push halfway) | Red button | Blue button | Orange button | Purple button |
| Tilt | Tilt the phone (tilt gently) | Red button | Blue button | Orange button | Purple button |
| Tap & swipe | Tap the ground / hold to steer | Swipe in a direction | Double-tap | Orange button | Purple button |
| Keyboard | WASD / arrows (hold C or Q) | Space or J | Shift or K | E or L | R or Tab |
| Gamepad | Left stick (push halfway) | A / X / RT | B / LT | Y / RB | LB |

Attacks auto-aim at the nearest zombie. Firecrackers fly ~9 m the way you're facing. Esc, P or the
pause button opens the pause menu. The minimap under the goal arrow shows your team and where to go;
tap it (or press M) for a bigger map.

Infinite mode adds (touch: the hammer and anvil buttons by the map; build mode swaps the fight
buttons for Place, Rotate and Exit):

| Key | Action |
|---|---|
| B | Build mode on / off |
| 1–8 | Pick a piece (wall, gate, spikes, campfire, workbench, bed, storage, lookout); enters build mode |
| R | Rotate the piece (build mode; otherwise it still switches weapons) |
| Space or Enter | Place, or upgrade / repair the piece on that tile (build mode; otherwise Space attacks) |
| X or Delete | Demolish the piece on that tile (build mode) |
| F | Craft, next to a workbench or campfire |
| M | Big map (the whole world) |

There are no gamepad build controls yet.

## Project structure

```
src/
  main.ts              entry: menus, solo / host / guest flows, main loop
  config.ts            all gameplay tuning (speeds, horde size, damage, timers, camera, network)
  settings.ts          persisted player settings
  storyProgress.ts     story chapters unlocked / finished on this device
  openSaves.ts         Infinite mode worlds saved on this device (3 slots)
  core/                math helpers, seeded RNG
  sim/                 game logic only, no rendering (runs on the host in multiplayer)
    Simulation.ts      authoritative state: physics, survivors, zombie AI, javelins, pickups, rules
    bots.ts            bot buddy AI
    entities.ts        internal entity types
    steering.ts        obstacle lookup for steering
    mapLayout.ts       map layout format: start, hut, route, hills, ponds, rivers, ridges, bamboo, density, theme
    maps/              the maps themselves (one file each), randomValley.ts (layout generator),
                       and the list in index.ts; story/ holds the five story chapter maps
    story/             story mode: chapters.ts (the script: objectives, lines, cards, rules),
                       Mission.ts (runs a chapter inside the simulation), docBrain.ts (Doc's AI)
    open/              Infinite mode: types.ts + config.ts (the contract and all its tuning),
                       worldgen.ts and world*.ts / biomes.ts / pois.ts (the seeded world),
                       rules.ts (OpenRules, runs inside the simulation), structures.ts (pieces),
                       economy.ts, clock.ts, hordes.ts (zombies, hordes, sieges), openBots.ts,
                       mirror.ts (every client's copy of the world), save.ts, physicsChunks.ts
    terrain.ts         height field + terrain grid, water / bridge / ridge / ice queries
    river.ts           smoothed curves for rivers and ridges; bridges, fords, passes
    route.ts           the way from camp to hut (HUD arrow, bots, spawning, weapon racks)
    props.ts           deterministic placement of trees, rocks, bamboo, snacks, racks, decoration
    weapons.ts         weapon stats
    types.ts           PlayerInput, Snapshot, events: the contract between sim, renderer and network
  render/              Three.js drawing only
    Renderer.ts        scene, camera, lights, interpolation, menu showcase
    world.ts           terrain, water, trees, bamboo, camp, rescue hut
    minimap.ts         top-down map picture for the map picker and the in-game minimap
    snowfall.ts        falling snow on snowy maps
    pandaModel.ts      survivor panda model + animation
    horde.ts           all zombies via instanced meshes
    pickups.ts         bamboo snacks, weapon racks, javelins
    storyView.ts       story items, the zone to hold, the objective beam
    effects.ts         blood, dust, splashes, sparkles, blood splats
    nameTag.ts         floating names with health bars
    weaponModels.ts    knife / axe / javelin models
    toon.ts            cartoon materials and outlines
    open/              Infinite mode: OpenWorldView.ts (streams 64 m chunks around the camera),
                       chunk.ts / terrainChunk.ts, pieces.ts (building pieces, build ghost),
                       sky.ts (day and night), assets.ts, bake.ts, context.ts
  game/                sessions: LocalGame (solo / host), RemoteGame (guest), Presenter (events → fx),
                       maps.ts (map choices, "Random", cache of built maps)
  net/                 PeerJS host & client, message protocol, compact snapshot codec
  audio/               synthesised sound effects and music (no audio files)
  input/               joystick, tilt, tap & swipe, keyboard, gamepad → PlayerInput
  ui/                  menu, lobby, settings, HUD + minimap, story menu / cards / dialogue (plain DOM);
                       InfiniteMenu.ts (save slots, new world), OpenHud.ts (day, hunger, pack,
                       build mode, crafting)
```

The simulation and the renderer only talk through `PlayerInput` (in) and `Snapshot` (out), which is
what makes the same game run solo, as host, or as a guest.

### Adding a map

Copy [src/sim/maps/valley.ts](src/sim/maps/valley.ts), give it a new `id`, `seed`, layout and colours,
and add it to `MAPS` in [src/sim/maps/index.ts](src/sim/maps/index.ts). Every device generates the
map from that data, so multiplayer only sends the map id (plus the seed for Random Valley). Changing a map changes the game for
everyone, so bump `PROTOCOL_VERSION` in `src/net/protocol.ts` when you do.

## Roadmap

1. ✅ Project setup, GitHub Pages deploy
2. ✅ Map, panda, controls, camera, knife
3. ✅ Zombie AI and horde, combat, health, win/lose
4. ✅ Axe and javelin, weapon racks, bot teammates, downed / revive / turned
5. ✅ Multiplayer: PeerJS rooms with codes, lobby, state sync
6. ✅ Polish: sound, music, effects, HUD
7. More maps
   - ✅ A. Map system and picker (menu + lobby, mini-map, Random)
   - ✅ B. River Crossing (river, bridges, ford)
   - ✅ C. Snowy Pass (winding route between cliffs)
   - ✅ D. Random Valley (new generated layout every match)
8. ✅ Sleeping zombies (noise and sneaking) and firecrackers
9. ✅ Story mode: *Find the Cure*, 5 chapters (solo + bots)
10. Infinite mode: open world, base building, solo / bots / multiplayer (written and reviewed,
    not compiled yet)

Ideas next: special zombie types, Android packaging (Capacitor or PWABuilder), host
migration in multiplayer, client-side prediction for smoother guest movement.
