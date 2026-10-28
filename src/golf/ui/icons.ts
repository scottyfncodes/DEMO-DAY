import { BALLS, type BallId } from '../sim/balls';

/** Icons for the golf screens: drawn for this game, bold enough for thumbs. */
const svg = (body: string, fill = false): string =>
  `<svg viewBox="0 0 32 32" aria-hidden="true" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const GICON = {
  peek: svg('<path d="M3 16s5-8 13-8 13 8 13 8-5 8-13 8S3 16 3 16z"/><circle cx="16" cy="16" r="4"/>'),
  zoom: svg('<circle cx="14" cy="14" r="8"/><path d="M20 20l7 7M14 10v8M10 14h8"/>'),
  restart: svg('<path d="M6 16a10 10 0 1 0 3-7.1"/><path d="M6 4v5h5"/>'),
  flag: svg('<path d="M8 29V3"/><path d="M8 4h15l-4 5 4 5H8"/>'),
  wind: svg('<path d="M3 12h17a4 4 0 1 0-4-4M3 20h22a4 4 0 1 1-4 4"/>'),
  house: svg('<path d="M4 15L16 5l12 10"/><path d="M7 13v14h18V13"/><path d="M13 27v-7h6v7"/>'),
  target: svg('<circle cx="16" cy="16" r="11"/><circle cx="16" cy="16" r="5"/><circle cx="16" cy="16" r="1" fill="currentColor"/>'),
  calendar: svg('<rect x="5" y="7" width="22" height="20" rx="2"/><path d="M5 13h22M11 4v6M21 4v6"/><path d="M12 19h3v3h-3z" fill="currentColor"/>'),
  sandbox: svg('<path d="M4 26h24"/><path d="M8 26l4-9h8l4 9"/><path d="M12 17l1-6h6l1 6"/>'),
  bolt: svg('<path d="M18 3L7 18h8l-2 11 12-16h-8z"/>'),
  crane: svg('<path d="M4 28L22 5"/><path d="M22 5v9"/><circle cx="22" cy="19.5" r="5.5" fill="currentColor"/>'),
  play: svg('<path d="M10 6l16 10-16 10z"/>', true),
  // Power-ups.
  drive: svg('<path d="M5 22c5-2 9-6 11-12"/><path d="M12 9l4 1 1-4"/><circle cx="23" cy="22" r="4" fill="currentColor"/>'),
  ricochet: svg('<path d="M3 24l7-14 7 14 7-14 5 10"/><circle cx="27" cy="22" r="2.5" fill="currentColor"/>'),
  precision: svg('<path d="M4 24c6-16 18-16 24 0" stroke-dasharray="2 3"/><circle cx="28" cy="24" r="3"/><path d="M28 18v3M28 27v3"/>'),
  golfers: svg('<circle cx="8" cy="8" r="2.6"/><circle cx="16" cy="6" r="2.6"/><circle cx="24" cy="8" r="2.6"/><path d="M8 12v9M16 10v9M24 12v9M5 28l3-7 3 7M13 26l3-7 3 7M21 28l3-7 3 7"/>'),
};

/** A ball swatch: its colour with the identifying band. */
export function ballSwatch(id: BallId, size = 22): string {
  const d = BALLS[id];
  const c = `#${d.color.toString(16).padStart(6, '0')}`;
  const a = `#${d.accent.toString(16).padStart(6, '0')}`;
  const band = d.accent !== d.color ? `<rect x="2" y="13" width="28" height="6" fill="${a}"/>` : '';
  const multi = id === 'multi' ? `<circle cx="9" cy="9" r="4" fill="${c}" stroke="#1d1603" stroke-width="1.2"/><circle cx="23" cy="9" r="4" fill="${c}" stroke="#1d1603" stroke-width="1.2"/>` : '';
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><defs><clipPath id="bc-${id}"><circle cx="16" cy="16" r="13"/></clipPath></defs><circle cx="16" cy="16" r="13" fill="${c}"/><g clip-path="url(#bc-${id})">${band}</g><circle cx="16" cy="16" r="13" fill="none" stroke="#1d1603" stroke-opacity="0.35" stroke-width="1.5"/><circle cx="11" cy="11" r="3" fill="#fff" fill-opacity="0.35"/>${multi}</svg>`;
}
