import { createHash } from 'node:crypto';

const fold = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const identity = value => fold(value).split('_').filter(word => !['e', 'de', 'da', 'do'].includes(word)).sort().join('_');

// Os nomes do CRM são livres; reutilizar o catálogo local antes de criar um item.
export async function resolveClientSegment(tx, label) {
  if (!label?.trim()) return null;
  const name = label.trim();
  const segments = await tx.clientSegment.findMany({ select: { slug: true, label: true, isActive: true } });
  const match = segments.find(item => fold(item.slug) === fold(name) || identity(item.label) === identity(name));
  if (match) return match.isActive ? match.slug : null;
  const slug = fold(name) || `segmento_${createHash('sha256').update(name).digest('hex').slice(0, 16)}`;
  const segment = await tx.clientSegment.upsert({ where: { slug }, update: {}, create: { slug, label: name, isActive: true } });
  return segment.isActive ? segment.slug : null;
}
