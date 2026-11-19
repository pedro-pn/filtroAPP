import { createRequire } from 'node:module';

import { contractOfRoute } from './registry.js';

// Inventário das rotas reais da API interna, para comparar com o registro.
// O Express 5 (router@2) não guarda o caminho de montagem de `router.use(path,
// sub)`; o gravador abaixo marca cada layer criado por `use` com o caminho,
// antes de as rotas serem importadas. Usado só pelo teste de contrato e pelo
// gerador do OpenAPI (nunca no servidor).

const require = createRequire(import.meta.url);
const MOUNT_PATH = Symbol.for('filtrovali.mountPath');
const RECORDER = Symbol.for('filtrovali.routeRecorder');
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

export function installRouteRecorder() {
  const Router = require('router');
  if (Router.prototype[RECORDER]) return;
  const originalUse = Router.prototype.use;
  Router.prototype.use = function recordedUse(first, ...rest) {
    const before = this.stack.length;
    const result = originalUse.call(this, first, ...rest);
    const mountPath = typeof first === 'string' ? first : (Array.isArray(first) || first instanceof RegExp ? String(first) : '/');
    for (const layer of this.stack.slice(before)) layer[MOUNT_PATH] = mountPath;
    return result;
  };
  Router.prototype[RECORDER] = true;
}

function joinPath(base, segment) {
  const left = base.endsWith('/') ? base.slice(0, -1) : base;
  if (!segment || segment === '/') return left || '/';
  return `${left}${segment.startsWith('/') ? '' : '/'}${segment}`;
}

function isRouter(handle) {
  return typeof handle === 'function' && Array.isArray(handle.stack);
}

function walk(router, prefix, out, seen) {
  for (const layer of router.stack) {
    if (layer.route) {
      const routePaths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const routePath of routePaths) {
        const fullPath = joinPath(prefix, typeof routePath === 'string' ? routePath : String(routePath));
        for (const method of HTTP_METHODS) {
          if (!layer.route.methods?.[method]) continue;
          out.push({ method, path: fullPath, contract: contractOfRoute(layer.route, method) });
        }
      }
    } else if (isRouter(layer.handle)) {
      const mount = layer[MOUNT_PATH];
      if (mount === undefined) throw new Error(`Router montado sem caminho registrado sob ${prefix} (instale o gravador antes de importar as rotas).`);
      const key = `${prefix}|${mount}`;
      if (seen.has(layer.handle) && seen.get(layer.handle).has(key)) continue;
      if (!seen.has(layer.handle)) seen.set(layer.handle, new Set());
      seen.get(layer.handle).add(key);
      walk(layer.handle, joinPath(prefix, mount), out, seen);
    }
  }
  return out;
}

export function routeKey(route) {
  return `${route.method.toUpperCase()} ${route.path}`;
}

// Importa o router da API (montado em /api no app) com o gravador instalado.
export async function collectApiRoutes() {
  installRouteRecorder();
  const { default: apiRouter } = await import('../../routes/index.js');
  const routes = walk(apiRouter, '/api', [], new Map());
  const unique = new Map();
  for (const route of routes) unique.set(routeKey(route), route);
  return [...unique.values()].sort((a, b) => routeKey(a).localeCompare(routeKey(b)));
}
