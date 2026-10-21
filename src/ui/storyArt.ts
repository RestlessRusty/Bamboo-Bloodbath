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
  // Doc (a red panda) sniffing a suspicious bamboo shoot.
  sniff: frame(
    '#f6d8b8',
    `<path d="M4 72 Q80 66 156 72 L156 76 Q156 86 146 86 L14 86 Q4 86 4 76Z" fill="#9cc05e"/>
    <circle cx="66" cy="50" r="22" fill="#d9662a" ${INK}/>
    <path d="M48 34 L44 20 L58 30Z M84 34 L88 20 L74 30Z" fill="#d9662a" ${INK}/>
    <path d="M56 52 Q66 66 78 52 Q72 60 66 60 Q60 60 56 52Z" fill="#fff"/>
    <circle cx="58" cy="46" r="3" fill="#2b1e1a"/><circle cx="74" cy="46" r="3" fill="#2b1e1a"/>
    <ellipse cx="88" cy="54" rx="4" ry="3" fill="#2b1e1a"/>
    <path d="M58 40 L64 42 M74 42 L80 40" fill="none" ${INK}/>
    <path d="M102 82 L106 34" fill="none" stroke="#8fe03a" stroke-width="6" stroke-linecap="round"/>
    <path d="M106 40 Q118 32 124 38 M105 54 Q94 46 90 52" fill="none" stroke="#6fc13a" stroke-width="4" stroke-linecap="round"/>
    <path d="M94 30 q4 -6 0 -12 M100 24 q4 -6 0 -12" fill="none" stroke="#8fe03a" stroke-width="2.5" stroke-linecap="round"/>
    <text x="128" y="26" font-size="20" font-weight="700" fill="#2b1e1a">?</text>`,
  ),
  // Bristle's farm: red barn, silo, rows of far-too-tall bamboo.
  farm: frame(
    '#dff4ff',
    `<path d="M4 66 Q80 60 156 66 L156 76 Q156 86 146 86 L14 86 Q4 86 4 76Z" fill="#7fcb3a"/>
    <rect x="22" y="40" width="40" height="28" fill="#b8402e" ${INK}/>
    <path d="M18 42 L42 24 L66 42Z" fill="#6b3a2a" ${INK}/>
    <path d="M34 68 L34 52 L50 52 L50 68 M34 52 L50 68 M50 52 L34 68" fill="none" stroke="#fff" stroke-width="2.5"/>
    <rect x="70" y="22" width="16" height="46" fill="#c9d3dc" ${INK}/><path d="M70 22 A8 8 0 0 1 86 22Z" fill="#9aa8b4" ${INK}/>
    <rect x="70" y="38" width="16" height="6" fill="#8fe03a"/>
    <g stroke="#8fe03a" stroke-width="5" stroke-linecap="round"><path d="M100 72 L100 18"/><path d="M114 72 L114 10"/><path d="M128 72 L128 22"/><path d="M142 72 L142 14"/></g>
    <g fill="#6fc13a"><circle cx="100" cy="18" r="5"/><circle cx="114" cy="10" r="5"/><circle cx="128" cy="22" r="5"/><circle cx="142" cy="14" r="5"/></g>`,
  ),
  // Professor Bristle: smug red panda in a lab coat, holding a MegaSprout bottle.
  bristle: frame(
    '#e8f7d8',
    `<path d="M50 88 L50 64 Q80 50 110 64 L110 88Z" fill="#fff" ${INK}/>
    <path d="M80 56 L72 88 M80 56 L88 88" fill="none" ${INK}/>
    <circle cx="80" cy="40" r="20" fill="#d9662a" ${INK}/>
    <path d="M64 26 L58 12 L72 22Z M96 26 L102 12 L88 22Z" fill="#d9662a" ${INK}/>
    <path d="M68 44 Q80 58 92 44 Q86 52 80 52 Q74 52 68 44Z" fill="#fff"/>
    <circle cx="72" cy="38" r="5" fill="#fff" ${INK}/><circle cx="88" cy="38" r="5" fill="#fff" ${INK}/>
    <path d="M70 38 L78 38 M86 38 L94 38" ${INK}/>
    <path d="M70 31 L78 34 M90 34 L96 30" fill="none" ${INK}/>
    <path d="M74 50 Q80 53 88 48" fill="none" ${INK}/>
    <rect x="114" y="46" width="16" height="26" rx="4" fill="#8fe03a" ${INK}/><rect x="118" y="38" width="8" height="8" fill="#6f7a82" ${INK}/>
    <path d="M118 58 L126 58 M122 54 L122 62" stroke="#fff" stroke-width="2.5"/>
    <g fill="#ffe066"><circle cx="140" cy="30" r="2.5"/><circle cx="134" cy="20" r="2"/><circle cx="146" cy="42" r="2"/></g>`,
  ),
  // The hijacked delivery cart, full of cure barrels, on a quarry road.
  cart: frame(
    '#ffe9c8',
    `<path d="M4 60 L30 34 L52 48 L74 26 L96 50 L4 60Z" fill="#c9a27a" ${INK}/>
    <path d="M4 66 Q80 58 156 66 L156 76 Q156 86 146 86 L14 86 Q4 86 4 76Z" fill="#e0b47a"/>
    <path d="M10 78 L150 70 M10 82 L150 74" stroke="#8a8f99" stroke-width="2.5"/>
    <rect x="64" y="46" width="56" height="20" fill="#9a6a3a" ${INK}/>
    <rect x="64" y="52" width="56" height="5" fill="#f4f1ea"/>
    <g fill="#4fd1b0" ${INK}><rect x="70" y="32" width="12" height="16" rx="3"/><rect x="86" y="30" width="12" height="18" rx="3"/><rect x="102" y="32" width="12" height="16" rx="3"/></g>
    <circle cx="76" cy="70" r="7" fill="#4a2e18" ${INK}/><circle cx="108" cy="70" r="7" fill="#4a2e18" ${INK}/>
    <path d="M120 48 L136 40" ${INK}/>`,
  ),
  // Night at the reservoir: pumps gushing green into the water, a moon.
  pumps: frame(
    '#2f3f6a',
    `<circle cx="132" cy="20" r="10" fill="#fff6c8" ${INK}/>
    <path d="M4 58 Q80 52 156 58 L156 76 Q156 86 146 86 L14 86 Q4 86 4 76Z" fill="#3f7fa6" ${INK}/>
    <path d="M4 62 Q30 56 50 60 L50 86 L14 86 Q4 86 4 76Z" fill="#3f5a4a"/>
    <rect x="14" y="38" width="20" height="22" fill="#6f7a82" ${INK}/><rect x="18" y="28" width="12" height="12" fill="#8fe03a" ${INK}/>
    <path d="M30 34 Q52 26 64 52" fill="none" stroke="#b6ff5a" stroke-width="5" stroke-linecap="round"/>
    <g fill="#b6ff5a"><circle cx="66" cy="60" r="4"/><circle cx="74" cy="64" r="3"/><circle cx="60" cy="66" r="3"/></g>
    <path d="M90 68 Q110 64 130 68" fill="none" stroke="#b6ff5a" stroke-width="3" stroke-linecap="round" opacity="0.7"/>
    <g fill="#fff"><circle cx="20" cy="14" r="1.5"/><circle cx="60" cy="20" r="1.5"/><circle cx="96" cy="12" r="1.5"/><circle cx="112" cy="34" r="1.5"/></g>`,
  ),
  // Glasshouses with MegaSprout bursting out of the roof, and a keycard.
  glasshouse: frame(
    '#e6f6ea',
    `<path d="M4 72 Q80 66 156 72 L156 76 Q156 86 146 86 L14 86 Q4 86 4 76Z" fill="#9fd36a"/>
    <path d="M20 72 L20 44 L50 28 L80 44 L80 72Z" fill="#cff5ff" ${INK}/>
    <path d="M35 72 L35 36 M50 72 L50 28 M65 72 L65 36 M20 56 L80 56" fill="none" stroke="#2b1e1a" stroke-width="2"/>
    <path d="M44 40 L40 6 M58 44 L64 10" fill="none" stroke="#8fe03a" stroke-width="5" stroke-linecap="round"/>
    <g fill="#6fc13a"><circle cx="40" cy="8" r="5"/><circle cx="64" cy="12" r="5"/></g>
    <rect x="98" y="40" width="44" height="28" rx="5" fill="#d9662a" ${INK}/>
    <rect x="98" y="46" width="44" height="6" fill="#8fe03a"/><rect x="104" y="56" width="10" height="8" fill="#ffd34d" ${INK}/>`,
  ),
  // The Bristle Bio works: chimneys, green smoke, the blimp.
  factory: frame(
    '#d9e6c8',
    `<path d="M4 72 Q80 66 156 72 L156 76 Q156 86 146 86 L14 86 Q4 86 4 76Z" fill="#8a9a7a"/>
    <path d="M14 72 L14 44 L34 34 L34 44 L54 34 L54 44 L74 34 L74 72Z" fill="#9a9f98" ${INK}/>
    <rect x="84" y="20" width="10" height="52" fill="#8a6a5a" ${INK}/><rect x="84" y="24" width="10" height="5" fill="#8fe03a"/>
    <g fill="#b9f27a" ${INK}><circle cx="90" cy="14" r="6"/><circle cx="98" cy="8" r="5"/></g>
    <ellipse cx="124" cy="34" rx="26" ry="11" fill="#8fe03a" ${INK}/>
    <path d="M146 30 L156 24 L156 44 L146 38Z" fill="#d9662a" ${INK}/>
    <rect x="118" y="45" width="12" height="6" fill="#6f7a82" ${INK}/>
    <path d="M124 51 L124 72" stroke="#2b1e1a" stroke-width="1.5"/>`,
  ),
  // Bristle drifting off in a hot-air balloon, shaking his fist.
  balloon: frame(
    '#cdeefc',
    `<path d="M4 76 Q80 70 156 76 Q156 86 146 86 L14 86 Q4 86 4 76Z" fill="#7fcb3a"/>
    <path d="M80 8 C104 8 112 30 98 48 L62 48 C48 30 56 8 80 8Z" fill="#8fe03a" ${INK}/>
    <path d="M80 8 C88 20 88 36 86 48 M80 8 C72 20 72 36 74 48" fill="none" stroke="#d9662a" stroke-width="4"/>
    <path d="M66 48 L72 60 M94 48 L88 60" ${INK}/>
    <rect x="70" y="60" width="20" height="14" fill="#9a6a3a" ${INK}/>
    <circle cx="80" cy="56" r="6" fill="#d9662a" ${INK}/>
    <path d="M86 54 L94 46" ${INK}/><circle cx="95" cy="45" r="3" fill="#d9662a" ${INK}/>
    <g stroke="#2b1e1a" stroke-width="2" fill="none"><path d="M24 40 q6 -6 12 0 q6 -6 12 0"/><path d="M120 30 q5 -5 10 0 q5 -5 10 0"/></g>`,
  ),
};

export function storyArt(kind: StoryArt): string {
  return ART[kind];
}
