import * as THREE from 'three';
import { CAMERA, DOWNED, SURVIVOR } from '../config';
import { clamp, damp, lerp, lerpAngle } from '../core/math';
import type { Quality } from '../settings';
import type { GameMap } from '../sim/gameMap';
import type { PandaVariant, PlayerSpec, Snapshot, SurvivorSnap, WeaponType, ZombieSnap } from '../sim/types';
import { Effects } from './effects';
import { HordeView } from './horde';
import { NameTag } from './nameTag';
import { PANDA_LOOKS, PandaModel } from './pandaModel';
import { PickupsView } from './pickups';
import { Snowfall } from './snowfall';
import { StoryView } from './storyView';
import { disposeObject } from './toon';
import { buildWorld, type WorldView } from './world';

const RIPPLE_GEO = new THREE.RingGeometry(0.45, 0.62, 24).rotateX(-Math.PI / 2);
const ZOMBIE_LOOKS = [0xffffff, 0xe6f0d8, 0xf0e6dc, 0xdde6ea];

interface SurvivorView {
  model: PandaModel;
  tag: NameTag;
  ripple: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

export class Renderer {
  readonly effects: Effects;
  private readonly gl: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.5, 260);
  private readonly sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  private readonly hemi = new THREE.HemisphereLight(0xeaf7ff, 0x6f8f4a, 1.7);
  private readonly fog = new THREE.Fog(0xbfe8f7, 55, 130);
  private map: GameMap;
  private world: WorldView;
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

    this.world = buildWorld(map);
    this.pickups = new PickupsView(map);
    this.effects = new Effects(map.terrain);
    this.scene.add(this.world.group, this.pickups.group, this.horde.group, this.effects.group);
    this.applyTheme();

    this.setQuality(quality);
    window.addEventListener('resize', () => this.resize());
  }

  get currentMap(): GameMap {
    return this.map;
  }

  /** Swap the whole world for another map (between matches). */
  setMap(map: GameMap): void {
    if (map === this.map) return;
    this.clearPlayers();
    this.scene.remove(this.world.group, this.pickups.group);
    disposeObject(this.world.group);
    disposeObject(this.pickups.group);

    this.map = map;
    this.world = buildWorld(map);
    this.pickups = new PickupsView(map);
    this.effects.reset(map.terrain);
    this.scene.add(this.world.group, this.pickups.group);
    this.applyTheme();

    if (this.showcase) this.placeShowcase(this.showcase);
    this.snapCamera = true;
  }

  private applyTheme(): void {
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
      const tag = new NameTag(spec.name, spec.id === localId ? '#ffe066' : spec.npc ? '#ffc2c2' : spec.bot ? '#cfe9ff' : '#ffffff');
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
      v.tag.update(s.hp / SURVIVOR.maxHp, s.state === 'downed', s.bleed / DOWNED.bleedTime);

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
    this.pickups.update(this.time, prev, curr, alpha);
    this.effects.update(dt);
    if (curr.story) {
      if (!this.story) {
        this.story = new StoryView(this.map);
        this.scene.add(this.story.group);
      }
      this.story.update(this.time, curr.story);
    }

    const f = focus ?? fallback;
    if (f) this.updateCamera(dt, f.x, f.y, f.z);
    else {
      const { goal } = this.map.layout;
      this.updateCamera(dt, goal.x, this.map.terrain.heightAt(goal.x, goal.z), goal.z);
    }
    this.world.update(dt, this.time);
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

  setShowcase(variant: PandaVariant, weapon: WeaponType): void {
    this.clearShowcase();
    const m = new PandaModel(variant, weapon);
    this.placeShowcase(m);
    this.scene.add(m.root);
    this.showcase = m;
  }

  private placeShowcase(m: PandaModel): void {
    const { start } = this.map.layout;
    m.root.position.set(start.x, this.map.terrain.heightAt(start.x, start.z), start.z);
  }

  clearShowcase(): void {
    if (this.showcase) this.scene.remove(this.showcase.root);
    this.showcase = null;
  }

  updateShowcase(dt: number): void {
    this.time += dt;
    this.world.update(dt, this.time);
    this.effects.update(dt);
    const m = this.showcase;
    if (!m) return;

    const yaw = 0.55;
    const p = m.root.position;
    this.snow?.update(dt, this.time, p.x, p.y, p.z);
    m.root.rotation.y = yaw + Math.sin(this.time * 0.6) * 0.5;
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
