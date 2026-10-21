import { DIFFICULTIES, DIFFICULTY } from '../config';
import { BOT_COUNTS, getRecord, type MapRecord } from '../records';
import type { Settings } from '../settings';
import { MAP_IDS, mapInfo } from '../sim/maps';
import { el, formatTime, markActive } from './dom';

type Stat = 'time' | 'kills';

const botLabel = (n: number) => `${n} bot${n === 1 ? '' : 's'}`;
const NONE = '<span class="rec-none">–</span>';

function cellHtml(r: MapRecord, stat: Stat): string {
  if (r.plays === 0) return NONE;
  if (stat === 'kills') return `<b>${r.mostKills}</b><small>${r.plays} played</small>`;
  const best = r.bestTime !== null ? `<b>${formatTime(r.bestTime)}</b>` : NONE;
  return `${best}<small>won ${r.wins}/${r.plays}</small>`;
}

/** "Records" card: one map's best times or most kills, per difficulty (rows) and bot buddies (columns). */
export class RecordsCard {
  private readonly el: HTMLDivElement;
  private mapId = MAP_IDS[0];
  private stat: Stat = 'time';

  constructor(
    parent: HTMLElement,
    private readonly settings: Settings,
  ) {
    this.el = el(
      'div',
      'modal',
      `<div class="card records">
        <h2>Records</h2>
        <div class="records-controls">
          <div class="map-row">
            <button class="arrow-btn" data-map="-1" aria-label="Previous map">‹</button>
            <b data-ref="map"></b>
            <button class="arrow-btn" data-map="1" aria-label="Next map">›</button>
          </div>
          <div class="seg" data-ref="stat">
            <button data-v="time">Best time</button>
            <button data-v="kills">Most kills</button>
          </div>
        </div>
        <div class="records-wrap">
          <table class="records-table">
            <thead><tr><th></th>${BOT_COUNTS.map((n) => `<th>${botLabel(n)}</th>`).join('')}</tr></thead>
            <tbody data-ref="rows"></tbody>
          </table>
        </div>
        <p class="hint small">Quick play and multiplayer on this device. Highlighted: your current setup.</p>
        <div class="card-foot">
          <button class="btn primary" data-act="close">Close</button>
        </div>
      </div>`,
    );
    this.el.hidden = true;
    parent.appendChild(this.el);

    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-map],[data-v],[data-act]');
      if (!t) return;
      if (t.dataset.act === 'close') return this.close();
      if (t.dataset.map) {
        const n = MAP_IDS.length;
        this.mapId = MAP_IDS[(MAP_IDS.indexOf(this.mapId) + (Number(t.dataset.map) || 0) + n) % n];
      } else if (t.dataset.v) {
        this.stat = t.dataset.v as Stat;
      }
      this.refresh();
    });
  }

  /** Opens on the map picked in the menu ("random" keeps the last one shown). */
  open(): void {
    if (MAP_IDS.includes(this.settings.map)) this.mapId = this.settings.map;
    this.refresh();
    this.el.hidden = false;
  }

  close(): void {
    this.el.hidden = true;
  }

  private refresh(): void {
    this.ref('map').textContent = mapInfo(this.mapId).name;
    markActive(this.ref('stat'), this.stat);
    const { difficulty, bots } = this.settings;
    this.ref('rows').innerHTML = DIFFICULTIES.map((d) => {
      const cells = BOT_COUNTS.map((n) => {
        const current = d === difficulty && n === bots ? ' class="current"' : '';
        return `<td${current}>${cellHtml(getRecord(this.mapId, d, n), this.stat)}</td>`;
      }).join('');
      return `<tr><th>${DIFFICULTY[d].label}</th>${cells}</tr>`;
    }).join('');
  }

  private ref<T extends HTMLElement = HTMLElement>(name: string): T {
    return this.el.querySelector<T>(`[data-ref="${name}"]`)!;
  }
}
