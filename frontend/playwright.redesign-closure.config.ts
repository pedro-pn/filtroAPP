import { defineConfig } from '@playwright/test';

const port = Number(process.env.REDESIGN_WEB_PORT || 4210);
export default defineConfig({
  testDir: './e2e', testMatch: /redesign-.*\.spec\.ts/,
  workers: 1, retries: 0, timeout: 90_000,
  reporter: [['list']], outputDir: '../output/playwright/redesign-closure',
  use: { actionTimeout: 15_000, baseURL: `http://127.0.0.1:${port}`, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }, { name: 'webkit', use: { browserName: 'webkit' } }],
  webServer: {
    command: `VITE_CACHE_DIR=node_modules/.vite-redesign-${port} VITE_API_PROXY_TARGET=http://127.0.0.1:${process.env.REDESIGN_API_PORT || 4310} npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 120_000
  }
});
