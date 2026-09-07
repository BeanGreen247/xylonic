import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import path from 'path';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // Transpile for Android 7+ (WebView / Chrome 56) and equivalent desktop browsers
    legacy({
      targets: ['android >= 7', 'chrome >= 56'],
    }),
  ],
  // Relative base so Electron can load dist/index.html via file:// protocol
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 5000,
    // WS-PERF: production minify with terser so the debug loggers (disabled by
    // default) and their argument construction are dropped from hot paths.
    // error/warn are NOT listed — they always emit.
    ...(mode === 'production'
      ? {
          minify: 'terser' as const,
          terserOptions: {
            compress: {
              pure_funcs: ['logger.log', 'logger.info', 'logger.debug'],
            },
          },
        }
      : {}),
  },
  server: {
    port: 3000,
    open: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  // public/ is copied to dist/ during build; Vite's built files take precedence
  // over any same-named file from publicDir (e.g. public/index.html is harmless)
  publicDir: 'public',
}));
