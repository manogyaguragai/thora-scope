// In-house instrument + context-action icons (CONTEXT §6.3): one inline SVG sprite, injected once.
// 24×24 monochrome silhouettes; instruments enter from bottom-left like a port view. Stroke/fill = currentColor,
// stroke style comes from CSS (.icon) so <use> instances inherit it.
const SVG_NS = 'http://www.w3.org/2000/svg';
const SHAFT = '<path d="M3 21 13 11"/>';
const FILL = 'fill="currentColor" stroke="none"';

const SYMBOLS: Record<string, string> = {
  // thoracoscope: camera head, shaft, lens + light
  'i-hands': `<rect x="2" y="16" width="6" height="6" rx="1.5" transform="rotate(-45 5 19)"/><path d="M7 17 17 7"/><circle cx="18.5" cy="5.5" r="2"/><path d="M21 9.5l1 1M17.5 1.5l.5-1M22 4h1"/>`,
  'i-grasper': `${SHAFT}<path d="M13 11l2-5 1.5-2.5M13 11l5-2 2.5-1.5"/>`,
  'i-ring-clamp': `${SHAFT}<path d="M13 11l1.5-1.5"/><circle cx="17.5" cy="6.5" r="3.5"/><circle cx="17.5" cy="6.5" r="1.2" ${FILL}/>`,
  'i-sponge': `${SHAFT}<ellipse cx="17" cy="7" rx="5" ry="3.5" transform="rotate(-45 17 7)" fill="currentColor" fill-opacity=".35"/><path d="M15 6.5l2 2M16.5 5l2 2"/>`,
  'i-peanut': `${SHAFT}<ellipse cx="16.5" cy="7.5" rx="3.2" ry="2.2" transform="rotate(-45 16.5 7.5)" ${FILL}/>`,
  'i-cautery': `${SHAFT}<path d="M13 11l4-4v-2.5a1.5 1.5 0 0 1 3 0"/><path d="M21 9l1.5 .5M19.5 11l.5 1.5M22 6.5h1.5" stroke-width="1.25"/>`,
  'i-clamp': `${SHAFT}<path d="M13 11l4-4h4.5M13 11l4.5-2.5H21"/>`,
  'i-stapler': `<path d="M3 21 10 14" stroke-width="3"/><path d="M10 14l7-7q2-2 4-1.5M10 14l8-5q2-1 3.5 0"/><path d="M13.5 11l3-2.5" stroke-width="1"/>`,
  'i-clip': `${SHAFT}<path d="M13 11l3-6M13 11l6-3"/><path d="M16.5 3.5 20.5 7.5" stroke-width="2.25"/>`,
  'i-sucker': `<path d="M3 21 15 9q2.5-2.5 5-1.5"/><circle cx="14" cy="10" r=".6" ${FILL}/><circle cx="12" cy="12" r=".6" ${FILL}/><path d="M21 4.5q.8 1.5 0 2.5M18 2.5q1.5-.6 2.5.2" stroke-width="1.25"/>`,
  // context actions
  'i-bag': `<path d="M6 8h12l-1.5 12a2 2 0 0 1-2 1.5h-5a2 2 0 0 1-2-1.5Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>`,
  'i-ventilate': `<path d="M12 3v8M12 11l-2.5 2M12 11l2.5 2"/><path d="M9 7Q4 7 4 15q0 5 3.5 5 2.5 0 2.5-3V10M15 7q5 0 5 8 0 5-3.5 5-2.5 0-2.5-3V10"/>`,
  'i-hold': `<path d="M8 3h8l-1.5 6 3 3v2H6.5v-2l3-3Z"/><path d="M12 14v7"/>`,
  'i-chest-tube': `<path d="M4 4q8 2 8 9t6 7"/><path d="M5.5 7l1-2M8 9l1.2-1.5" stroke-width="1.25"/><rect x="16" y="16" width="6" height="6" rx="1.5"/>`,
};

/** Inject the sprite into `document.body` once (idempotent). */
export function ensureIconSprite(): void {
  if (document.getElementById('icon-sprite')) return;
  const tpl = document.createElement('template');
  tpl.innerHTML =
    `<svg id="icon-sprite" xmlns="${SVG_NS}" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">` +
    Object.entries(SYMBOLS)
      .map(([id, body]) => `<symbol id="${id}" viewBox="0 0 24 24">${body}</symbol>`)
      .join('') +
    '</svg>';
  document.body.prepend(tpl.content);
}

/** A decorative `<svg class="icon"><use href="#id"/></svg>` instance. */
export function icon(id: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}
