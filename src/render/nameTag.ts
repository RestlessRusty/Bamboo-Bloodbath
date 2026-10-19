import * as THREE from 'three';

const W = 320;
const H = 104;

/** Floating name label with an optional health / bleed-out bar, redrawn only when it changes. */
export class NameTag {
  readonly sprite: THREE.Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private key = '';

  constructor(
    private readonly name: string,
    private readonly color: string,
  ) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, depthTest: false, transparent: true, fog: false }));
    this.sprite.scale.set(2.2, (2.2 * H) / W, 1);
    this.sprite.renderOrder = 10;
    this.update(null, false, 0);
  }

  /** `bar` = health 0..1 (null hides it); when downed, `bleed` 0..1 is shown instead. */
  update(bar: number | null, downed: boolean, bleed: number): void {
    const key = downed ? `d${Math.ceil(bleed * 20)}` : bar === null ? 'n' : `h${Math.round(bar * 20)}`;
    if (key === this.key) return;
    this.key = key;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    const text = downed ? 'HELP!' : this.name;
    let size = 44;
    ctx.font = `600 ${size}px Fredoka, "Trebuchet MS", sans-serif`;
    while (ctx.measureText(text).width > W - 24 && size > 20) {
      size -= 2;
      ctx.font = `600 ${size}px Fredoka, "Trebuchet MS", sans-serif`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(43, 30, 26, 0.85)';
    ctx.strokeText(text, W / 2, 36);
    ctx.fillStyle = downed ? '#ff5a5a' : this.color;
    ctx.fillText(text, W / 2, 36);

    const value = downed ? bleed : bar;
    if (value !== null) {
      const bw = 150;
      const bx = (W - bw) / 2;
      ctx.fillStyle = 'rgba(43, 30, 26, 0.85)';
      ctx.beginPath();
      ctx.roundRect(bx - 4, 72, bw + 8, 20, 8);
      ctx.fill();
      ctx.fillStyle = downed ? '#ff5a5a' : value > 0.5 ? '#7cd65a' : value > 0.25 ? '#f2b82e' : '#e2463f';
      ctx.beginPath();
      ctx.roundRect(bx, 76, Math.max(4, bw * value), 12, 6);
      ctx.fill();
    }
    this.tex.needsUpdate = true;
  }

  dispose(): void {
    this.tex.dispose();
    this.sprite.material.dispose();
  }
}
