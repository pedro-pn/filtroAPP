import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
  return {
    base: '/',
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
