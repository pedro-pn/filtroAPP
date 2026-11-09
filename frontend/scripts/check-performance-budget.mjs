import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.resolve(root, process.env.PERFORMANCE_DIST_DIR || 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(dist, '.vite/manifest.json'), 'utf8'));
const budgets = JSON.parse(fs.readFileSync(path.join(root, 'performance-budgets.json'), 'utf8'));
const compressed = new Map();
function closure(entries) {
  const keys = new Set(), files = new Set();
  function visit(key) {
    if (keys.has(key)) return;
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Entrada ausente no manifesto: ${key}`);
    keys.add(key);
    if (/\.(?:js|css)$/.test(chunk.file)) files.add(chunk.file);
    chunk.css?.forEach(file => files.add(file));
    chunk.imports?.forEach(visit);
  }
  ['index.html', ...entries].forEach(visit);
  const bytes = [...files].reduce((sum, file) => {
    if (!compressed.has(file)) compressed.set(file, gzipSync(fs.readFileSync(path.join(dist, file))).length);
    return sum + compressed.get(file);
  }, 0);
  return { keys, bytes };
}
let failures = 0;
for (const surface of budgets.surfaces) {
  const { keys, bytes } = closure(surface.entries);
  console.log(`${surface.name}: ${bytes} / ${surface.maxGzipBytes} bytes gzip (JS + CSS + dependências estáticas)`);
  if (bytes > surface.maxGzipBytes) failures++;
  for (const deferred of surface.deferred || []) {
    if (!manifest[deferred]?.isDynamicEntry || keys.has(deferred)) {
      console.error(`Seção carregada antecipadamente: ${deferred}`);
      failures++;
    }
  }
}
// Rotas adicionadas depois desta rodada também recebem um limite padrão.
for (const [key, chunk] of Object.entries(manifest)) {
  if (chunk.isDynamicEntry && /^src\/pages\/.*Page\.tsx$/.test(key)) {
    const { bytes } = closure([key]);
    if (bytes > budgets.maxPageGzipBytes) { console.error(`${key}: ${bytes} > ${budgets.maxPageGzipBytes}`); failures++; }
  }
}
for (const image of budgets.images) {
  const bytes = fs.statSync(path.join(root, image.path)).size;
  if (bytes > image.maxBytes) { console.error(`${image.path}: ${bytes} > ${image.maxBytes}`); failures++; }
}
if (failures) process.exitCode = 1;
