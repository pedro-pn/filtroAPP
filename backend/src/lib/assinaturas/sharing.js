import { z } from 'zod';

import { documentForOwnerOrThrow } from './access.js';
import { recordDocumentEvent } from './audit.js';

const userSelect = { id: true, name: true, username: true, email: true };
const eligibleUser = { isActive: true, moduleRoles: { some: { module: 'ASSINATURAS', role: 'ASSINATURAS_USER' } } };

export async function sharingUsers(client, documentId, ownerUserId, search = '') {
  await documentForOwnerOrThrow(client, documentId, ownerUserId);
  const q = z.string().trim().max(120).parse(search);
  return client.user.findMany({
    where: {
      ...eligibleUser,
      id: { not: ownerUserId },
      ...(q ? { OR: ['name', 'username', 'email'].map(key => ({ [key]: { contains: q, mode: 'insensitive' } })) } : {})
    },
    select: userSelect,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 25
  });
}

export async function listDocumentShares(client, documentId, ownerUserId) {
  await documentForOwnerOrThrow(client, documentId, ownerUserId);
  return client.signatureDocumentShare.findMany({
    where: { documentId }, include: { user: { select: userSelect } }, orderBy: { createdAt: 'asc' }
  });
}

export async function saveDocumentShare(client, documentId, ownerUserId, userId, permission) {
  const access = z.enum(['VIEW', 'EDIT']).parse(permission);
  return client.$transaction(async tx => {
    const document = await documentForOwnerOrThrow(tx, documentId, ownerUserId);
    const user = userId !== ownerUserId && await tx.user.findFirst({ where: { id: userId, ...eligibleUser }, select: userSelect });
    if (!user) throw Object.assign(new Error('Selecione um usuário ativo com acesso ao módulo de Assinaturas.'), { statusCode: 400 });
    const share = await tx.signatureDocumentShare.upsert({
      where: { documentId_userId: { documentId, userId } },
      create: { documentId, userId, permission: access }, update: { permission: access },
      include: { user: { select: userSelect } }
    });
    await recordDocumentEvent(tx, {
      document, actorUserId: ownerUserId, action: 'CONFIGURACAO_ATUALIZADA',
      description: `Compartilhamento com ${user.name} (${user.username}): ${access === 'EDIT' ? 'visualização e edição' : 'apenas visualização'}.`
    });
    return share;
  });
}

export async function removeDocumentShare(client, documentId, ownerUserId, userId) {
  return client.$transaction(async tx => {
    const document = await documentForOwnerOrThrow(tx, documentId, ownerUserId);
    const share = await tx.signatureDocumentShare.findUnique({
      where: { documentId_userId: { documentId, userId } }, include: { user: { select: userSelect } }
    });
    if (!share) return;
    await tx.signatureDocumentShare.delete({ where: { documentId_userId: { documentId, userId } } });
    await recordDocumentEvent(tx, {
      document, actorUserId: ownerUserId, action: 'CONFIGURACAO_ATUALIZADA',
      description: `Compartilhamento com ${share.user.name} (${share.user.username}) removido.`
    });
  });
}
