import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const sharedWorkspaceRoot = decodeURIComponent(new URL('../shared', import.meta.url).pathname);

export default defineConfig(() => {
  const apiProxyTarget =
    process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000';
  const proxy: Record<string, ProxyOptions> = Object.fromEntries(
    ['/api', '/assets', '/uploads', '/relatorios', '/certificados-calibracao']
      .map(path => [path, { target: apiProxyTarget, changeOrigin: true }])
  );
  const previewAssets: ProxyOptions = {
    ...proxy['/assets'],
    bypass(request) {
      // Hashed bundles, styles, fonts and images belong to the compiled frontend.
      if (request.url && /^\/assets\/[^/?]+-[\w-]{8}\.[^/?]+(?:\?|$)/.test(request.url)) return request.url;
    }
  };

  return {
    base: '/',
    // Concurrent dev servers and SSR tests must not overwrite each other's dependencies.
    cacheDir: process.env.VITE_CACHE_DIR || `node_modules/.vite-app-${process.pid}`,
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
      proxy
    },
    preview: {
      port: 4173,
      proxy: { ...proxy, '/assets': previewAssets }
    }
  };
});
