import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const sharedWorkspaceRoot = decodeURIComponent(new URL('../shared', import.meta.url).pathname);

export default defineConfig(() => {
  const apiProxyTarget =
    process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000';

  return {
    base: '/',
    plugins: [
      react(),
      tailwindcss(),
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
          target: apiProxyTarget,
          changeOrigin: true
        },
        '/assets': {
          target: apiProxyTarget,
          changeOrigin: true
        },
        '/uploads': {
          target: apiProxyTarget,
          changeOrigin: true
        },
        '/relatorios': {
          target: apiProxyTarget,
          changeOrigin: true
        },
        '/certificados-calibracao': {
          target: apiProxyTarget,
          changeOrigin: true
        }
      }
    },
    preview: {
      port: 4173
    }
  };
});
