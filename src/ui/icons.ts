import type { MachineId } from '../data/fleet';

/**
 * Icons drawn for this game, one per machine plus the few interface marks it
 * needs. Bold strokes so they read at thumb size.
 */

const svg = (body: string, fill = false): string =>
  `<svg viewBox="0 0 32 32" aria-hidden="true" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const MACHINE_ICON: Record<MachineId, string> = {
  // Boom tip, cable, ball.
  ball: svg('<path d="M4 28L22 5"/><path d="M22 5v9"/><circle cx="22" cy="19.5" r="5.5" fill="currentColor"/>'),
  // A charge with its detonator cord.
  charges: svg('<rect x="7" y="11" width="10" height="16" rx="2"/><path d="M12 11c0-4 3-7 8-7"/><path d="M23 2.5l1.4 2.4M27 6l-2.6.6M24.5 9l.4 2.2"/><path d="M7 17h10"/>'),
  // Tracks, house, boom and jaws.
  excavator: svg('<rect x="3" y="23" width="15" height="5" rx="2.5"/><path d="M5 23v-6h8v6"/><path d="M13 17l6-11 8 5"/><path d="M27 11l-3 7M27 11l3 5"/>'),
  // Tracks, cab and the blade.
  dozer: svg('<rect x="3" y="22" width="17" height="6" rx="3"/><path d="M6 22v-7h7v7M13 17h5l2 5"/><path d="M27 12v16c-2.5 0-4-1-5-3"/>'),
  // Big wheels, cab, raised bucket.
  loader: svg('<circle cx="8" cy="24" r="4"/><circle cx="20" cy="24" r="4"/><path d="M4 20V12h9l3 8"/><path d="M16 14l7-5"/><path d="M23 6h6l-2 6h-5z"/>'),
};

export const ICON = {
  back: svg('<path d="M19 6l-9 10 9 10"/>'),
  pause: svg('<path d="M11 7v18M21 7v18"/>'),
  close: svg('<path d="M8 8l16 16M24 8L8 24"/>'),
  ff: svg('<path d="M5 8l10 8-10 8zM17 8l10 8-10 8z"/>', true),
  inspect: svg('<circle cx="14" cy="14" r="8"/><path d="M20 20l7 7"/><path d="M14 10v8M10 14h8"/>'),
  frame: svg('<path d="M4 11V4h7M21 4h7v7M28 21v7h-7M11 28H4v-7"/>'),
  flip: svg('<path d="M5 12h20l-5-5M27 20H7l5 5"/>'),
  coin: svg('<circle cx="16" cy="16" r="11"/><path d="M19.5 11.5c-1-1.3-2.2-1.8-3.6-1.8-2.2 0-3.6 1.1-3.6 2.8 0 4 7.6 2.2 7.6 6.4 0 1.8-1.6 3-3.9 3-1.7 0-3.1-.7-4-2M16 7v2.6M16 22.4V25"/>'),
  star: svg('<path d="M16 4l3.6 7.6 8.2 1-6 5.7 1.6 8.2L16 22.6l-7.4 3.9 1.6-8.2-6-5.7 8.2-1z"/>', true),
  lock: svg('<rect x="7" y="14" width="18" height="13" rx="2"/><path d="M11 14v-4a5 5 0 0110 0v4"/>'),
  check: svg('<path d="M6 17l6 6 14-14"/>'),
  sound: svg('<path d="M5 12h5l7-6v20l-7-6H5z"/><path d="M22 11c2 2.6 2 7.4 0 10"/>'),
  garage: svg('<path d="M3 13L16 5l13 8v14H3z"/><path d="M8 27V17h16v10M8 21h16"/>'),
  board: svg('<rect x="6" y="5" width="20" height="23" rx="2"/><path d="M11 5V3h10v2M10 12h12M10 17h12M10 22h7"/>'),
  records: svg('<path d="M9 5h14v6a7 7 0 01-14 0z"/><path d="M9 7H4c0 4 2 6 5 6M23 7h5c0 4-2 6-5 6M16 18v5M10 28h12M12 23h8"/>'),
  settings: svg('<path d="M5 9h14M24 9h3M5 23h3M13 23h14"/><circle cx="21.5" cy="9" r="2.5"/><circle cx="10.5" cy="23" r="2.5"/><path d="M5 16h7M17 16h10"/><circle cx="14.5" cy="16" r="2.5"/>'),
  fire: svg('<path d="M16 3c1 5 7 7 7 14a7 7 0 01-14 0c0-4 2-6 4-8 0 3 1 4 3 5 0-4-1-7 0-11z"/>'),
};
