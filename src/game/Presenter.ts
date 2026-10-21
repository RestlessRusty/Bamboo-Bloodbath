import type { Sfx, SfxName } from '../audio/Sfx';
import type { Renderer } from '../render/Renderer';
import type { Settings } from '../settings';
import { PIECES, RECIPES, RESOURCE_LABELS } from '../sim/open/config';
import type { Loot, ResourceKind } from '../sim/open/types';
import { WATER_LEVEL } from '../sim/terrain';
import type { GameEvent, PlayerSpec, Snapshot } from '../sim/types';
import { WEAPONS } from '../sim/weapons';
import type { Hud } from '../ui/Hud';
import { compass, type OpenHud } from '../ui/OpenHud';
import type { StoryHud } from '../ui/StoryHud';

export interface PresentContext {
  renderer: Renderer;
  hud: Hud;
  sfx: Sfx;
  settings: Settings;
  /** Story objective and dialogue (only shows anything during story chapters). */
  story?: StoryHud;
  /** Infinite mode's HUD (refusals and "+2 wood" go there). */
  openHud?: OpenHud;
}

const GATHER_SFX: Record<ResourceKind, SfxName> = { wood: 'gatherWood', stone: 'gatherStone', bamboo: 'gatherBamboo', scrap: 'gatherScrap' };

/** "+3 scrap, +20 food, 2 firecrackers, an axe" (empty: nothing). */
function lootText(loot: Loot): string {
  const parts: string[] = [];
  for (const k of Object.keys(loot.res) as ResourceKind[]) {
    const n = loot.res[k] ?? 0;
    if (n > 0) parts.push(`+${n} ${RESOURCE_LABELS[k].toLowerCase()}`);
  }
  if (loot.food) parts.push(`+${loot.food} food`);
  if (loot.crackers) parts.push(`${loot.crackers} firecracker${loot.crackers === 1 ? '' : 's'}`);
  if (loot.weapon) parts.push(`${loot.weapon === 'axe' ? 'an' : 'a'} ${WEAPONS[loot.weapon].label.toLowerCase()}`);
  return parts.join(', ');
}

/** Turns simulation events into sounds, particles, screen shake, vibration and HUD messages. */
export class Presenter {
  private names: Map<string, string>;
  /** Infinite mode: whose pack each dropped bag is (seen in 'bag' events), for "<Name> picked up your bag". */
  private readonly bagOwners = new Map<number, string>();
  /** performance.now() until which another "stashed" message would be noise. */
  private depositQuiet = 0;

  constructor(
    private readonly ctx: PresentContext,
    specs: readonly PlayerSpec[],
    private readonly localId: string,
  ) {
    this.names = new Map(specs.map((s) => [s.id, s.name]));
  }

  /** Mid-match team change: someone took over a bot's panda. */
  setSpecs(specs: readonly PlayerSpec[]): void {
    this.names = new Map(specs.map((s) => [s.id, s.name]));
  }

  present(events: readonly GameEvent[], snap: Snapshot): void {
    const { renderer, hud, sfx } = this.ctx;
    const listener = renderer.listenerPos();
    sfx.setListener(listener.x, listener.z);

    const posOf = (id: string) => {
      const s = snap.survivors.find((x) => x.id === id);
      return s ? { x: s.x, y: s.y, z: s.z } : { x: listener.x, y: 0, z: listener.z };
    };
    const name = (id: string) => (id === this.localId ? 'You' : (this.names.get(id) ?? 'Someone'));
    const mine = (id: string) => id === this.localId;
    const ground = (x: number, z: number) => renderer.currentMap.terrain.groundAt(x, z);

    for (const ev of events) {
      switch (ev.e) {
        case 'swing':
          sfx.play(ev.w === 'axe' ? 'chop' : 'swing', posOf(ev.id), 0.8);
          break;
        case 'throw':
          sfx.play('throw', posOf(ev.id));
          break;
        case 'dash': {
          const p = posOf(ev.id);
          sfx.play('dash', p, 0.7);
          renderer.effects.dust(p.x, p.y, p.z);
          break;
        }
        case 'hit':
          sfx.play(ev.kill ? 'kill' : 'hit', ev);
          renderer.effects.blood(ev.x, ev.y, ev.z, ev.kill);
          break;
        case 'bite': {
          const p = posOf(ev.id);
          sfx.play('bite', p);
          renderer.effects.blood(p.x, p.y + 1, p.z, false);
          if (mine(ev.id)) {
            sfx.play('squeak', p, 0.8);
            renderer.shake(0.45);
            this.vibrate(70);
          }
          break;
        }
        case 'groan':
          sfx.play('groan', ev, 0.7);
          break;
        case 'downed':
          sfx.play('downed', posOf(ev.id));
          hud.flash(mine(ev.id) ? "You're down! A buddy can revive you." : `${name(ev.id)} is down! Stand next to them to revive!`);
          if (mine(ev.id)) this.vibrate(250);
          break;
        case 'revived': {
          const p = posOf(ev.id);
          sfx.play('revived', p);
          renderer.effects.sparkle(p.x, p.y, p.z);
          hud.flash(mine(ev.id) ? 'You got back up!' : `${name(ev.id)} is back up!`, 2000);
          break;
        }
        case 'turned':
          sfx.play('turned', posOf(ev.id));
          hud.flash(mine(ev.id) ? 'You turned into a zombie…' : `${name(ev.id)} turned into a zombie!`);
          break;
        case 'rescued': {
          const p = posOf(ev.id);
          sfx.play('rescued');
          renderer.effects.sparkle(p.x, p.y, p.z);
          hud.flash(mine(ev.id) ? 'You made it to the hut!' : `${name(ev.id)} reached the hut!`);
          break;
        }
        case 'eat': {
          const p = posOf(ev.id);
          sfx.play('eat', p);
          renderer.effects.sparkle(p.x, p.y, p.z, 0x9cff7a);
          if (mine(ev.id)) hud.flash('Yum! Bamboo heals.', 1500);
          break;
        }
        case 'swap':
          sfx.play('pickup', posOf(ev.id));
          if (mine(ev.id)) hud.flash(`Picked up the ${WEAPONS[ev.w].label.toLowerCase()}!`, 1800);
          break;
        case 'grab':
          sfx.play('pickup', posOf(ev.id), 0.6);
          break;
        case 'draw':
          if (mine(ev.id)) sfx.play('pickup', posOf(ev.id), 0.35);
          break;
        case 'splash':
          sfx.play('splash', ev, 0.7);
          renderer.effects.splash(ev.x, WATER_LEVEL, ev.z);
          break;
        case 'thud':
          sfx.play('thud', ev, 0.6);
          renderer.effects.dust(ev.x, ev.y, ev.z);
          break;
        case 'snore':
          sfx.play('snore', ev, 0.6);
          break;
        case 'wake':
          sfx.play('wake', ev, 0.8);
          break;
        case 'toss':
          sfx.play('toss', posOf(ev.id), 0.8);
          break;
        case 'pop':
          sfx.play('pop', ev, 0.55);
          renderer.effects.pop(ev.x, ev.y, ev.z);
          break;
        case 'bang': {
          sfx.play('bang', ev);
          renderer.effects.bang(ev.x, ev.y, ev.z);
          const d = Math.hypot(ev.x - listener.x, ev.z - listener.z);
          if (d < 12) renderer.shake(0.5 * (1 - d / 12));
          break;
        }
        case 'loot':
          sfx.play('pickup', posOf(ev.id), 0.7);
          if (mine(ev.id)) hud.flash('Picked up a firecracker!', 1500);
          break;
        case 'say':
          this.ctx.story?.say(ev.who, ev.text);
          break;
        case 'collect':
          sfx.play('pickup', ev);
          renderer.effects.sparkle(ev.x, ev.y, ev.z);
          break;
        case 'objective':
          sfx.play('revived', undefined, 0.6);
          break;
        case 'checkpoint':
          hud.flash('Checkpoint reached', 1800);
          break;
        case 'heal': {
          const p = posOf(ev.id);
          renderer.effects.sparkle(p.x, p.y, p.z, 0x9cff7a);
          break;
        }
        // ---- Infinite mode. The world changes themselves (piece, node…) are the WorldMirror's.
        case 'piece':
        case 'unpiece':
        case 'node':
          break;
        case 'crate': {
          const crate = renderer.currentMap.open?.crates[ev.id];
          const at = crate ? { x: crate.x, z: crate.z } : posOf(ev.by);
          sfx.play('pickup', at);
          renderer.effects.sparkle(at.x, ground(at.x, at.z), at.z);
          if (mine(ev.by)) {
            const what = crate ? lootText(crate.loot) : '';
            hud.flash(what ? `Supplies! ${what}` : 'The crate was empty…', 2400);
          }
          break;
        }
        case 'bag': {
          this.bagOwners.set(ev.b.id, ev.b.owner);
          sfx.play('thud', ev.b, 0.6);
          if (ev.b.owner && ev.b.owner === this.names.get(this.localId)) hud.flash('Your pack dropped where you fell. Go and get it back!', 3500);
          break;
        }
        case 'unbag': {
          const owner = this.bagOwners.get(ev.id) ?? '';
          this.bagOwners.delete(ev.id);
          sfx.play('pickup', posOf(ev.by), 0.8);
          const me = this.names.get(this.localId) ?? '';
          if (mine(ev.by)) hud.flash(owner === me ? 'Got your pack back!' : owner ? `Picked up ${owner}'s pack` : 'Picked up a bag', 2000);
          else if (owner && owner === me) hud.flash(`${name(ev.by)} picked up your pack`, 2500);
          break;
        }
        case 'gather': {
          sfx.play(GATHER_SFX[ev.r], ev, 0.8);
          const y = ground(ev.x, ev.z) + 0.8;
          if (ev.r === 'stone' || ev.r === 'scrap') renderer.effects.pop(ev.x, y, ev.z);
          else renderer.effects.dust(ev.x, y - 0.5, ev.z);
          if (mine(ev.id)) this.ctx.openHud?.gained(ev.r, ev.n);
          break;
        }
        case 'built':
          if (ev.how === 'demolish') sfx.play('smash', ev, 0.5);
          else sfx.play('build', ev);
          renderer.effects.dust(ev.x, ground(ev.x, ev.z), ev.z);
          if (mine(ev.id) && ev.how === 'upgrade') hud.flash(`${PIECES[ev.kind].label} upgraded!`, 1500);
          break;
        case 'smash': {
          sfx.play('smash', ev);
          const y = ground(ev.x, ev.z);
          renderer.effects.dust(ev.x, y, ev.z);
          renderer.effects.dust(ev.x + 0.6, y + 0.6, ev.z - 0.4);
          renderer.effects.pop(ev.x, y + 0.4, ev.z);
          const d = Math.hypot(ev.x - listener.x, ev.z - listener.z);
          if (d < 10) renderer.shake(0.3 * (1 - d / 10));
          break;
        }
        case 'chomp':
          sfx.play('chomp', ev, 0.7);
          break;
        case 'crafted': {
          const p = posOf(ev.id);
          sfx.play('crafted', p);
          renderer.effects.sparkle(p.x, p.y, p.z);
          if (mine(ev.id)) hud.flash(`Crafted: ${RECIPES[ev.recipe].label}!`, 1800);
          break;
        }
        case 'deny':
          if (!mine(ev.id)) break;
          sfx.play('deny', undefined, 0.6);
          if (this.ctx.openHud) this.ctx.openHud.deny(ev.why);
          else hud.flash(ev.why, 1800);
          break;
        case 'deposit': {
          const now = performance.now();
          sfx.play('deposit', posOf(ev.id), mine(ev.id) ? 0.9 : 0.5);
          if (mine(ev.id) && now > this.depositQuiet) {
            this.depositQuiet = now + 6000;
            hud.flash('Pack emptied into the stash', 1500);
          }
          break;
        }
        case 'respawn': {
          const p = posOf(ev.id);
          sfx.play('revived', p);
          renderer.effects.sparkle(p.x, p.y, p.z);
          if (mine(ev.id)) {
            const bed = snap.open?.survivors.find((s) => s.id === ev.id)?.bed ?? -1;
            hud.flash(bed >= 0 ? 'Respawned at your bed' : 'Respawned at the camp', 2500);
          } else hud.flash(`${name(ev.id)} is back on their feet`, 2000);
          break;
        }
        case 'siege': {
          sfx.play('siegeHorn');
          this.vibrate(200);
          // The horde's position is in the same snapshot; the event says where it's going.
          const s = snap.open?.siege;
          const from = s ? ` from the ${compass(s.x - ev.x, s.z - ev.z)}` : '';
          const eta = Math.round(ev.eta);
          hud.flash(
            ev.base ? `Siege incoming${from} in ${eta} s! Defend the base!` : `A horde is hunting you${from}! It gets here in ${eta} s`,
            4500,
          );
          break;
        }
        case 'siegeOver':
          sfx.play(ev.won ? 'rescued' : 'revived', undefined, 0.7);
          hud.flash(ev.won ? 'The siege is broken!' : 'The horde gave up and wandered off', 3000);
          break;
        case 'dawn':
          sfx.play('dawn', undefined, 0.8);
          hud.flash(ev.day > 1 ? `Day ${ev.day}: you made it through the night!` : `Day ${ev.day}`, 3000);
          break;
        case 'dusk':
          sfx.play('dusk', undefined, 0.8);
          hud.flash('Night falls… more zombies are about. Stay near a campfire.', 3500);
          break;
        case 'hungry':
          if (mine(ev.id)) hud.flash("You're hungry! Eat bamboo or cook a stew.", 2500);
          break;
        case 'bed':
          if (!mine(ev.id)) break;
          sfx.play('pickup', posOf(ev.id), 0.7);
          hud.flash("This bed is yours: you'll respawn here", 2500);
          break;
      }
    }
  }

  private vibrate(ms: number): void {
    if (!this.ctx.settings.vibration) return;
    try {
      navigator.vibrate?.(ms);
    } catch {
      // Not supported (e.g. iOS): ignore.
    }
  }
}
