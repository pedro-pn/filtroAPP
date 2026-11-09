import { createHash } from 'node:crypto';
import { z } from 'zod';

export const progressReadModeSchema = z.enum(['current', 'history', 'full']);

export function progressReadOptions(mode = 'full') {
  return { currentOnly: mode === 'current', includeSlices: mode === 'full', includeRevision: true };
}

// Identifica as fontes efetivamente lidas, incluindo histórico manual e correções já
// aplicadas aos serviços. Não depende de cache do processo nem só de Project.updatedAt.
export function progressSourceRevision(sources) {
  return createHash('sha256').update(JSON.stringify(sources)).digest('hex');
}
