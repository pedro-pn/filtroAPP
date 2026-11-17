// Uma página sem filtros, ordenada por CODIGO, é uma faixa contínua do índice
// do Omie. Um ID não observado entre os extremos dessa MESMA página está
// ausente. Lacunas entre páginas não são evidência: exigem uma sobreposição.
export function createPurchaseCoverage() {
  const seen = new Set();
  const ranges = [];
  let merged = [], dirty = false, floor = null, ceiling = null, empty = false;
  return {
    seen,
    observe({ page, pageCount, count, rows }) {
      const ids = rows.map(row => Number(row.codigo_lancamento_omie));
      if (ids.some((id, i) => !Number.isSafeInteger(id) || id <= 0 || (i > 0 && id <= ids[i - 1]))) {
        throw new Error('Página Omie fora da ordem de códigos; versão anterior preservada.');
      }
      for (const id of ids) seen.add(String(id));
      if (!ids.length) {
        if (count === 0) empty = true;
        return;
      }
      empty = false;
      ranges.push([ids[0], ids.at(-1)]);
      dirty = true;
      if (page === 1) floor = ids[0];
      if (page === pageCount) ceiling = ids.at(-1);
    },
    isAbsent(value) {
      const id = Number(value);
      if (!Number.isSafeInteger(id) || id <= 0 || seen.has(String(id))) return false;
      if (empty || (floor != null && id < floor) || (ceiling != null && id > ceiling)) return true;
      if (dirty) {
        merged = [];
        for (const range of ranges.sort((a, b) => a[0] - b[0])) {
          const last = merged.at(-1);
          if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
          else merged.push([...range]);
        }
        dirty = false;
      }
      let lo = 0, hi = merged.length - 1;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (id < merged[mid][0]) hi = mid - 1;
        else if (id > merged[mid][1]) lo = mid + 1;
        else return true;
      }
      return false;
    }
  };
}

function lowerBound(values, target) {
  let lo = 0, hi = values.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (values[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Páginas de 99/98/97 deslocam os limites da leitura principal de 100. A busca
// é limitada, usa somente Listar e reaproveita cada janela já lida nesta carga.
export async function resolvePurchaseGaps({ existing, current, coverage, total, loadPage, consume, summary }) {
  const originalMissing = existing.filter(row => !current.has(row.omieId));
  const sorted = [...coverage.seen].map(Number).sort((a, b) => a - b);
  const cache = new Map();
  const resolved = id => current.has(id) || coverage.seen.has(id) || coverage.isAbsent(id);
  let latestTotal = total;
  for (const cached of originalMissing) {
    const id = Number(cached.omieId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('ID local inválido; versão anterior preservada.');
    if (resolved(cached.omieId)) continue;
    for (const size of [99, 98, 97]) {
      let lo = 1, hi = Math.max(1, Math.ceil(latestTotal / size));
      let page = Math.min(hi, Math.floor(lowerBound(sorted, id) / size) + 1);
      for (let attempt = 0; attempt < 20 && lo <= hi; attempt++) {
        const key = `${size}:${page}`;
        let info = cache.get(key);
        if (!info) {
          info = await loadPage(page, size);
          consume(info, true);
          summary.overlapPagesRead++;
          if (summary.overlapPagesRead === 1 || summary.overlapPagesRead % 25 === 0) {
            console.log(`[omie-sync] compras: ${summary.overlapPagesRead} páginas sobrepostas conferidas.`);
          }
          cache.set(key, info);
          cache.set(`${size}:${info.page}`, info);
        }
        latestTotal = info.count;
        if (resolved(cached.omieId)) break;
        hi = Math.min(hi, info.pageCount);
        if (!info.rows.length) break;
        if (id < Number(info.rows[0].codigo_lancamento_omie)) hi = Math.min(hi, info.page - 1);
        else lo = Math.max(lo, info.page + 1);
        page = Math.floor((lo + hi) / 2);
      }
      if (resolved(cached.omieId)) break;
    }
    if (!resolved(cached.omieId)) throw new Error('Ausência não confirmada por listagens Omie; versão anterior preservada.');
  }
  const removals = existing.filter(row => !current.has(row.omieId));
  if (removals.some(row => !coverage.seen.has(row.omieId) && !coverage.isAbsent(row.omieId))) {
    throw new Error('Ausência não confirmada por listagens Omie; versão anterior preservada.');
  }
  summary.verifiedMissing = new Set([...originalMissing, ...removals].map(row => row.omieId)).size;
  summary.recoveredMissing = originalMissing.filter(row => current.has(row.omieId)).length;
  return removals;
}
