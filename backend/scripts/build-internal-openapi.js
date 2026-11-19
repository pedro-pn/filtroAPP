// Gera docs/api/openapi.internal.json a partir dos contratos (spec 042).
//   npm run contract:build            → grava o arquivo
//   npm run contract:build -- --check → falha se o arquivo estiver desatualizado
//   npm run contract:allowlist        → regrava a lista de rotas ainda não migradas
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, '..');
export const OPENAPI_FILE = path.resolve(backendDir, '..', 'docs', 'api', 'openapi.internal.json');
export const ALLOWLIST_FILE = path.resolve(backendDir, 'src', 'lib', 'api-contract', 'unmigrated-routes.json');

// Valores mínimos para importar as rotas sem servidor nem banco.
const defaults = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://contract:contract@127.0.0.1:1/contract',
  TRUST_PROXY: 'false',
  SIGNATURE_TOKEN_SECRET: 'contract-build',
  SURVEY_TOKEN_SECRET: 'contract-build'
};
for (const [key, value] of Object.entries(defaults)) process.env[key] ||= value;

const { collectApiRoutes, routeKey } = await import('../src/lib/api-contract/inventory.js');
const { buildInternalOpenApi } = await import('../src/lib/api-contract/openapi.js');

export function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const routes = await collectApiRoutes();
const args = new Set(process.argv.slice(2));

if (args.has('--allowlist')) {
  const unmigrated = routes.filter(route => !route.contract).map(routeKey);
  fs.writeFileSync(ALLOWLIST_FILE, serialize(unmigrated));
  console.log(`${unmigrated.length} rota(s) ainda sem contrato gravadas em ${path.relative(process.cwd(), ALLOWLIST_FILE)}`);
} else {
  const document = serialize(buildInternalOpenApi(routes));
  if (args.has('--check')) {
    const current = fs.existsSync(OPENAPI_FILE) ? fs.readFileSync(OPENAPI_FILE, 'utf8') : '';
    if (current !== document) {
      console.error('docs/api/openapi.internal.json está desatualizado: rode `npm run contract:build` no backend.');
      process.exit(1);
    }
    console.log('docs/api/openapi.internal.json atualizado.');
  } else {
    fs.mkdirSync(path.dirname(OPENAPI_FILE), { recursive: true });
    fs.writeFileSync(OPENAPI_FILE, document);
    console.log(`${routes.filter(route => route.contract).length} rota(s) com contrato em ${path.relative(process.cwd(), OPENAPI_FILE)}`);
  }
}
process.exit(0);
