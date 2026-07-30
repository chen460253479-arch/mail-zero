import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
    include: [
      'modules/**/*.test.ts',
      'modules/**/*.test.tsx',
      'components/**/*.test.ts',
      'components/**/*.test.tsx',
      'app/**/change-password/*.test.tsx',
    ],
  },
});
