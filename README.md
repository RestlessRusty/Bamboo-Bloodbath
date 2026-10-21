# Bamboo Bloodbath

Cute, cartoon-gory co-op survival for phones (landscape). 1–4 panda survivors with knives, axes and
javelins must cross a nature valley from the start camp to the rescue hut in the opposite corner,
while a horde of zombie pandas tries to eat them.

Web app (Vite + TypeScript + Three.js + Rapier physics + PeerJS), hosted on GitHub Pages and
installable on a phone's home screen. Can later be wrapped as an Android app.

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
the game on the device after the first visit, so solo and story mode start without a connection
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
- **Weapon racks** (glowing yellow): walk into one to swap your weapon for the one on the rack.
  - Knife: fast, short. Axe: slow, big hits and knockback. Javelin: thrown (2 carried) — walk over
    thrown javelins to pick them up; without javelins you slap.
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

| Scheme | Move (sneak) | Attack | Dash | Firecracker |
|---|---|---|---|---|
| Joystick (default) | Thumb on the left half (push halfway) | Red button | Blue button | Orange button |
| Tilt | Tilt the phone (tilt gently) | Red button | Blue button | Orange button |
| Tap & swipe | Tap the ground / hold to steer | Swipe in a direction | Double-tap | Orange button |
| Keyboard | WASD / arrows (hold C or Q) | Space or J | Shift or K | E or L |
| Gamepad | Left stick (push halfway) | A / X / RT | B / LT | Y / RB |

Attacks auto-aim at the nearest zombie. Firecrackers fly ~9 m the way you're facing. Esc, P or the
pause button opens the pause menu.

## Project structure

```
src/
  main.ts              entry: menus, solo / host / guest flows, main loop
  config.ts            all gameplay tuning (speeds, horde size, damage, timers, camera, network)
  settings.ts          persisted player settings
  storyProgress.ts     story chapters unlocked / finished on this device
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
    terrain.ts         height field + terrain grid, water / bridge / ridge / ice queries
    river.ts           smoothed curves for rivers and ridges; bridges, fords, passes
    route.ts           the way from camp to hut (HUD arrow, bots, spawning, weapon racks)
    props.ts           deterministic placement of trees, rocks, bamboo, snacks, racks, decoration
    weapons.ts         weapon stats
    types.ts           PlayerInput, Snapshot, events: the contract between sim, renderer and network
  render/              Three.js drawing only
    Renderer.ts        scene, camera, lights, interpolation, menu showcase
    world.ts           terrain, water, trees, bamboo, camp, rescue hut
    minimap.ts         top-down map preview for the map picker
    snowfall.ts        falling snow on snowy maps
    pandaModel.ts      survivor panda model + animation
    horde.ts           all zombies via instanced meshes
    pickups.ts         bamboo snacks, weapon racks, javelins
    storyView.ts       story items, the zone to hold, the objective beam
    effects.ts         blood, dust, splashes, sparkles, blood splats
    nameTag.ts         floating names with health bars
    weaponModels.ts    knife / axe / javelin models
    toon.ts            cartoon materials and outlines
  game/                sessions: LocalGame (solo / host), RemoteGame (guest), Presenter (events → fx),
                       maps.ts (map choices, "Random", cache of built maps)
  net/                 PeerJS host & client, message protocol, compact snapshot codec
  audio/               synthesised sound effects and music (no audio files)
  input/               joystick, tilt, tap & swipe, keyboard, gamepad → PlayerInput
  ui/                  menu, lobby, settings, HUD, story menu / cards / dialogue (plain DOM)
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

Ideas next: special zombie types, Android packaging (Capacitor or PWABuilder), host
migration in multiplayer, client-side prediction for smoother guest movement.
