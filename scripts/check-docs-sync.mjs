#!/usr/bin/env node
// Critério 13.8: documentação muda no mesmo PR que muda o código.
//
// Para cada tema de .github/docs-map.json: se o PR muda um arquivo de `code` e
// nenhum de `docs`, o check falha, a menos que a descrição do PR traga a linha
//   Documentação: não se aplica — <motivo com pelo menos 10 caracteres>
// (o revisor confere o motivo). Rodado pelo workflow "Docs in sync".
//
// Uso:
//   node scripts/check-docs-sync.mjs --base <sha> --head <sha> [--body-file arquivo]
//   node scripts/check-docs-sync.mjs --files a.js,b.md [--body "texto"]   (testes)
// No GitHub Actions, sem argumentos, lê base, head e descrição do evento do PR.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MAP_FILE = path.join(root, '.github', 'docs-map.json');
const OPT_OUT = /^\s*(?:[-*]\s*)?\**documenta[cç][aã]o\**\s*:\s*\**\s*n[aã]o se aplica\s*[—–-]\s*(.+)$/im;

export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

function matcher(globs) {
  const patterns = globs.map(globToRegExp);
  return file => patterns.some(pattern => pattern.test(file));
}

// Motivo da dispensa na descrição do PR, ou null.
export function optOutReason(body) {
  const match = String(body || '').match(OPT_OUT);
  const reason = match?.[1]?.trim().replace(/\**$/, '').trim();
  // O modelo do PR traz "<motivo>": placeholder não vale como dispensa.
  return reason && reason.length >= 10 && !reason.startsWith('<') ? reason : null;
}

export function checkDocsSync(files, body, map = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'))) {
  const missing = [];
  for (const rule of map.rules) {
    const isCode = matcher(rule.code);
    const isIgnored = matcher(rule.ignore || []);
    const isDoc = matcher(rule.docs);
    const code = files.filter(file => isCode(file) && !isIgnored(file) && !isDoc(file));
    if (!code.length || files.some(isDoc)) continue;
    missing.push({ name: rule.name, code, docs: rule.docs });
  }
  const reason = missing.length ? optOutReason(body) : null;
  return { ok: !missing.length || Boolean(reason), missing, reason };
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return out;
}

function changedFiles(base, head) {
  return execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMRD', `${base}...${head}`], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(Boolean);
}

function main() {
  const opts = args(process.argv.slice(2));
  let { base, head } = opts;
  let body = opts.body ?? (opts['body-file'] ? fs.readFileSync(opts['body-file'], 'utf8') : undefined);
  if (!opts.files && !base && process.env.GITHUB_EVENT_PATH) {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    base = event.pull_request?.base?.sha;
    head = event.pull_request?.head?.sha;
    body ??= event.pull_request?.body || '';
  }
  if (!opts.files && !(base && head)) {
    console.log('Docs in sync: sem PR (base/head ausentes); nada a conferir.');
    return;
  }
  const files = opts.files ? opts.files.split(',').filter(Boolean) : changedFiles(base, head);
  const result = checkDocsSync(files, body);
  if (!result.missing.length) {
    console.log(`Docs in sync: ok (${files.length} arquivo(s) conferido(s)).`);
    return;
  }
  for (const item of result.missing) {
    const detail = `${item.name}: mudou ${item.code.join(', ')} sem mudar ${item.docs.join(' ou ')}`;
    if (result.ok) console.log(`- ${detail}`);
    else console.log(`::error title=Documentação desatualizada (13.8)::${detail}`);
  }
  if (result.ok) {
    console.log(`Docs in sync: dispensado pela descrição do PR — ${result.reason}`);
    return;
  }
  console.log('\nAtualize a documentação no mesmo PR ou, se a mudança não altera o que está documentado,');
  console.log('adicione à descrição do PR a linha:\n  Documentação: não se aplica — <motivo>');
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
