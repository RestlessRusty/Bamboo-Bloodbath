import * as THREE from 'three';
import { CAMERA, DOWNED, SURVIVOR } from '../config';
import { clamp, damp, lerp, lerpAngle } from '../core/math';
import type { Quality } from '../settings';
import type { GameMap } from '../sim/gameMap';
import { OPEN } from '../sim/open/config';
import type { WorldMirror } from '../sim/open/mirror';
import type { GhostSpec } from '../sim/open/types';
import type { PandaVariant, PlayerSpec, Snapshot, SurvivorSnap, WeaponType, ZombieSnap } from '../sim/types';
import { Effects } from './effects';
import { HordeView } from './horde';
import { NameTag } from './nameTag';
import { OpenWorldView } from './open/OpenWorldView';
import { PANDA_LOOKS, PandaModel } from './pandaModel';
import { PickupsView } from './pickups';
import { Snowfall } from './snowfall';
import { StoryView } from './storyView';
import { disposeObject } from './toon';
import { buildWorld } from './world';

const RIPPLE_GEO = new THREE.RingGeometry(0.45, 0.62, 24).rotateX(-Math.PI / 2);
const ZOMBIE_LOOKS = [0xffffff, 0xe6f0d8, 0xf0e6dc, 0xdde6ea];
/** Open world before the first snapshot (or in the menu): a bright morning. */
const OPEN_DEFAULT_TIME = 0.2;
/** Snowfall starts once this much of the view is snowy highlands, and stops below SNOW_OFF. */
const SNOW_ON = 0.5;
const SNOW_OFF = 0.35;

/** What the scene holds as its world: a whole map (buildWorld) or the streamed open world. */
interface SceneWorld {
  readonly group: THREE.Group;
  update(dt: number, time: number, focusX: number, focusZ: number): void;
  dispose(): void;
}

interface SurvivorView {
  model: PandaModel;
  tag: NameTag;
  ripple: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

/** Name tag colour: you yellow, story characters pink, bots blue, other players white. */
const tagColor = (spec: PlayerSpec, localId: string) =>
  spec.id === localId ? '#ffe066' : spec.npc ? '#ffc2c2' : spec.bot ? '#cfe9ff' : '#ffffff';

export class Renderer {
  readonly effects: Effects;
  private readonly gl: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.5, 260);
  private readonly sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  private readonly hemi = new THREE.HemisphereLight(0xeaf7ff, 0x6f8f4a, 1.7);
  private readonly fog = new THREE.Fog(0xbfe8f7, 55, 130);
  private map: GameMap;
  private world: SceneWorld;
  /** The open world's view (also `world`), or null on a normal map. */
  private open: OpenWorldView | null = null;
  private openMirror: WorldMirror | null = null;
  private ghost: GhostSpec | null = null;
  /** Survivor positions (x, z pairs) for the open world's gates. */
  private readonly actorXZ = new Float32Array(16);
  private readonly horde = new HordeView();
  private pickups: PickupsView;
  private snow: Snowfall | null = null;
  private story: StoryView | null = null;
  private readonly views = new Map<string, SurvivorView>();
  private readonly zombieTags = new Map<number, NameTag>();
  private specs = new Map<string, PlayerSpec>();
  private readonly focus = new THREE.Vector3();
  private camDist = CAMERA.distance;
  private snapCamera = true;
  private shakeAmt = 0;
  private localPos: { x: number; z: number } | null = null;
  private showcase: PandaModel | null = null;
  /** Drag-to-spin for the showcase panda. */
  private spin = 0;
  private spinVel = 0;
  private spinPending = 0;
  private spinSway = 1;
  /** Idle sway phase; it pauses (rather than fading) while the panda is being spun. */
  private swayT = 0;
  private spinDrag: { id: number; x: number } | null = null;
  private time = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();

  constructor(container: HTMLElement, map: GameMap, quality: Quality) {
    this.gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.gl.domElement);

    this.map = map;
    this.scene.background = new THREE.Color();
    this.scene.fog = this.fog;
    this.scene.add(this.hemi);

    const shadow = this.sun.shadow;
    shadow.mapSize.set(1024, 1024);
    shadow.camera.left = -26;
    shadow.camera.right = 26;
    shadow.camera.top = 26;
    shadow.camera.bottom = -26;
    shadow.camera.near = 1;
    shadow.camera.far = 90;
    shadow.camera.updateProjectionMatrix();
    shadow.bias = -0.0004;
    shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    this.world = this.makeWorld(map);
    this.pickups = new PickupsView(map);
    this.effects = new Effects(map.terrain);
    this.scene.add(this.world.group, this.pickups.group, this.horde.group, this.effects.group);
    this.applyTheme();

    this.setQuality(quality);
    window.addEventListener('resize', () => this.resize());
    this.bindShowcaseDrag();
  }

  /** Drag on the 3D view (or a modal's backdrop) to spin the showcase panda. */
  private bindShowcaseDrag(): void {
    const canvas = this.gl.domElement;
    window.addEventListener('pointerdown', (e) => {
      if (!this.showcase || this.spinDrag || e.button !== 0) return;
      const t = e.target as Element;
      if (t !== canvas && !t.classList?.contains('modal')) return;
      this.spinDrag = { id: e.pointerId, x: e.clientX };
      document.body.classList.add('spinning');
    });
    window.addEventListener('pointermove', (e) => {
      const d = this.spinDrag;
      if (!d || e.pointerId !== d.id) return;
      // The button-up can go missing (context menu, alt-tab): a move with nothing held ends the drag.
      if (e.buttons === 0) return this.endSpinDrag();
      this.spinPending += (e.clientX - d.x) * 0.012;
      d.x = e.clientX;
    });
    const end = (e: PointerEvent) => {
      if (this.spinDrag && e.pointerId === this.spinDrag.id) this.endSpinDrag();
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', () => this.endSpinDrag());
  }

  private endSpinDrag(): void {
    this.spinDrag = null;
    document.body.classList.remove('spinning');
  }

  get currentMap(): GameMap {
    return this.map;
  }

  /** Swap the whole world for another map (between matches). */
  setMap(map: GameMap): void {
    if (map === this.map) return;
    this.clearPlayers();
    this.scene.remove(this.world.group, this.pickups.group);
    this.world.dispose();
    disposeObject(this.pickups.group);

    this.map = map;
    this.world = this.makeWorld(map);
    this.pickups = new PickupsView(map);
    this.effects.reset(map.terrain);
    this.scene.add(this.world.group, this.pickups.group);
    this.applyTheme();

    if (this.showcase) this.placeShowcase(this.showcase);
    this.snapCamera = true;
  }

  /** A normal map is built whole; the open world streams (`open`) with its mirror and ghost carried over. */
  private makeWorld(map: GameMap): SceneWorld {
    if (map.open) {
      const view = new OpenWorldView(map);
      this.open = view;
      // Only this world's mirror: one left over from another world would put its pieces here.
      if (this.openMirror && this.openMirror.map.open?.seed === map.open.seed) view.setMirror(this.openMirror);
      view.setGhost(this.ghost);
      return view;
    }
    this.open = null;
    const w = buildWorld(map);
    return { group: w.group, update: (dt, time) => w.update(dt, time), dispose: () => disposeObject(w.group) };
  }

  /**
   * Infinite mode: the world as every client knows it (pieces, depleted nodes, opened crates, loot bags).
   * Set after setMap with the open world; null when the match ends.
   */
  setOpenMirror(m: WorldMirror | null): void {
    this.openMirror = m;
    if (!this.open) return;
    const world = this.map.open;
    this.open.setMirror(m && world && m.map.open?.seed === world.seed ? m : null);
  }

  /** Infinite mode's build preview on its tile (null: none). */
  setGhost(g: GhostSpec | null): void {
    this.ghost = g;
    this.open?.setGhost(g);
  }

  private applyTheme(): void {
    if (this.open) {
      // The open world's light follows the biome and the clock (applyOpenSky, every frame).
      this.open.sky.reset();
      this.applyOpenSky(0, this.map.layout.start.x, this.map.layout.start.z, OPEN_DEFAULT_TIME);
      return;
    }
    const t = this.map.layout.theme;
    (this.scene.background as THREE.Color).setHex(t.sky);
    this.fog.color.setHex(t.sky);
    this.fog.near = t.fogNear;
    this.fog.far = t.fogFar;
    this.hemi.color.setHex(t.hemiSky);
    this.hemi.groundColor.setHex(t.hemiGround);
    this.hemi.intensity = t.hemiIntensity;
    this.sun.color.setHex(t.sun);
    this.sun.intensity = t.sunIntensity;

    if (t.snowfall && !this.snow) {
      this.snow = new Snowfall();
      this.scene.add(this.snow.points);
    } else if (!t.snowfall && this.snow) {
      this.scene.remove(this.snow.points);
      this.snow.dispose();
      this.snow = null;
    }
  }

  /** The open world's light (biomes under the focus, time of day) into the scene; snowfall only in the snow. */
  private applyOpenSky(dt: number, fx: number, fz: number, time: number): void {
    if (!this.open) return;
    const s = this.open.sky;
    s.update(dt, fx, fz, time);
    (this.scene.background as THREE.Color).copy(s.sky);
    this.fog.color.copy(s.sky);
    this.fog.near = s.fogNear;
    this.fog.far = s.fogFar;
    this.hemi.color.copy(s.hemiSky);
    this.hemi.groundColor.copy(s.hemiGround);
    this.hemi.intensity = s.hemiIntensity;
    this.sun.color.copy(s.sun);
    this.sun.intensity = s.sunIntensity;
    if (s.snow > SNOW_ON && !this.snow) {
      this.snow = new Snowfall();
      this.scene.add(this.snow.points);
    } else if (s.snow < SNOW_OFF && this.snow) {
      this.scene.remove(this.snow.points);
      this.snow.dispose();
      this.snow = null;
    }
    this.snow?.setStrength(clamp((s.snow - SNOW_OFF) / 0.35, 0, 1));
  }

  setQuality(quality: Quality): void {
    const high = quality === 'high';
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1));
    if (this.gl.shadowMap.enabled !== high) {
      this.gl.shadowMap.enabled = high;
      this.sun.castShadow = high;
      // Shadow support is compiled into shaders, so force a recompile.
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
      });
    }
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gl.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.gl.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------ in-game

  setPlayers(specs: readonly PlayerSpec[], localId: string): void {
    this.clearPlayers();
    this.specs = new Map(specs.map((s) => [s.id, s]));
    for (const spec of specs) {
      const model = new PandaModel(spec.variant, spec.weapon);
      const tag = new NameTag(spec.name, tagColor(spec, localId));
      const ripple = new THREE.Mesh(
        RIPPLE_GEO,
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }),
      );
      ripple.visible = false;
      this.scene.add(model.root, tag.sprite, ripple);
      this.views.set(spec.id, { model, tag, ripple });
    }
    this.snapCamera = true;
  }

  /** Mid-match team change (someone took over a bot, or left): new name tags where name or bot flag changed. */
  updateSpecs(specs: readonly PlayerSpec[], localId: string): void {
    for (const spec of specs) {
      const old = this.specs.get(spec.id);
      const v = this.views.get(spec.id);
      if (!v || (old && old.name === spec.name && old.bot === spec.bot)) continue;
      this.scene.remove(v.tag.sprite);
      v.tag.dispose();
      v.tag = new NameTag(spec.name, tagColor(spec, localId));
      this.scene.add(v.tag.sprite);
    }
    this.specs = new Map(specs.map((s) => [s.id, s]));
  }

  clearPlayers(): void {
    for (const v of this.views.values()) {
      this.scene.remove(v.model.root, v.tag.sprite, v.ripple);
      v.tag.dispose();
      v.ripple.material.dispose();
    }
    this.views.clear();
    for (const tag of this.zombieTags.values()) {
      this.scene.remove(tag.sprite);
      tag.dispose();
    }
    this.zombieTags.clear();
    this.horde.update(0, [], [], 1, this.time, () => undefined);
    this.localPos = null;
    if (this.story) {
      this.scene.remove(this.story.group);
      this.story.dispose();
      this.story = null;
    }
  }

  /** Draws the world between two snapshots (`alpha` 0..1). */
  updateGame(dt: number, prev: Snapshot, curr: Snapshot, alpha: number, localId: string): void {
    this.time += dt;
    const prevById = new Map<string, SurvivorSnap>(prev.survivors.map((s) => [s.id, s]));
    let focus: { x: number; y: number; z: number } | null = null;
    let fallback: { x: number; y: number; z: number } | null = null;
    this.localPos = null;
    // Infinite mode bleeds out slower (then you respawn at your bed).
    const bleedTime = curr.open ? OPEN.bleedTime : DOWNED.bleedTime;
    let actors = 0;

    for (const s of curr.survivors) {
      const v = this.views.get(s.id);
      if (!v) continue;
      const visible = s.state === 'active' || s.state === 'downed';
      v.model.root.visible = visible;
      v.tag.sprite.visible = visible;
      v.ripple.visible = false;
      if (!visible) continue;

      const p = prevById.get(s.id) ?? s;
      const x = lerp(p.x, s.x, alpha);
      const y = lerp(p.y, s.y, alpha);
      const z = lerp(p.z, s.z, alpha);
      v.model.root.position.set(x, y, z);
      v.model.root.rotation.y = lerpAngle(p.rot, s.rot, alpha);
      v.model.setWeapon(s.weapon);
      v.model.setWeaponVisible(s.weapon !== 'javelin' || s.ammo > 0 || s.attackT >= 0);
      v.model.update(dt, { speed: s.speed, attackT: s.attackT, dashing: s.dashing, downed: s.state === 'downed', hurt: s.hurt });
      // Hidden in bamboo: a little see-through to show it.
      v.model.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.visible = !s.hidden || Math.sin(this.time * 6) > -0.3;
      });

      v.tag.sprite.position.set(x, y + (s.state === 'downed' ? 1.3 : 2.0), z);
      v.tag.update(s.hp / SURVIVOR.maxHp, s.state === 'downed', s.bleed / bleedTime);
      if (actors * 2 < this.actorXZ.length) {
        this.actorXZ[actors * 2] = x;
        this.actorXZ[actors * 2 + 1] = z;
        actors++;
      }

      if (s.inWater) {
        v.ripple.visible = true;
        v.ripple.position.set(x, this.map.terrain.waterLevel + 0.02, z);
        v.ripple.scale.setScalar(1 + 0.15 * Math.sin(this.time * 6));
      }

      if (s.id === localId) {
        focus = { x, y, z };
        this.localPos = { x, z };
      } else if (!fallback && s.state === 'active') {
        fallback = { x, y, z };
      }
    }

    this.horde.update(dt, prev.zombies, curr.zombies, alpha, this.time, (zs, out) => this.zombieTint(zs, out));
    this.updateZombieTags(prev.zombies, curr.zombies, alpha);
    this.pickups.update(this.time, prev, curr, alpha, this.focus);
    this.effects.update(dt);
    if (curr.story) {
      if (!this.story) {
        this.story = new StoryView(this.map);
        this.scene.add(this.story.group);
      }
      this.story.update(this.time, curr.story);
    }

    const f = focus ?? fallback;
    if (this.open && this.snapCamera) {
      // A new camera (match start, or a jump): ground right away under it, light without easing in.
      const p = f ?? this.map.layout.goal;
      this.open.prime(p.x, p.z);
      this.open.sky.reset();
    }
    if (f) this.updateCamera(dt, f.x, f.y, f.z);
    else {
      const { goal } = this.map.layout;
      this.updateCamera(dt, goal.x, this.map.terrain.heightAt(goal.x, goal.z), goal.z);
    }
    if (this.open) {
      this.applyOpenSky(dt, this.focus.x, this.focus.z, curr.open?.time ?? OPEN_DEFAULT_TIME);
      this.open.setActors(this.actorXZ, actors);
    }
    this.world.update(dt, this.time, this.focus.x, this.focus.z);
    this.snow?.update(dt, this.time, this.focus.x, this.focus.y, this.focus.z);
  }

  /** Last rendered position of the local panda (for tap-to-move). */
  localPlayerPos(): { x: number; z: number } | null {
    return this.localPos;
  }

  /** Where the camera is looking (sounds are heard from here). */
  listenerPos(): { x: number; z: number } {
    return { x: this.focus.x, z: this.focus.z };
  }

  shake(amount: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  /** Ray-marches the height field: cheaper than raycasting 40k triangles. */
  screenToGround(clientX: number, clientY: number): { x: number; z: number } | null {
    this.pointer.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const { origin, direction } = this.raycaster.ray;
    const terrain = this.map.terrain;
    const above = (t: number) => origin.y + direction.y * t - terrain.heightAt(origin.x + direction.x * t, origin.z + direction.z * t);
    let prevT = 0;
    for (let t = 0.5; t < 220; t += 0.5) {
      if (above(t) <= 0) {
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          if (above(mid) > 0) lo = mid;
          else hi = mid;
        }
        return { x: origin.x + direction.x * hi, z: origin.z + direction.z * hi };
      }
      prevT = t;
    }
    return null;
  }

  private zombieTint(z: ZombieSnap, out: THREE.Color): void {
    const spec = z.from ? this.specs.get(z.from) : undefined;
    out.set(spec ? PANDA_LOOKS[spec.variant].zombieTint : ZOMBIE_LOOKS[z.look % ZOMBIE_LOOKS.length]);
  }

  /** Former teammates keep their name above their head, in zombie green. */
  private updateZombieTags(prev: readonly ZombieSnap[], curr: readonly ZombieSnap[], alpha: number): void {
    const seen = new Set<number>();
    for (const z of curr) {
      if (!z.from || z.state === 'dying') continue;
      const spec = this.specs.get(z.from);
      if (!spec) continue;
      seen.add(z.id);
      let tag = this.zombieTags.get(z.id);
      if (!tag) {
        tag = new NameTag(`Zombie ${spec.name}`, '#9be36a');
        this.zombieTags.set(z.id, tag);
        this.scene.add(tag.sprite);
      }
      const p = prev.find((o) => o.id === z.id) ?? z;
      tag.sprite.position.set(lerp(p.x, z.x, alpha), lerp(p.y, z.y, alpha) + 2, lerp(p.z, z.z, alpha));
    }
    for (const [id, tag] of this.zombieTags) {
      if (seen.has(id)) continue;
      this.scene.remove(tag.sprite);
      tag.dispose();
      this.zombieTags.delete(id);
    }
  }

  private updateCamera(dt: number, fx: number, fy: number, fz: number): void {
    const k = this.snapCamera ? 1 : damp(CAMERA.follow, dt);
    this.focus.set(lerp(this.focus.x, fx, k), lerp(this.focus.y, fy, k), lerp(this.focus.z, fz, k));

    // Zoom out on hills so you can see further.
    const peak = this.map.terrain.peak();
    const want = peak > 2 ? CAMERA.distance * (1 + CAMERA.hillZoom * clamp((fy - 1) / (peak - 1), 0, 1)) : CAMERA.distance;
    this.camDist = this.snapCamera ? want : lerp(this.camDist, want, damp(2.5, dt));
    this.snapCamera = false;

    const pitch = THREE.MathUtils.degToRad(CAMERA.pitchDeg);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.5);
    const sx = (Math.random() - 0.5) * this.shakeAmt;
    const sz = (Math.random() - 0.5) * this.shakeAmt;
    this.camera.position.set(
      this.focus.x + sx,
      this.focus.y + Math.sin(pitch) * this.camDist,
      this.focus.z + Math.cos(pitch) * this.camDist + sz,
    );
    this.camera.lookAt(this.focus.x + sx, this.focus.y + 0.6, this.focus.z + sz);
    this.placeSun(this.focus);
  }

  private placeSun(f: THREE.Vector3): void {
    this.sun.position.set(f.x + 14, f.y + 30, f.z + 10);
    this.sun.target.position.copy(f);
  }

  // ------------------------------------------------------------ menu showcase

  /** Swaps the model only: an ongoing drag or coasting spin carries over to the new panda. */
  setShowcase(variant: PandaVariant, weapon: WeaponType): void {
    if (this.showcase) this.scene.remove(this.showcase.root);
    const m = new PandaModel(variant, weapon);
    this.placeShowcase(m);
    this.scene.add(m.root);
    this.showcase = m;
    document.body.classList.add('showcase');
  }

  private placeShowcase(m: PandaModel): void {
    const { start } = this.map.layout;
    m.root.position.set(start.x, this.map.terrain.heightAt(start.x, start.z), start.z);
  }

  clearShowcase(): void {
    if (this.showcase) this.scene.remove(this.showcase.root);
    this.showcase = null;
    this.endSpinDrag();
    this.spinVel = 0;
    this.spinPending = 0;
    document.body.classList.remove('showcase');
  }

  updateShowcase(dt: number): void {
    this.time += dt;
    this.world.update(dt, this.time, this.focus.x, this.focus.z);
    this.effects.update(dt);
    const m = this.showcase;
    if (!m) return;

    const yaw = 0.55;
    const p = m.root.position;
    this.snow?.update(dt, this.time, p.x, p.y, p.z);
    // While dragged the panda follows the pointer; let go and it coasts to a stop.
    // Movement that arrived after the button-up still counts.
    this.spin += this.spinPending;
    if (this.spinDrag) {
      if (dt > 0) this.spinVel = lerp(this.spinVel, this.spinPending / dt, damp(15, dt));
    } else {
      this.spin += this.spinVel * dt;
      this.spinVel *= Math.exp(-3 * dt);
    }
    this.spinPending = 0;
    const settled = !this.spinDrag && Math.abs(this.spinVel) < 0.3;
    this.spinSway = lerp(this.spinSway, settled ? 1 : 0, damp(3, dt));
    this.swayT += dt * this.spinSway;
    m.root.rotation.y = yaw + this.spin + Math.sin(this.swayT * 0.6) * 0.5;
    const cycle = this.time % 4;
    m.update(dt, { speed: 0, attackT: cycle > 3 && cycle < 3.6 ? (cycle - 3) / 0.6 : -1, dashing: false, downed: false, hurt: 0 });

    const dist = 5.2;
    this.camera.position.set(p.x + Math.sin(yaw) * dist, p.y + 2.3, p.z + Math.cos(yaw) * dist);
    // Aim left of the panda so it stands on the right, beside the menu panel.
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    this.camera.lookAt(p.x - rightX * 1.7, p.y + 0.9, p.z - rightZ * 1.7);
    this.placeSun(p);
  }
}
