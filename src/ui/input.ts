export interface InputHandlers {
  onTap(x: number, y: number): void;
  onPan(dx: number, dy: number): void;
  onZoom(x: number, y: number, factor: number): void;
  onGestureStart?(): void;
}

interface PointerState {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
}

/**
 * Touch + mouse input for the canvas: tap to select, drag to pan, pinch or
 * wheel to zoom. Coordinates are CSS pixels relative to the element.
 */
export function attachInput(el: HTMLElement, handlers: InputHandlers): () => void {
  const pointers = new Map<number, PointerState>();
  let moved = false;
  let lastPinchDist = 0;
  let lastMidX = 0;
  let lastMidY = 0;

  const local = (ev: PointerEvent): { x: number; y: number } => {
    const r = el.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };

  const down = (ev: PointerEvent): void => {
    if (ev.button !== undefined && ev.button !== 0 && ev.pointerType === 'mouse') return;
    el.setPointerCapture?.(ev.pointerId);
    const p = local(ev);
    pointers.set(ev.pointerId, { id: ev.pointerId, x: p.x, y: p.y, startX: p.x, startY: p.y, startTime: performance.now() });
    if (pointers.size === 1) moved = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [PointerState, PointerState];
      lastPinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      lastMidX = (a.x + b.x) / 2;
      lastMidY = (a.y + b.y) / 2;
      moved = true;
    }
    handlers.onGestureStart?.();
    ev.preventDefault();
  };

  const move = (ev: PointerEvent): void => {
    const state = pointers.get(ev.pointerId);
    if (!state) return;
    const p = local(ev);
    const dx = p.x - state.x;
    const dy = p.y - state.y;
    state.x = p.x;
    state.y = p.y;
    if (pointers.size === 1) {
      if (!moved && Math.hypot(p.x - state.startX, p.y - state.startY) > 8) moved = true;
      if (moved) handlers.onPan(dx, dy);
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [PointerState, PointerState];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      if (lastPinchDist > 0) handlers.onZoom(midX, midY, dist / lastPinchDist);
      handlers.onPan(midX - lastMidX, midY - lastMidY);
      lastPinchDist = dist;
      lastMidX = midX;
      lastMidY = midY;
    }
    ev.preventDefault();
  };

  const up = (ev: PointerEvent): void => {
    const state = pointers.get(ev.pointerId);
    if (!state) return;
    pointers.delete(ev.pointerId);
    const elapsed = performance.now() - state.startTime;
    if (pointers.size === 0 && !moved && elapsed < 600) {
      handlers.onTap(state.x, state.y);
    }
    if (pointers.size < 2) lastPinchDist = 0;
    ev.preventDefault();
  };

  const wheel = (ev: WheelEvent): void => {
    const r = el.getBoundingClientRect();
    const factor = Math.exp(-ev.deltaY * 0.0015);
    handlers.onZoom(ev.clientX - r.left, ev.clientY - r.top, factor);
    ev.preventDefault();
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', wheel, { passive: false });
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('wheel', wheel);
  };
}
