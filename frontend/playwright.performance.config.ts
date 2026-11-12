import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.PERFORMANCE_E2E_PORT ?? 4213);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './e2e', testMatch: /performance\.behavior\.spec\.mjs/,
  workers: 1, retries: 0, timeout: 60_000, forbidOnly: true,
  reporter: [['list']], outputDir: '../output/playwright/performance',
  use: { baseURL, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`, url: baseURL,
    reuseExistingServer: false, timeout: 120_000 }
});
