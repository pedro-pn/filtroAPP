import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const sharedWorkspaceRoot = decodeURIComponent(new URL('../shared', import.meta.url).pathname);

export default defineConfig(() => {
  return {
    base: '/',
    plugins: [
      react(),
      {
        name: 'watch-shared-workspace',
        configureServer(server) {
          server.watcher.add(sharedWorkspaceRoot);
        }
      }
    ],
    build: {
      // Preserve the browser targets used before the Vite 8 migration.
      target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14']
    },
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:4000',
          changeOrigin: true
        },
        '/assets': {
          target: 'http://localhost:4000',
          changeOrigin: true
        },
        '/uploads': {
          target: 'http://localhost:4000',
          changeOrigin: true
        },
        '/relatorios': {
          target: 'http://localhost:4000',
          changeOrigin: true
        },
        '/certificados-calibracao': {
          target: 'http://localhost:4000',
          changeOrigin: true
        }
      }
    },
    preview: {
      port: 4173
    }
  };
});
