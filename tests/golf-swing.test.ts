import { describe, expect, it } from 'vitest';
import { normalizeGolfSave } from '../src/golf/save';
import { MIN_SWING, PURE_WINDOW, SWING_TIME, strike, swingCharge } from '../src/golf/sim/swing';

describe('the timed swing', () => {
  it('climbs to full and back down while held', () => {
    expect(swingCharge(0)).toBe(0);
    expect(swingCharge(SWING_TIME / 2)).toBeCloseTo(0.5);
    expect(swingCharge(SWING_TIME)).toBeCloseTo(1);
    expect(swingCharge(SWING_TIME * 1.25)).toBeCloseTo(0.75);
    expect(swingCharge(SWING_TIME * 2)).toBeCloseTo(0);
    expect(swingCharge(SWING_TIME * 2.5)).toBeCloseTo(0.5);
  });

  it('hits at exactly the planned power inside the pure window', () => {
    for (const miss of [0, PURE_WINDOW * 0.9, -PURE_WINDOW * 0.9]) {
      const s = strike(0.7 + miss, 0.7);
      expect(s.quality).toBe('pure');
      expect(s.power).toBe(0.7);
    }
  });

  it('takes the released power outside the window', () => {
    const strong = strike(0.85, 0.7);
    expect(strong.quality).toBe('strong');
    expect(strong.power).toBe(0.85);
    const soft = strike(0.5, 0.7);
    expect(soft.quality).toBe('soft');
    expect(soft.power).toBe(0.5);
    expect(soft.miss).toBeCloseTo(-0.2);
  });

  it('a quick tap stays under the call-off threshold', () => {
    expect(swingCharge(0.05)).toBeLessThan(MIN_SWING);
  });

  it('remembers the tap-to-fire setting and defaults to the timed swing', () => {
    expect(normalizeGolfSave({})?.tapToFire).toBe(false);
    expect(normalizeGolfSave({ tapToFire: true })?.tapToFire).toBe(true);
    expect(normalizeGolfSave({ tapToFire: 'yes' })?.tapToFire).toBe(false);
  });
});
