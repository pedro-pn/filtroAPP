import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// Testes ponta a ponta reais (spec 040): navegador → bundle de produção
// (`vite preview`) → backend real → PostgreSQL real, com o e-mail do 2FA
// capturado pelo Mailpit. Nenhuma resposta da API é simulada.
//
// Pré-requisitos (o job "E2E (real stack)" do CI e `npm run test:e2e:real`
// cuidam disso): banco descartável terminado em `_e2e` em E2E_DATABASE_URL com
// as migrations aplicadas e `backend/prisma/e2e-seed.js` rodado; Mailpit em
// E2E_SMTP_PORT/E2E_MAILPIT_URL; `npm run build` já feito (pasta dist). Para o
// PDF do RDO o backend precisa do LibreOffice (`soffice` no PATH ou
// LIBREOFFICE_BINARY); no CI ele vem da imagem de produção (E2E_BACKEND_EXTERNAL=1).

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const outputDir = path.join(repoRoot, 'output', 'e2e-real');

const databaseUrl = process.env.E2E_DATABASE_URL || '';
const databaseName = (() => {
  try {
    return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
})();
if (!databaseName.endsWith('_e2e')) {
  throw new Error('E2E_DATABASE_URL precisa apontar para um banco descartável terminado em _e2e.');
}

const backendPort = Number(process.env.E2E_BACKEND_PORT ?? 4100);
const frontendPort = Number(process.env.E2E_FRONTEND_PORT ?? 4194);
const backendURL = `http://127.0.0.1:${backendPort}`;
// No CI o backend roda da imagem de produção (backend/Dockerfile, com o
// LibreOffice que gera o PDF do RDO) e já está no ar quando o Playwright começa.
const externalBackend = process.env.E2E_BACKEND_EXTERNAL === '1';
const baseURL = `http://127.0.0.1:${frontendPort}`;

export default defineConfig({
  testDir: './e2e/real',
  testMatch: /.*\.real\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(outputDir, 'report') }]
  ],
  outputDir: path.join(outputDir, 'test-results'),
  use: {
    baseURL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    acceptDownloads: true
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: externalBackend
        ? `echo "backend externo não respondeu em ${backendURL}/health" >&2; exit 1`
        : 'node src/server.js',
      cwd: path.join(repoRoot, 'backend'),
      url: `${backendURL}/health`,
      reuseExistingServer: externalBackend,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'test',
        TZ: 'America/Sao_Paulo',
        PORT: String(backendPort),
        DATABASE_URL: databaseUrl,
        TRUST_PROXY: 'false',
        BACKGROUND_JOBS_IN_API: 'false',
        TWO_FACTOR_ENFORCEMENT: 'on',
        SEND_CLIENT_EMAILS: 'true',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(process.env.E2E_SMTP_PORT ?? 1025),
        SMTP_SECURE: 'false',
        SMTP_AUTH_MODE: 'password',
        SMTP_USER: 'e2e',
        SMTP_PASS: 'e2e',
        SMTP_FROM: 'Filtrovali E2E <no-reply@e2e.test>',
        APP_URL: baseURL,
        REPORTS_DIR: path.join(outputDir, 'storage', 'relatorios'),
        SIGNATURE_TOKEN_SECRET: 'e2e-signature-token-secret',
        SURVEY_TOKEN_SECRET: 'e2e-survey-token-secret'
      }
    },
    {
      command: `npx vite preview --host 127.0.0.1 --port ${frontendPort} --strictPort`,
      cwd: here,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_PROXY_TARGET: backendURL }
    }
  ]
});
