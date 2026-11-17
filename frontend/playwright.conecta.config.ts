import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.CONECTA_E2E_PORT || 4206);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './e2e',
  testMatch: /conecta-pre-admission\.behavior\.spec\.ts/,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  outputDir: '../output/playwright/conecta/test-results',
  use: { baseURL, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
