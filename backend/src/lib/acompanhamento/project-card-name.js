import prisma from '../prisma.js';
import { clearProjectDerivedCaches } from '../resource-list-cache.js';

export async function setProjectCardName({ projectId, name, db = prisma } = {}) {
  const project = await db.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, name: true }
  });
  if (!project) return null;

  const cardName = name === project.name ? null : name;
  const updated = await db.project.update({
    where: { id: project.id },
    data: { acompanhamentoCardName: cardName },
    select: { id: true, acompanhamentoCardName: true }
  });
  clearProjectDerivedCaches();
  return { projectId: updated.id, cardName: updated.acompanhamentoCardName };
}
