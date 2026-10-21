import type { Sfx } from '../audio/Sfx';
import type { Renderer } from '../render/Renderer';
import type { Settings } from '../settings';
import { WATER_LEVEL } from '../sim/terrain';
import type { GameEvent, PlayerSpec, Snapshot } from '../sim/types';
import { WEAPONS } from '../sim/weapons';
import type { Hud } from '../ui/Hud';
import type { StoryHud } from '../ui/StoryHud';

export interface PresentContext {
  renderer: Renderer;
  hud: Hud;
  sfx: Sfx;
  settings: Settings;
  /** Story objective and dialogue (only shows anything during story chapters). */
  story?: StoryHud;
}

/** Turns simulation events into sounds, particles, screen shake, vibration and HUD messages. */
export class Presenter {
  private names: Map<string, string>;

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
