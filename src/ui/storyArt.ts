import type { StoryArt } from '../sim/story/types';

/** Small cartoon pictures for the story cards (inline SVG, 160×90, ink outlines). */

const INK = 'stroke="#2b1e1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';

const frame = (bg: string, body: string) =>
  `<svg viewBox="0 0 160 90" aria-hidden="true"><rect x="2" y="2" width="156" height="86" rx="14" fill="${bg}" ${INK}/>${body}</svg>`;

const ART: Record<StoryArt, string> = {
  radio: frame(
    '#ffe2bf',
    `<path d="M4 70 Q80 60 156 70 L156 76 Q156 86 146 86 L14 86 Q4 86 4 76Z" fill="#d9b25a"/>
    <circle cx="28" cy="58" r="12" fill="#e8742c" ${INK}/><rect x="26" y="66" width="4" height="10" fill="#6e4630"/>
    <circle cx="134" cy="56" r="14" fill="#d9542a" ${INK}/><rect x="132" y="66" width="4" height="10" fill="#6e4630"/>
    <rect x="58" y="50" width="34" height="22" fill="#9a6a3a" ${INK}/><rect x="54" y="46" width="42" height="6" fill="#6b4423" ${INK}/>
    <rect x="66" y="58" width="9" height="14" fill="#4a2e18"/>
    <path d="M84 46 L88 12 L92 46 M85 36 L91 36 M86 24 L90 24" fill="none" ${INK}/>
    <circle cx="88" cy="10" r="3" fill="#ff3b30" ${INK}/>
    <path d="M98 12 Q104 6 98 0 M104 16 Q114 6 104 -4 M78 12 Q72 6 78 0" fill="none" stroke="#e2463f" stroke-width="3" stroke-linecap="round"/>`,
  ),
  clinic: frame(
    '#cdeefc',
    `<path d="M4 64 Q50 56 80 62 T156 60 L156 72 Q110 66 80 72 T4 74Z" fill="#47aee0" ${INK}/>
    <path d="M4 74 Q80 70 156 72 L156 76 Q156 86 146 86 L14 86 Q4 86 4 76Z" fill="#8fd46a"/>
    <rect x="56" y="30" width="48" height="28" fill="#f4f1ea" ${INK}/>
    <path d="M50 32 L80 12 L110 32Z" fill="#d8463f" ${INK}/>
    <rect x="74" y="42" width="12" height="16" fill="#6b4423"/>
    <rect x="76" y="31" width="8" height="3" fill="#e2463f"/><rect x="78.5" y="28.5" width="3" height="8" fill="#e2463f"/>
    <path d="M24 60 Q22 40 30 30 Q34 44 32 60" fill="#86c94f" ${INK}/>
    <path d="M132 58 Q130 38 138 28 Q142 42 140 58" fill="#86c94f" ${INK}/>`,
  ),
  mountain: frame(
    '#cfe0ee',
    `<path d="M4 80 L46 22 L72 54 L98 16 L156 80Z" fill="#858996" ${INK}/>
    <path d="M38 33 L46 22 L54 33 L49 30 L44 34Z M90 27 L98 16 L106 27 L101 24 L95 28Z" fill="#fff"/>
    <path d="M4 76 Q80 68 156 76 L156 76 Q156 86 146 86 L14 86 Q4 86 4 76Z" fill="#f2f7fb" ${INK}/>
    <g fill="#ff8fc4" ${INK}><path d="M80 70 Q72 58 80 52 Q88 58 80 70Z"/><path d="M80 70 Q66 64 68 56 Q78 58 80 70Z"/><path d="M80 70 Q94 64 92 56 Q82 58 80 70Z"/></g>
    <g fill="#fff"><circle cx="20" cy="18" r="2.5"/><circle cx="130" cy="40" r="2.5"/><circle cx="66" cy="14" r="2"/><circle cx="142" cy="16" r="2"/><circle cx="28" cy="48" r="2"/></g>`,
  ),
  fen: frame(
    '#7d6fa6',
    `<path d="M4 64 Q80 56 156 64 L156 76 Q156 86 146 86 L14 86 Q4 86 4 76Z" fill="#4c8556"/>
    <ellipse cx="104" cy="70" rx="36" ry="9" fill="#3f7fa6" ${INK}/>
    <g ${INK}><path d="M42 72 L42 60" /><path d="M58 72 L58 64"/></g>
    <path d="M30 60 Q42 42 54 60Z" fill="#7affd8" ${INK}/><path d="M50 64 Q58 52 66 64Z" fill="#7affd8" ${INK}/>
    <g fill="#fff27a"><circle cx="24" cy="30" r="2.5"/><circle cx="70" cy="22" r="2.5"/><circle cx="112" cy="34" r="2.5"/><circle cx="136" cy="18" r="2.5"/><circle cx="92" cy="46" r="2"/><circle cx="44" cy="36" r="2"/></g>
    <path d="M128 40 L128 64 M134 44 L134 64 M122 46 L122 64" stroke="#7faa4f" stroke-width="3" stroke-linecap="round"/>`,
  ),
  lab: frame(
    '#f6d8b8',
    `<path d="M4 72 Q80 66 156 72 L156 76 Q156 86 146 86 L14 86 Q4 86 4 76Z" fill="#9cc05e"/>
    <rect x="26" y="34" width="70" height="36" fill="#b8c4cc" ${INK}/>
    <path d="M36 34 A16 16 0 0 1 68 34Z" fill="#dfe8ee" ${INK}/>
    <rect x="80" y="18" width="8" height="16" fill="#8a6a5a" ${INK}/>
    <rect x="54" y="50" width="14" height="20" fill="#4f5a62"/>
    <rect x="32" y="44" width="14" height="10" fill="#9fd8ef" ${INK}/><rect x="74" y="44" width="14" height="10" fill="#9fd8ef" ${INK}/>
    <path d="M106 56 Q106 76 122 76 Q138 76 138 56Z" fill="#3b3b44" ${INK}/>
    <ellipse cx="122" cy="56" rx="16" ry="4" fill="#9cff7a" ${INK}/>
    <g fill="#c8ff9a" ${INK}><circle cx="116" cy="44" r="4"/><circle cx="128" cy="36" r="3"/><circle cx="122" cy="24" r="2.5"/></g>`,
  ),
  end: frame(
    '#d9f5c8',
    `<circle cx="56" cy="30" r="9" fill="#2b1e1a"/><circle cx="104" cy="30" r="9" fill="#2b1e1a"/>
    <circle cx="80" cy="50" r="30" fill="#fff" ${INK}/>
    <ellipse cx="68" cy="48" rx="7" ry="9" fill="#2b1e1a" transform="rotate(-20 68 48)"/>
    <ellipse cx="92" cy="48" rx="7" ry="9" fill="#2b1e1a" transform="rotate(20 92 48)"/>
    <circle cx="69" cy="47" r="2" fill="#fff"/><circle cx="91" cy="47" r="2" fill="#fff"/>
    <ellipse cx="80" cy="60" rx="4" ry="3" fill="#2b1e1a"/>
    <path d="M74 66 Q80 71 86 66" fill="none" ${INK}/>
    <path d="M128 84 L132 30 M132 30 Q142 24 146 30 M130 50 Q120 44 116 50" fill="none" stroke="#5e9a34" stroke-width="5" stroke-linecap="round"/>
    <path d="M24 30 C24 24 32 22 34 28 C36 22 44 24 44 30 C44 38 34 42 34 46 C34 42 24 38 24 30Z" fill="#ff8fb1" ${INK}/>`,
  ),
};

export function storyArt(kind: StoryArt): string {
  return ART[kind];
}
