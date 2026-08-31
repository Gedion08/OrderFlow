import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill';
import { NodeModulesPolyfillPlugin } from '@esbuild-plugins/node-modules-polyfill';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      buffer: 'buffer',
      events: 'events',
      path: 'path-browserify',
      stream: 'stream-browserify',
      crypto: 'crypto-browserify',
      util: 'util/',
      zlib: 'browserify-zlib',
      url: 'url/',
      assert: 'assert/',
      http: 'stream-http',
      https: 'https-browserify',
      os: 'os-browserify',
    },
  },
  define: {
    global: 'globalThis',
    'process.env': {},
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
      plugins: [
        NodeGlobalsPolyfillPlugin({
          buffer: true,
          crypto: true,
          process: true,
        }),
        NodeModulesPolyfillPlugin(),
      ],
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});
