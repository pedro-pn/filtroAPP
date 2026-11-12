import { createHash } from 'node:crypto';
import { z } from 'zod';

export const progressReadModeSchema = z.enum(['current', 'history', 'full']);

export function progressReadOptions(mode = 'full') {
  return { currentOnly: mode === 'current', includeSlices: mode === 'full', includeRevision: true };
}

// Identifica as fontes efetivamente lidas, incluindo histórico manual e correções já
// aplicadas aos serviços. Não depende de cache do processo nem só de Project.updatedAt.
function canonicalJson(value) {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

export function progressSourceRevision(sources, { unorderedArrays = [] } = {}) {
  let json;
  if (unorderedArrays.length && sources && typeof sources === 'object' && !Array.isArray(sources)) {
    const unordered = new Set(unorderedArrays), fields = [];
    for (const key of Object.keys(sources).sort()) {
      const value = sources[key];
      // Serialize each realized row once and sort only its encoded snapshot.
      // Keep planned/manual/nested array order and calculation inputs intact.
      const encoded = unordered.has(key) && Array.isArray(value)
        ? '[' + Array.from(value, row => canonicalJson(row) ?? 'null').sort().join(',') + ']'
        : canonicalJson(value);
      if (encoded !== undefined) fields.push(JSON.stringify(key) + ':' + encoded);
    }
    json = '{' + fields.join(',') + '}';
  } else json = canonicalJson(sources);
  return createHash('sha256').update(json).digest('hex');
}
