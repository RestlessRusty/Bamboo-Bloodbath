import { isValidPick, pickInfo, previewMap, type MapPick } from '../game/maps';
import { drawMinimap } from '../render/minimap';
import { el } from './dom';

/** Map choice with a mini-map, used in the main menu and the room lobby. */
export class MapPicker {
  readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly name: HTMLElement;
  private readonly blurb: HTMLElement;
  private shown: MapPick | null = null;

  constructor(onCycle: (dir: number) => void) {
    this.el = el(
      'div',
      'map-picker',
      `<canvas class="map-mini" width="80" height="80"></canvas>
      <div class="map-info">
        <div class="map-row">
          <button class="arrow-btn" data-map="-1" aria-label="Previous map">‹</button>
          <b></b>
          <button class="arrow-btn" data-map="1" aria-label="Next map">›</button>
        </div>
        <p class="hint small"></p>
      </div>`,
    );
    this.canvas = this.el.querySelector('canvas')!;
    this.name = this.el.querySelector('b')!;
    this.blurb = this.el.querySelector('p')!;
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-map]');
      if (b && !b.disabled) onCycle(Number(b.dataset.map) || 0);
    });
  }

  /** Show a pick; arrows only when this player may change it. */
  set(pick: MapPick, editable: boolean): void {
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-map]')) b.hidden = !editable;
    if (pick === this.shown) return;
    this.shown = pick;
    const valid = isValidPick(pick);
    const info = valid ? pickInfo(pick) : { name: '…', blurb: '' };
    this.name.textContent = info.name;
    this.blurb.textContent = info.blurb;
    drawMinimap(this.canvas, valid ? previewMap(pick) : null);
  }
}
