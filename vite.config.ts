import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: resolve(__dirname, 'src/web'),
  base: './',
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core')
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 11000,
    rollupOptions: {
      output: {
        manualChunks: {
          'ts-compiler': ['typescript']
        }
      }
    }
  }
});
