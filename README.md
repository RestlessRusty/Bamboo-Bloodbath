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

## How to play

- Walk from the camp to the **rescue hut** (follow the yellow arrow and the light beam) before the
  6:30 timer runs out. The match is won if at least one panda makes it.
- **Zombie pandas** wander the valley and chase anyone within ~16 m. More appear the further you get.
  They bite, sometimes lunge, and **can't swim**: the pond is a safe (but slow) spot.
- **Bamboo thickets** hide you: zombies only notice you when they're very close (attacking reveals you).
- **Bamboo snacks** (glowing green) heal 35 HP and grow back after a while.
- **Weapon racks** (glowing yellow): walk into one to swap your weapon for the one on the rack.
  - Knife: fast, short. Axe: slow, big hits and knockback. Javelin: thrown (2 carried) — walk over
    thrown javelins to pick them up; without javelins you slap.
- At 0 HP you're **downed**. A teammate standing next to you for 2.5 s revives you. Nobody comes
  within 10 s → you **turn into a zombie** and keep your name… in green.
- **Bot buddies** (0–3) follow you, fight, revive and eat on their own.

## Multiplayer

Menu → **Multiplayer** → **Create room** shows a 4-letter code. Friends tap **Multiplayer**, type
the code, **Join**. The host can add bots to fill up to 4 pandas and presses **Start**.

- Peer-to-peer: the host's phone runs the game and sends it to the others ~20×/s; guests send their
  controls. The free public PeerJS server is only used to introduce the phones to each other.
- If a guest leaves mid-match, a bot takes over their panda. If the host leaves, the room closes.
- Multiplayer can't be paused, and the host should keep the game in the foreground.
- Most connections work on Wi-Fi and mobile data; some strict mobile networks may block direct
  connections (PeerJS falls back to its public relay servers where it can).

## Controls

| Scheme | Move | Attack | Dash |
|---|---|---|---|
| Joystick (default) | Thumb on the left half | Red button | Blue button |
| Tilt | Tilt the phone (Settings → Recalibrate) | Red button | Blue button |
| Tap & swipe | Tap the ground / hold to steer | Swipe in a direction | Double-tap |
| Keyboard | WASD / arrows | Space or J | Shift or K |
| Gamepad | Left stick | A / X / RT | B / LT |

Attacks auto-aim at the nearest zombie. Esc, P or the pause button opens the pause menu.

## Project structure

```
src/
  main.ts              entry: menus, solo / host / guest flows, main loop
  config.ts            all gameplay tuning (speeds, horde size, damage, timers, camera, network)
  settings.ts          persisted player settings
  core/                math helpers, seeded RNG
  sim/                 game logic only, no rendering (runs on the host in multiplayer)
    Simulation.ts      authoritative state: physics, survivors, zombie AI, javelins, pickups, rules
    bots.ts            bot buddy AI
    entities.ts        internal entity types
    steering.ts        obstacle lookup for steering
    mapLayout.ts       hand-authored map layout (start, goal, hill, pond, bamboo)
    terrain.ts         height field + terrain grid
    props.ts           deterministic placement of trees, rocks, bamboo, snacks, racks, decoration
    weapons.ts         weapon stats
    types.ts           PlayerInput, Snapshot, events: the contract between sim, renderer and network
  render/              Three.js drawing only
    Renderer.ts        scene, camera, lights, interpolation, menu showcase
    world.ts           terrain, water, trees, bamboo, camp, rescue hut
    pandaModel.ts      survivor panda model + animation
    horde.ts           all zombies via instanced meshes
    pickups.ts         bamboo snacks, weapon racks, javelins
    effects.ts         blood, dust, splashes, sparkles, blood splats
    nameTag.ts         floating names with health bars
    weaponModels.ts    knife / axe / javelin models
    toon.ts            cartoon materials and outlines
  game/                sessions: LocalGame (solo / host), RemoteGame (guest), Presenter (events → fx)
  net/                 PeerJS host & client, message protocol, compact snapshot codec
  audio/               synthesised sound effects and music (no audio files)
  input/               joystick, tilt, tap & swipe, keyboard, gamepad → PlayerInput
  ui/                  menu, lobby, settings, HUD (plain DOM)
```

The simulation and the renderer only talk through `PlayerInput` (in) and `Snapshot` (out), which is
what makes the same game run solo, as host, or as a guest.

