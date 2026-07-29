import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'src/runtime/node/main.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      output: {
        entryFileNames: 'main.js',
      },
    },
  },
  ssr: {
    noExternal: ['@zero/mail-core'],
  },
});
