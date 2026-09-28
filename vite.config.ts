import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site from https://<user>.github.io/DEMO-DAY/
// so every asset URL has to be prefixed with the repository name.
export default defineConfig({
  base: '/DEMO-DAY/',
  build: {
    target: 'es2019',
    sourcemap: false,
  },
  server: {
    host: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
