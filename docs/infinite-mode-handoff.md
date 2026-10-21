# Infinite mode: handoff (21 Oct 2026)

**Status:** All seven modules are written. Nothing has been compiled or run. Two of the four reviews finished; the
fix round hasn't started. The design and the API contract are in [infinite-mode.md](infinite-mode.md).

## What exists

The shared contract (written first; every module is built against it):
- `src/sim/open/types.ts` and `src/sim/open/config.ts`
- `src/openSaves.ts`
- additions to `src/sim/types.ts` (new events, `Snapshot.open`), `src/sim/gameMap.ts` (`open`) and
  `src/sim/entities.ts` (zombie fields `horde`, `siege`, `goal`, `piece`)

Each module was written by its own agent, and each agent edited only its own files:

| Area | Files |
|---|---|
| World generator | `src/sim/open/worldgen.ts`, `worldTerrain.ts`, `worldLayout.ts`, `worldProps.ts`, `worldIndex.ts`, `biomes.ts`, `pois.ts` |
| Rules and economy | `src/sim/open/rules.ts`, `structures.ts`, `economy.ts`, `mirror.ts`, `save.ts`, `clock.ts` |
| Hordes and bots | `src/sim/open/hordes.ts`, `openBots.ts` |
| Simulation | `src/sim/Simulation.ts`, `bots.ts`, `steering.ts`, `src/sim/open/physicsChunks.ts` |
| Renderer | `src/render/Renderer.ts`, `world.ts`, `pickups.ts`, `effects.ts`, `snowfall.ts`, `nameTag.ts`, `src/render/open/*` (8 files) |
| UI, input, audio | `src/ui/OpenHud.ts`, `InfiniteMenu.ts` (new), `Menu.ts`, `Hud.ts`, `HudMap.ts`, `Lobby.ts`, `HowToPlay.ts`, `src/input/InputManager.ts`, `src/style.css`, `src/game/Presenter.ts`, `src/audio/Sfx.ts` |
| Network and app flow | `src/net/*` (`PROTOCOL_VERSION` 8), `src/game/LocalGame.ts`, `RemoteGame.ts`, `Session.ts`, `maps.ts`, `src/main.ts` |

The README and `developer-guide.md` don't mention Infinite mode yet. The guide still says protocol version 7.

## Reviews

The reviews that finished were compile and contract consistency, and end-to-end flows and networking. Both reviews
confirmed the rest fits together:
- the interfaces are fully implemented and the call signatures match
- quick play, story and normal multiplayer still compile and behave the same
- per-guest network filtering works, drop-in works, and re-applying events after a join is harmless

The reviews of gameplay logic and of rendering/UI/phone performance were stopped before they reported. They need to be
run again.

### Already fixed
- `src/main.ts`: the build-key handler called `openHud.onKey`; the method is `openHud.key`. This was the only compile blocker.
- `src/game/RemoteGame.ts`: it now calls `hud.setOpenMirror(mirror, true)`, so guests see "Leave world" instead of "Save & quit".

### Still to fix

The area that owns each file is in brackets.

Major:
1. **[net] `main.ts` `nickname()` / `fallbackName`.** Saves key humans by nickname. A player without a nickname gets a random `PandaNNN` on every page load, so Continue loses their position, pack, bed and so on. Fix: before playing, hosting or joining, if `settings.nickname` is empty, store `fallbackName` in it (`saveSettings`).
2. **[rules] `rules.ts` `keyOf` (~line 97) and `playerSave`.** When a guest takes over a bot, the save writes the bot's panda under the guest's name and `players['b1']` goes stale, which duplicates packs. Fix: key bot seats (`/^b\d+$/`) by id, write `bot: true` and the bot's own name, and remember that name in the panda state at `initSurvivor`.

Minor:
3. **[ui] `Presenter.ts` ~211.** A second `bag` event for the same id plays a thud and re-flashes "Your pack dropped…". Fix: skip when `bagOwners` already has the id.
4. **[ui] `Presenter.ts` ~217.** `unbag` with `by: ''` (an old world bag being cleaned up) plays a pickup sound at the player. Fix: `if (!ev.by) break;`.
5. **[ui] `Presenter.ts` ~289.** The siege direction uses `s.x - ev.x`, which breaks near the world edge. Fix: use `compass(s.x - s.tx, s.z - s.tz)`, as `OpenHud` does.
6. **[contract] `types.ts` ~175.** The doc of the `siege` event says (x, z) is where it arrives. It's actually where the horde comes from. Reword the doc.
7. **[net] `main.ts` `setRoomMode` ~942.** Picking Infinite in the lobby with no saved world silently stays on quick play. Fix: `h.setWorld(null); h.setMode('open')` so the lobby's "Make a world first" hint shows.
8. **[ui] `Lobby.ts` ~266.** Open mode still lists "Bot buddy N" rows from the quick-play bot count. Hide them, or show the world's bot count.
9. **[net] `main.ts` `prepareWorld` ~467.** The map ref is built from the raw seed, not the sanitised one. Use `openRef(save.seed)` after `sanitizeSave`.
10. **[net] `main.ts` `reconnect` ~807.** A guest whose seat was taken retries "This world is full" for 45 s. Stop and go to the menu on that rejection.
11. **[rules] `rules.ts` `onZombieDeath` ~586.** A zombie that fell through the world counts as a kill and can drop scrap. Only count it and roll scrap when `z.hp <= 0`, but always tell the director.
12. **[rules] `rules.ts` `Threats` ~121.** There's no `campfires()`, so a campfire away from the base doesn't stop zombies spawning next to it at night. Fix: add it, cache it in `StructureStore.refresh()`, and add `'campfire'` to `isLandmark()`.
13. **[threats] `hordes.ts` `canSpawn` ~263 and ~302.** Dying zombies are counted against `OPEN.zombiesMax`, so siege waves stop early. Count only zombies that aren't dying.
14. **[ui] `Presenter.ts` ~226.** `Effects.chips()` and `Effects.debris()` exist but aren't used. Call them on `gather` and `smash`.
15. **[sim] `bots.ts` ~201.** `w.bamboo.filter(...)` runs over about 400 snack spots every tick for each hurt bot. Replace it with a plain nearest-within-20 m loop.

## Risks the builders reported (not yet reviewed)
- **Gates and bots:** gates have steering obstacle circles, so bots steer around them. The open bot pushes straight through a gate within 24 m when it's stuck. Bots have no real pathfinding, so a walled base with no gate can trap them.
- **Saving mid-siege:** saving during a siege drops that siege instead of resuming it on load.
- **Cross-device determinism:** host and guests each generate the world. A tiny maths difference between Safari and Chrome could, very rarely, shift a node or crate id. The normal maps carry the same risk.
- **Renderer:**
  - the first dusk recompiles shaders (a brief stutter)
  - night light strength and the night palette are guesses
  - building the first ~9 chunks at the start may cause a short pause
  - 20–40 draw calls per visible chunk
- **World and minimap:** generating a world takes about 1 s and 6–7 MB (estimated). The whole-world minimap picture takes about 65k terrain samples on load.
- **Autosave:** it turns the whole world into one JSON string every 60 s, which may hitch on a phone.
- **Menu fit:** the menu's Solo row (Story · Quick play · Infinite) is a tight fit at 360 px tall; check it in a browser.
- **No gamepad build controls.**

## Next steps
1. Fix items 1–15 above, either by one fixer per area working in parallel (areas own disjoint files) or by hand.
2. Re-run the two unfinished reviews: gameplay and sim logic (rules, hordes, bots, Simulation, physics chunks, save round trip, worldgen determinism) and rendering, UI and phone performance (streaming and disposal, draw calls, the 360 px layout, build mode on touch, input keys, Sfx/Presenter spam).
3. Fix what they find, then do a final consistency check.
4. Update `README.md` and `docs/developer-guide.md`: Infinite mode, controls (B build, 1–8 piece, R rotate, Space place, X demolish, F craft, M map), new files, protocol 8.
5. The user compiles (`npm install`, `npm run typecheck`, `npm run dev`) and reports errors, then plays on a phone.
