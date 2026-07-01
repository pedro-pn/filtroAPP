import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadModuleRegistry,
  moduleRegistryPath,
  validateModuleRegistry,
  writeGeneratedRegistry
} from './generate-module-registry.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  console.error('Uso: npm run new:module -- <nome-do-modulo> [--title "Titulo do modulo"]');
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function pascalCase(slug) {
  return slug.split('-').filter(Boolean).map(part => `${part[0].toUpperCase()}${part.slice(1)}`).join('');
}

function camelCase(slug) {
  const pascal = pascalCase(slug);
  return `${pascal[0].toLowerCase()}${pascal.slice(1)}`;
}

function titleFromSlug(slug) {
  return slug.split('-').filter(Boolean).map(part => `${part[0].toUpperCase()}${part.slice(1)}`).join(' ');
}

function enumName(slug) {
  return slug.replace(/-/g, '_').toUpperCase();
}

function repoPath(...segments) {
  return path.join(repoRoot, ...segments);
}

function read(relativePath) {
  return fs.readFileSync(repoPath(relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.mkdirSync(path.dirname(repoPath(relativePath)), { recursive: true });
  fs.writeFileSync(repoPath(relativePath), content);
}

function writeIfMissing(relativePath, content) {
  const absolutePath = repoPath(relativePath);
  if (fs.existsSync(absolutePath)) {
    throw new Error(`Arquivo ja existe: ${relativePath}`);
  }
  write(relativePath, content);
}

function replaceMarker(relativePath, marker, insertion) {
  const source = read(relativePath);
  if (!source.includes(marker)) {
    throw new Error(`Marcador nao encontrado em ${relativePath}: ${marker}`);
  }
  write(relativePath, source.replace(marker, `${insertion}${marker}`));
}

function insertEnumValue(schema, enumNameValue, value) {
  const enumPattern = new RegExp(`enum\\s+${enumNameValue}\\s+\\{([\\s\\S]*?)\\n\\}`);
  const match = schema.match(enumPattern);
  if (!match) throw new Error(`Enum Prisma nao encontrado: ${enumNameValue}`);
  const values = new Set(match[1].split(/\r?\n/).map(line => line.trim().split(/\s+/)[0]).filter(Boolean));
  if (values.has(value)) return schema;
  return schema.replace(enumPattern, (fullMatch, body) => `enum ${enumNameValue} {${body}\n  ${value}\n}`);
}

function parseArgs(argv) {
  const [rawName, ...rest] = argv;
  let title = '';

  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--title') {
      title = rest[index + 1] || '';
      index += 1;
    }
  }

  return {
    rawName,
    title
  };
}

function moduleDefinition({ slug, title, pascal, enumBase }) {
  const badge = enumBase.replace(/_/g, '').slice(0, 4) || 'MOD';
  return {
    id: slug,
    prismaModule: enumBase,
    badge,
    title,
    copy: `Fluxos operacionais do modulo ${title}.`,
    hub: {
      enabled: true,
      roles: [`${slug}:manager`, `${slug}:viewer`],
      path: `/${slug}`
    },
    pathPrefixes: [`/${slug}`],
    routes: {
      index: `/${slug}`
    },
    routeGroups: {
      default: {
        allowedAccountTypes: ['ADMIN', 'INTERNAL'],
        allowedModuleRoles: [`${slug}:manager`, `${slug}:viewer`]
      }
    },
    roles: [
      {
        code: `${enumBase}_MANAGER`,
        public: `${slug}:manager`,
        label: `${title} - Gestor`,
        accountTypes: ['ADMIN', 'INTERNAL']
      },
      {
        code: `${enumBase}_VIEWER`,
        public: `${slug}:viewer`,
        label: `${title} - Visualizador`,
        accountTypes: ['ADMIN', 'INTERNAL']
      }
    ]
  };
}

function updateRegistry(definition) {
  const registry = loadModuleRegistry();
  if (registry.modules.some(module => module.id === definition.id)) {
    throw new Error(`Modulo ja existe no registry: ${definition.id}`);
  }

  registry.modules.push(definition);
  const failures = validateModuleRegistry(registry);
  if (failures.length) {
    throw new Error(`Registry ficaria invalido:\n- ${failures.join('\n- ')}`);
  }

  fs.writeFileSync(moduleRegistryPath, `${JSON.stringify(registry, null, 2)}\n`);
}

function updatePrismaSchema(definition) {
  let schema = read('backend/prisma/schema.prisma');
  schema = insertEnumValue(schema, 'AppModule', definition.prismaModule);
  for (const role of definition.roles) {
    schema = insertEnumValue(schema, 'ModuleRoleCode', role.code);
  }
  write('backend/prisma/schema.prisma', schema);

  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const migrationDir = `backend/prisma/migrations/${timestamp}_add_${definition.id.replace(/-/g, '_')}_module`;
  const sql = [
    `ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS '${definition.prismaModule}';`,
    ...definition.roles.map(role => `ALTER TYPE "ModuleRoleCode" ADD VALUE IF NOT EXISTS '${role.code}';`),
    ''
  ].join('\n');
  writeIfMissing(`${migrationDir}/migration.sql`, sql);
}

function createBackendFiles({ slug, pascal, camel }) {
  writeIfMissing(`backend/src/lib/${slug}/service.js`, `export function ${camel}Status() {
  return {
    module: '${slug}',
    status: 'ok'
  };
}
`);

  writeIfMissing(`backend/src/routes/resources/${slug}.js`, `import { Router } from 'express';

import { ${camel}Status } from '../../lib/${slug}/service.js';
import { requireAuth, requireModuleRole } from '../../middleware/auth.js';

const router = Router();
const require${pascal}Access = requireModuleRole('${slug}:manager', '${slug}:viewer');

router.use(requireAuth, require${pascal}Access);

router.get('/status', (req, res) => {
  res.json(${camel}Status());
});

export default router;
`);

  writeIfMissing(`backend/test/${slug}.test.js`, `import assert from 'node:assert/strict';
import test from 'node:test';

import { ${camel}Status } from '../src/lib/${slug}/service.js';

test('${slug} exposes module status', () => {
  assert.deepEqual(${camel}Status(), {
    module: '${slug}',
    status: 'ok'
  });
});
`);

  replaceMarker(
    'backend/src/routes/index.js',
    '// module:scaffold import',
    `import ${camel}Router from './resources/${slug}.js';\n`
  );
  replaceMarker(
    'backend/src/routes/index.js',
    '// module:scaffold mount',
    `router.use('/${slug}', ${camel}Router);\n`
  );
}

function createFrontendFiles({ slug, title, pascal, camel }) {
  writeIfMissing(`frontend/src/api/${slug}.ts`, `import { apiClient } from './client';

export interface ${pascal}Status {
  module: string;
  status: string;
}

export async function get${pascal}Status() {
  const { data } = await apiClient.get<${pascal}Status>('/${slug}/status');
  return data;
}
`);

  writeIfMissing(`frontend/src/hooks/use${pascal}.ts`, `import { useQuery } from '@tanstack/react-query';

import { get${pascal}Status } from '../api/${slug}';

export function use${pascal}Status() {
  return useQuery({
    queryKey: ['${slug}', 'status'],
    queryFn: get${pascal}Status
  });
}
`);

  writeIfMissing(`frontend/src/pages/${slug}/${pascal}Page.tsx`, `import { useAuth } from '../../auth/AuthContext';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import { use${pascal}Status } from '../../hooks/use${pascal}';

export function ${pascal}Page() {
  const { user } = useAuth();
  const statusQuery = use${pascal}Status();

  return (
    <Shell>
      <TopBar
        title="${title}"
        subtitle={user?.name || 'Filtrovali App'}
        showLogo
      />
      <main className="page-scroll">
        <section className="page-card">
          <div className="section-title">${title}</div>
          <p className="placeholder-copy">
            {statusQuery.isLoading ? 'Carregando...' : 'Modulo pronto para implementacao.'}
          </p>
        </section>
      </main>
    </Shell>
  );
}
`);

  writeIfMissing(`frontend/test/${slug}.test.mjs`, `import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function loadRegistry() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule('/src/modules/registry.ts');
  } finally {
    await server.close();
  }
}

test('${slug} is registered in the module registry', async () => {
  const { moduleDefinition, moduleRoutePath } = await loadRegistry();

  assert.equal(moduleDefinition('${slug}')?.title, '${title}');
  assert.equal(moduleRoutePath('${slug}', 'index'), '/${slug}');
});
`);

  replaceMarker(
    'frontend/src/modules/moduleRoutes.tsx',
    '// module:scaffold import',
    `import { ${pascal}Page } from '../pages/${slug}/${pascal}Page';\n`
  );
  replaceMarker(
    'frontend/src/modules/moduleRoutes.tsx',
    '// module:scaffold access',
    `const ${pascal.toUpperCase()}_ACCESS = moduleRouteAccess('${slug}');\n`
  );
  replaceMarker(
    'frontend/src/modules/moduleRoutes.tsx',
    '    {/* module:scaffold routes */}',
    `    <Route element={<RoleRoute {...${pascal.toUpperCase()}_ACCESS} />}>\n      <Route path={moduleRoutePath('${slug}', 'index')} element={<${pascal}Page />} />\n    </Route>\n\n    {/* module:scaffold routes */}`
  );
}

const { rawName, title: rawTitle } = parseArgs(process.argv.slice(2));
if (!rawName) {
  usage();
  process.exit(1);
}

const slug = slugify(rawName);
if (!slug || !/^[a-z][a-z0-9-]*$/.test(slug)) {
  usage();
  throw new Error(`Nome de modulo invalido: ${rawName}`);
}

const pascal = pascalCase(slug);
const camel = camelCase(slug);
const title = rawTitle.trim() || titleFromSlug(slug);
const enumBase = enumName(slug);
const definition = moduleDefinition({ slug, title, pascal, enumBase });

updateRegistry(definition);
updatePrismaSchema(definition);
createBackendFiles({ slug, pascal, camel });
createFrontendFiles({ slug, title, pascal, camel });
writeGeneratedRegistry();

console.log(`Modulo ${slug} criado.`);
console.log('Revise os arquivos gerados, implemente o fluxo real e rode npm run architecture:check, backend/frontend tests e build.');
