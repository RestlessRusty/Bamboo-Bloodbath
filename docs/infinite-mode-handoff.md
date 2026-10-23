# Infinite mode: handoff (updated 23 Oct 2026)

**Status:** All seven modules are written. All four reviews are done and two fix rounds followed. Nothing has been
compiled or run. The design and the API contract are in [infinite-mode.md](infinite-mode.md), which now matches the
final code. How it fits into the rest of the game is in section 8 of [developer-guide.md](developer-guide.md).

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

The README and `developer-guide.md` now cover Infinite mode (controls, files, protocol 8, saving, multiplayer).

## First review and fixes (21–22 Oct)

The first two reviews were compile and contract consistency, and end-to-end flows and networking. Both confirmed
the rest fits together:
- the interfaces are fully implemented and the call signatures match
- quick play, story and normal multiplayer still compile and behave the same
- per-guest network filtering works, drop-in works, and re-applying events after a join is harmless

Fixed straight away:
- `src/main.ts`: the build-key handler called `openHud.onKey`; the method is `openHud.key`. This was the only compile blocker.
- `src/game/RemoteGame.ts`: it now calls `hud.setOpenMirror(mirror, true)`, so guests see "Leave world" instead of "Save & quit".

### The 15 findings (all fixed)

The area that owns each file is in brackets.

Major:
1. ✅ **[net] `main.ts` `nickname()` / `fallbackName`.** Saves key humans by nickname. A player without a nickname got a random `PandaNNN` on every page load, so Continue lost their position, pack, bed and so on. Fixed: `nickname()` stores `fallbackName` in `settings.nickname` before playing, hosting or joining.
2. ✅ **[rules] `rules.ts` `keyOf` and `playerSave`.** When a guest took over a bot, the save wrote the bot's panda under the guest's name and `players['b1']` went stale, which duplicated packs. Fixed: bot seats (`/^b\d+$/`) are keyed by id and written with `bot: true` and the bot's own name, remembered in the panda state at `initSurvivor`.

Minor:
3. ✅ **[ui] `Presenter.ts`.** A second `bag` event for the same id played a thud and re-flashed "Your pack dropped…". It's now silent when `bagOwners` already has the id.
4. ✅ **[ui] `Presenter.ts`.** `unbag` with `by: ''` (an old world bag being cleaned up) played a pickup sound at the player. It's now ignored.
5. ✅ **[ui] `Presenter.ts`.** The siege direction used `s.x - ev.x`, which broke near the world edge. It now takes the direction from the snapshot's siege (`s.x - s.tx`, `s.z - s.tz`), as `OpenHud` does.
6. ✅ **[contract] `types.ts`.** The doc of the `siege` event said (x, z) is where it arrives. It's reworded: it's where the horde comes from.
7. ✅ **[net] `main.ts` `setRoomMode`.** Picking Infinite in the lobby with no saved world silently stayed on quick play. The room now switches to 'open' with no world, so the lobby's "Make a world first" hint shows.
8. ✅ **[ui] `Lobby.ts`.** Open mode listed "Bot buddy N" rows from the quick-play bot count. They're hidden in open mode.
9. ✅ **[net] `main.ts` `prepareWorld`.** The map ref was built from the raw seed, not the sanitised one. It now uses `openRef(save.seed)` after `sanitizeSave`.
10. ✅ **[net] `main.ts` `reconnect`.** A guest whose seat was taken retried "This world is full" for 45 s. A rejection now stops the retries and goes to the menu.
11. ✅ **[rules] `rules.ts` `onZombieDeath`.** A zombie that fell through the world counted as a kill and could drop scrap. Now only `z.hp <= 0` counts and rolls scrap; the director is always told.
12. ✅ **[rules] `rules.ts` `Threats`.** There was no `campfires()`, so a campfire away from the base didn't stop zombies spawning next to it at night. It's added, cached in `StructureStore.refresh()`, and `'campfire'` is in `isLandmark()`.
13. ✅ **[threats] `hordes.ts` `canSpawn`.** Dying zombies were counted against `OPEN.zombiesMax`, so siege waves stopped early. Only zombies that aren't dying count now.
14. ✅ **[ui] `Presenter.ts`.** `Effects.chips()` and `Effects.debris()` existed but weren't used. They now play on `gather` and `smash`.
15. ✅ **[sim] `bots.ts`.** `w.bamboo.filter(...)` ran over about 400 snack spots every tick for each hurt bot. It's now a plain nearest-within-20 m loop.

## Second review and fixes (23 Oct)

The two unfinished reviews were run again: gameplay and sim logic, and rendering / UI / phone performance. What they
turned up, and what changed in the second fix round:

**Logic** (2 major, 8 minor, all fixed):
- **Abandoned buildings counted as the team's base.** Their beds, chests, lookouts and campfires counted as bases and lookouts. Sieges could target a random farmhouse, bots guarded it, and every siege got the lookout warning bonus. Now only the players' pieces count (`isPlayers` in `structures.ts`, also in `mirror.baseCenter`). Repairing or upgrading a world piece makes it the repairer's.
- **Walking past a world bed claimed it.** That silently moved your respawn point, and bots did it too. Now only players' beds can be claimed, and bots only claim beds in the main base.
- **Repair then demolish made a profit.** Repairs are now priced from the piece's total price up to its tier.
- **Zombies could spawn inside a walled base.** Ambient zombies and hordes now skip spots within a base's radius + 4 m.
- **Pandas placed on a bridge appeared under it.** Placement now uses `groundAt`; `validSpawn` and the rules' `freeSpot` reject bridges.
- **Snack spots cost the whole world every tick.** Open mode now checks only the spots in the chunks around each panda, keeps a list of eaten spots for regrowth, and caches the snapshot's bamboo array.
- **Hurt open-mode bots scanned all ~400 snacks every tick.** They now look every 0.6 s and cache the nearest.
- **Thrown things hit pieces as if they were 4.5 m tall.** Javelins and firecrackers now test each piece's own height, so they fly over beds and low walls.
- **Bags were all-or-nothing.** A bag is now taken partially, and "Your pack is full" shows at most every 2 s.
- **Two pandas could own one bed.** The second claim is now refused, and a returning owner loses the bed if someone else holds it.

**Render and UI** (3 major, 10 minor, all fixed):
- **The touch Place button couldn't upgrade or repair.** It now does what its label says (`OpenHud.primary()`).
- **Every bite on a wall rebuilt the whole chunk's pieces.** It happened every frame during a siege and made gates snap shut. An HP-only change now just retints; gate swing carries over on rebuilds.
- **The first dusk stuttered.** The 4 campfire lights forced every lit shader to recompile. The scene is now compiled once with the lights on when a world starts.
- **Snowfall** could stay at partial strength on the next normal map; it's now reset.
- **Streaming reached too far for a phone.** It loaded to ~170 m and dropped at ~230 m; it's now 110 m / 150 m, with the camera's far plane at 160 m in open mode.
- **Empty "used up" batches** (stumps, open crates and so on) are hidden when they show nothing.
- **The camera glided after a respawn at a far bed.** It now jumps when the focus moves more than 40 m.
- **Touch targets** are now at least 40 px. The build panel is one row (~72 px) with the piece actions in a column at the dash/swap spot. The craft panel ends above the action buttons.
- **Too many sounds and messages.** Chomps are limited to one per 150 ms, the same refusal to one buzz per 1.5 s, and "is back on their feet" shows for humans only.
- **The Menu's nickname field** now shows the saved fallback name.
- **Snack spots were sent in full to every guest** (the network part of the snack finding). Only spots within 110 m of each guest go now, as `bn`, and guests merge them.

`docs/infinite-mode.md` was corrected wherever the final code differs from the first contract: the
`Session` / `LocalGame` `command` overload, `MatchSeats.joinWorld`, `RemoteGame`'s `open` parameter,
`OpenHud.key` / `deny` / `gained`, `Hud.setOpenMirror(m, guest)` and `PresentContext.openHud`.

## Risks still open (not fixable without a build)
- **Gates and bots:** gates have steering obstacle circles, so bots steer around them. The open bot pushes straight through a gate within 24 m when it's stuck. Bots have no real pathfinding, so a walled base with no gate can trap them.
- **Saving mid-siege:** saving during a siege drops that siege instead of resuming it on load.
- **Cross-device determinism:** host and guests each generate the world. A tiny maths difference between Safari and Chrome could, very rarely, shift a node or crate id. The normal maps carry the same risk.
- **Renderer:**
  - night light strength and the night palette are guesses
  - building the first chunks at the start may cause a short pause
  - 20–40 draw calls per visible chunk
- **World and minimap:** generating a world takes about 1 s and 6–7 MB (estimated). The whole-world minimap picture takes about 65k terrain samples on load.
- **Autosave:** it turns the whole world into one JSON string every 60 s, which may hitch on a phone.
- **Menu fit:** the menu's Solo row (Story · Quick play · Infinite) is a tight fit at 360 px tall; check it in a browser.
- **No gamepad build controls.**

## Next steps
1. **The user compiles** (`npm install`, `npm run typecheck`, `npm run dev`) and reports the errors, which then get fixed.
2. **Play-test on a phone:**
   - new world, Save & quit, Continue
   - building on touch
   - a night, a siege
   - hosting a world with a guest dropping in, leaving and coming back
   - frame rate while chunks stream
3. **Open design question:** intact beds and storage chests in abandoned buildings can't be claimed or used. Only damaged ones can, by repairing them. Either keep this (players demolish and rebuild) or add a "Claim" action for intact world pieces.
4. **Tuning** after play-testing (all in `src/sim/open/config.ts` unless noted):
   - night light strength (`OpenWorldView.ts`, `sky.ts`)
   - horde and siege sizes
   - hunger rate
   - node yields
   - world generation densities (`worldProps.ts`, `biomes.ts`, `pois.ts`)
