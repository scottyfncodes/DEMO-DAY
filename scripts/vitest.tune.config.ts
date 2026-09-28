import { defineConfig } from 'vitest/config';

// Runs the tuning harness: pnpm tune
export default defineConfig({
  test: {
    include: ['scripts/tune.ts'],
    environment: 'node',
    silent: false,
  },
});
