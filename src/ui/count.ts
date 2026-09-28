import { easeOutCubic } from '../core/format';

/**
 * Animates a number from `from` to `to`, calling `render` each frame.
 * Resolves when finished. With `instant`, jumps straight to the end.
 */
export function countUp(
  from: number,
  to: number,
  duration: number,
  render: (value: number, t: number) => void,
  instant = false,
): Promise<void> {
  return new Promise((resolve) => {
    if (instant || duration <= 0) {
      render(to, 1);
      resolve();
      return;
    }
    const start = performance.now();
    const frame = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const e = easeOutCubic(t);
      render(from + (to - from) * e, t);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}
