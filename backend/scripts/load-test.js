#!/usr/bin/env node
// Teste de carga (critério 11.4): quantos usuários simultâneos o filtroAPP
// aguenta e o que quebra primeiro. Sem dependências: Node 22+ (fetch nativo).
//
// Cada usuário virtual (VU) repete o uso típico das telas principais — sessão,
// notificações, painel do gestor, lista de relatórios, cards do Acompanhamento,
// fluxo do Efetivo, estatísticas e, de vez em quando, o PDF de um RDO — com uma
// pausa de leitura entre as chamadas. A carga sobe em degraus (LOAD_STAGES) e
// para sozinha quando o sistema passa do limite (LOAD_ABORT_P95_MS ou erros).
//
// NUNCA aponte para produção: o script recusa qualquer host fora de homologação
// ou da máquina local. Rode a partir de um computador fora do servidor (o
// gerador de carga não pode disputar CPU com o sistema medido), fora do horário
// de uso, porque homologação divide a VPS com produção.
//
//   LOAD_BASE_URL=https://filtrostaging.filtrovali.com.br \
//   LOAD_USERNAME=carga.teste LOAD_PASSWORD='...' \
//   node scripts/load-test.js
//
// Variáveis (todas opcionais, exceto as três acima):
//   LOAD_STAGES=5,10,20,40,80   usuários simultâneos em cada degrau
//   LOAD_STAGE_SECONDS=60       duração de cada degrau
//   LOAD_THINK_MS=1000          pausa média entre chamadas de um usuário (±50%)
//   LOAD_TARGET_P95_MS=1500     p95 aceitável para contar o degrau como suportado
//   LOAD_MAX_ERROR_RATE=0.01    erros (5xx, rede, timeout) aceitáveis no degrau
//   LOAD_ABORT_P95_MS=5000      p95 que interrompe o teste
//   LOAD_TIMEOUT_MS=30000       timeout de cada requisição
//   LOAD_OUTPUT=../output/load-test/resultado.json
//
// A conta precisa ser interna, sem 2FA (o 2FA é exigido só de ADMIN), com acesso
// de leitura a RDO, Acompanhamento e Efetivo.

import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

export const SAFE_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]*staging[a-z0-9.-]*)$/i;

// Peso = frequência relativa. Ordem aproximada do uso real das telas.
export const JOURNEY = Object.freeze([
  { name: 'sessão', path: '/api/auth/me', weight: 4 },
  { name: 'notificações', path: '/api/notifications', weight: 3 },
  { name: 'painel do gestor', path: '/api/rdo/bootstrap/gestor', weight: 2 },
  { name: 'lista de relatórios', path: '/api/rdo/reports?page=1&pageSize=20', weight: 3 },
  { name: 'cards do Acompanhamento', path: '/api/acompanhamento/comercial/projetos-cards', weight: 2 },
  { name: 'fluxo do Efetivo', path: '/api/efetivo/project-workflow?page=1', weight: 2 },
  { name: 'estatísticas', path: '/api/rdo/statistics/overview', weight: 1 },
  { name: 'PDF do RDO', path: '/api/rdo/reports/{reportId}/pdf', weight: 0.3, needsReport: true }
]);

export function readConfig(source = process.env) {
  const get = (name, fallback) => (source[name] === undefined || source[name] === '' ? fallback : source[name]);
  const baseUrl = new URL(get('LOAD_BASE_URL', ''));
  if (!SAFE_HOST.test(baseUrl.hostname)) {
    throw new Error(`load-test recusa ${baseUrl.hostname}: só homologação (host com "staging") ou máquina local.`);
  }
  const stages = get('LOAD_STAGES', '5,10,20,40,80').split(',').map(Number);
  if (!stages.length || stages.some(n => !Number.isInteger(n) || n < 1 || n > 500)) throw new Error('LOAD_STAGES inválido (inteiros de 1 a 500).');
  return {
    baseUrl: baseUrl.origin,
    username: get('LOAD_USERNAME', ''),
    password: get('LOAD_PASSWORD', ''),
    stages,
    stageMs: Number(get('LOAD_STAGE_SECONDS', '60')) * 1000,
    thinkMs: Number(get('LOAD_THINK_MS', '1000')),
    targetP95: Number(get('LOAD_TARGET_P95_MS', '1500')),
    maxErrorRate: Number(get('LOAD_MAX_ERROR_RATE', '0.01')),
    abortP95: Number(get('LOAD_ABORT_P95_MS', '5000')),
    timeoutMs: Number(get('LOAD_TIMEOUT_MS', '30000')),
    output: get('LOAD_OUTPUT', path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../output/load-test/resultado.json'))
  };
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[index]);
}

// Resumo de um degrau. 429 = limitador funcionando (contado à parte, não é falha).
export function summarize(samples) {
  const durations = samples.filter(s => s.ok).map(s => s.ms).sort((a, b) => a - b);
  const errors = samples.filter(s => !s.ok && s.status !== 429).length;
  const byEndpoint = {};
  for (const sample of samples) {
    const item = byEndpoint[sample.name] ||= { requests: 0, errors: 0, limited: 0, durations: [], errorStatuses: {} };
    item.requests += 1;
    if (sample.status === 429) item.limited += 1;
    else if (!sample.ok) {
      item.errors += 1;
      item.errorStatuses[sample.status] = (item.errorStatuses[sample.status] || 0) + 1;
    } else item.durations.push(sample.ms);
  }
  return {
    requests: samples.length,
    errors,
    limited: samples.filter(s => s.status === 429).length,
    errorRate: samples.length ? errors / samples.length : 0,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    endpoints: Object.fromEntries(Object.entries(byEndpoint).map(([name, item]) => {
      const sorted = item.durations.sort((a, b) => a - b);
      return [name, { requests: item.requests, errors: item.errors, errorStatuses: item.errorStatuses, limited: item.limited, p50: percentile(sorted, 50), p95: percentile(sorted, 95) }];
    }))
  };
}

// Capacidade = maior degrau com p95 e erros dentro da meta; gargalo = rota com
// pior p95 no primeiro degrau que estourou (ou no último, se nenhum estourou).
export function verdict(results, { targetP95, maxErrorRate }) {
  const passes = stage => stage.summary.p95 !== null && stage.summary.p95 <= targetP95 && stage.summary.errorRate <= maxErrorRate;
  let capacity = null;
  for (const stage of results) {
    if (!passes(stage)) break;
    capacity = stage.users;
  }
  const failing = results.find(stage => !passes(stage)) || results.at(-1);
  const bottleneck = failing
    ? Object.entries(failing.summary.endpoints)
      .map(([name, item]) => ({ name, p95: item.p95 ?? Infinity, errors: item.errors }))
      .sort((a, b) => (b.errors - a.errors) || (b.p95 - a.p95))[0] || null
    : null;
  return { capacityUsers: capacity, firstFailingStage: results.find(stage => !passes(stage))?.users ?? null, bottleneck };
}

function pickWeighted(items, random = Math.random) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items.at(-1);
}

async function login(config) {
  const response = await fetch(`${config.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-filtrovali-request': '1', origin: config.baseUrl },
    body: JSON.stringify({ username: config.username, password: config.password })
  });
  const body = await response.json().catch(() => ({}));
  if (response.status !== 200) throw new Error(`login falhou (${response.status}): ${body.error || ''}`);
  if (body.twoFactorRequired) throw new Error('a conta exige 2FA: use uma conta interna sem 2FA para o teste de carga.');
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).find(value => value.startsWith('fv_session='));
  const headers = cookie ? { cookie } : (body.token ? { authorization: `Bearer ${body.token}` } : null);
  if (!headers) throw new Error('login sem cookie de sessão nem token.');
  return headers;
}

async function firstReportId(config, auth) {
  const response = await fetch(`${config.baseUrl}/api/rdo/reports?page=1&pageSize=20`, { headers: auth });
  if (!response.ok) return null;
  const body = await response.json();
  const items = Array.isArray(body) ? body : body.items || [];
  return items.find(item => item.status === 'APPROVED')?.id || items[0]?.id || null;
}

async function timedRequest(config, auth, step, reportId) {
  const started = performance.now();
  try {
    const url = config.baseUrl + step.path.replace('{reportId}', encodeURIComponent(reportId || ''));
    const response = await fetch(url, { headers: auth, signal: AbortSignal.timeout(config.timeoutMs) });
    await response.arrayBuffer();
    return { name: step.name, path: step.path, status: response.status, ok: response.status < 400, ms: performance.now() - started };
  } catch (error) {
    return { name: step.name, path: step.path, status: error.name === 'TimeoutError' ? 'timeout' : 'network', ok: false, ms: performance.now() - started };
  }
}

// Uma chamada por rota antes da carga: conta sem permissão (401/403) ou rota
// quebrada invalidaria o resultado, então para com a lista do que falhou.
export function preflightProblems(samples) {
  return samples.filter(sample => !sample.ok && sample.status !== 429).map(sample => {
    const hint = sample.status === 401 || sample.status === 403
      ? 'a conta de teste não tem acesso a esta tela; ajuste as permissões dela'
      : 'a rota falhou mesmo sem carga; veja o log do backend';
    return `${sample.name} (${sample.path}): HTTP ${sample.status}: ${hint}`;
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runStage(config, auth, users, journey, reportId) {
  const samples = [];
  const deadline = performance.now() + config.stageMs;
  const user = async index => {
    await sleep((config.thinkMs * index) / users); // entrada escalonada
    while (performance.now() < deadline) {
      samples.push(await timedRequest(config, auth, pickWeighted(journey), reportId));
      await sleep(config.thinkMs * (0.5 + Math.random()));
    }
  };
  await Promise.all(Array.from({ length: users }, (_, index) => user(index)));
  return samples;
}

async function main() {
  const config = readConfig();
  if (!config.username || !config.password) throw new Error('Defina LOAD_USERNAME e LOAD_PASSWORD.');
  console.log(`Teste de carga em ${config.baseUrl}: degraus ${config.stages.join(' → ')} usuários, ${config.stageMs / 1000}s cada.`);
  const auth = await login(config);
  const reportId = await firstReportId(config, auth);
  const journey = JOURNEY.filter(step => !step.needsReport || reportId);
  const problems = preflightProblems(await Promise.all(journey.map(step => timedRequest(config, auth, step, reportId))));
  if (problems.length) {
    throw new Error(`Conferência antes da carga falhou; nada foi medido:\n  - ${problems.join('\n  - ')}`);
  }
  console.log(`Conferência: as ${journey.length} rotas responderam.`);
  const startedAt = new Date().toISOString();
  const results = [];
  for (const users of config.stages) {
    const summary = summarize(await runStage(config, auth, users, journey, reportId));
    results.push({ users, summary });
    console.log(`${String(users).padStart(4)} usuários: ${summary.requests} req, p50 ${summary.p50} ms, p95 ${summary.p95} ms, p99 ${summary.p99} ms, erros ${(summary.errorRate * 100).toFixed(1)}%, 429 ${summary.limited}`);
    for (const [name, item] of Object.entries(summary.endpoints)) {
      if (item.errors) console.log(`      erros em ${name}: ${Object.entries(item.errorStatuses).map(([status, count]) => `${count}× ${status}`).join(', ')}`);
    }
    if ((summary.p95 ?? Infinity) > config.abortP95 || summary.errorRate > 0.05) {
      console.log(`Parado: o degrau de ${users} usuários passou do limite (p95 > ${config.abortP95} ms ou erros > 5%).`);
      break;
    }
  }
  const outcome = verdict(results, config);
  const report = {
    startedAt, finishedAt: new Date().toISOString(), baseUrl: config.baseUrl,
    settings: { stages: config.stages, stageSeconds: config.stageMs / 1000, thinkMs: config.thinkMs, targetP95: config.targetP95, maxErrorRate: config.maxErrorRate },
    journey: journey.map(({ name, path: route, weight }) => ({ name, path: route, weight })),
    results, verdict: outcome
  };
  await fs.mkdir(path.dirname(config.output), { recursive: true });
  await fs.writeFile(config.output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nCapacidade (p95 ≤ ${config.targetP95} ms e erros ≤ ${config.maxErrorRate * 100}%): ${outcome.capacityUsers ?? 'abaixo do primeiro degrau'} usuários simultâneos.`);
  if (outcome.bottleneck) console.log(`Gargalo: ${outcome.bottleneck.name} (p95 ${outcome.bottleneck.p95} ms, ${outcome.bottleneck.errors} erro(s)) no degrau de ${outcome.firstFailingStage ?? results.at(-1)?.users} usuários.`);
  console.log(`Resultado completo: ${config.output}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export { pickWeighted };
