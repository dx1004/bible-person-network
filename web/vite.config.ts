import { defineConfig } from 'vite';

export default defineConfig({
  cacheDir: '/tmp/nt-people-vite',
  build: {
    outDir: 'dist'
  }
});
