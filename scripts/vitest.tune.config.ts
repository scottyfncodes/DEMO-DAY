import { defineConfig } from 'vitest/config';

// Slow local searches kept out of CI (`pnpm tune`): level solutions and Score Attack medal runs.
// Their output is what tests/golf-levels.test.ts replays.
export default defineConfig({
  test: {
    include: ['scripts/tune/**/*.tune.test.ts', 'tests/**/*.local.test.ts'],
    environment: 'node',
    testTimeout: 3_600_000,
  },
});
