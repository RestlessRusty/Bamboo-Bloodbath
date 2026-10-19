import * as THREE from 'three';
import type { GameMap } from '../sim/gameMap';
import { GroundPalette, terrainColor } from './world';

const CELLS = 40;
const tmp = new THREE.Color();

/** Top-down overview of a map (north up) with the camp and the rescue hut; `null` draws a "?" card. */
export function drawMinimap(canvas: HTMLCanvasElement, map: GameMap | null): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (!map) {
    ctx.fillStyle = '#e9dcc0';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2b1e1a';
    ctx.font = `bold ${Math.round(h * 0.6)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', w / 2, h / 2 + h * 0.04);
    return;
  }

  const { layout, terrain } = map;
  const pal = new GroundPalette(map);
  const water = new THREE.Color(layout.theme.water);
  const shallow = water.clone().lerp(new THREE.Color(layout.theme.ground.shore), 0.5);
  const ice = new THREE.Color(layout.theme.ice ?? 0xd3ecf6);
  const half = layout.size / 2;
  const cw = w / CELLS;
  const ch = h / CELLS;
  for (let j = 0; j < CELLS; j++) {
    for (let i = 0; i < CELLS; i++) {
      const x = -half + ((i + 0.5) / CELLS) * layout.size;
      const z = -half + ((j + 0.5) / CELLS) * layout.size;
      const y = terrain.heightAt(x, z);
      if (terrain.isWater(x, z)) tmp.copy(water);
      else if (terrain.isWet(x, z)) tmp.copy(shallow);
      else if (terrain.isIce(x, z)) tmp.copy(ice);
      else terrainColor(map, pal, x, y, z, tmp);
      ctx.fillStyle = `#${tmp.getHexString()}`;
      ctx.fillRect(Math.floor(i * cw), Math.floor(j * ch), Math.ceil(cw), Math.ceil(ch));
    }
  }

  const px = (x: number) => ((x + half) / layout.size) * w;
  const pz = (z: number) => ((z + half) / layout.size) * h;
  const r = Math.max(3, w * 0.06);

  // Bridges.
  ctx.strokeStyle = '#8b5a3c';
  ctx.lineWidth = Math.max(2, w * 0.04);
  for (const c of terrain.crossings) {
    if (c.kind !== 'bridge') continue;
    ctx.beginPath();
    ctx.moveTo(px(c.a.x), pz(c.a.z));
    ctx.lineTo(px(c.b.x), pz(c.b.z));
    ctx.stroke();
  }

  // Dashed line along the route from the camp to the hut.
  ctx.strokeStyle = 'rgba(43, 30, 26, 0.6)';
  ctx.lineWidth = Math.max(1, w * 0.015);
  ctx.setLineDash([r * 0.6, r * 0.6]);
  ctx.beginPath();
  map.route.pts.forEach((p, i) => (i ? ctx.lineTo(px(p.x), pz(p.z)) : ctx.moveTo(px(p.x), pz(p.z))));
  ctx.stroke();
  ctx.setLineDash([]);

  const dot = (x: number, z: number, fill: string) => {
    ctx.beginPath();
    ctx.arc(px(x), pz(z), r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, w * 0.025);
    ctx.strokeStyle = '#2b1e1a';
    ctx.stroke();
  };
  dot(layout.start.x, layout.start.z, '#f28c48');
  dot(layout.goal.x, layout.goal.z, '#ffe066');
}
