import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const basePath = env.VITE_BASE_PATH || '';

  return {
    base: basePath ? `${basePath}/` : '/',
    plugins: [react()],
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
        }
      }
    },
    preview: {
      port: 4173
    }
  };
});
