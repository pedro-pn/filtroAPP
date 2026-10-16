import { signatureTokenData } from '../signature-token.js';
import { recordDocumentEvent } from './audit.js';

export const groupMemberInclude = {
  members: {
    where: { status: { not: 'REVOGADO' }, document: { deletedAt: null, status: { in: ['AGUARDANDO_ASSINATURAS', 'FINALIZANDO', 'CONCLUIDO'] } } },
    orderBy: [{ document: { batchPosition: 'asc' } }, { documentId: 'asc' }],
    include: { fields: { orderBy: [{ pageNumber: 'asc' }, { createdAt: 'asc' }] }, document: { include: { signers: { select: { id: true, status: true, isRequired: true } } } } }
  }
};

export async function issueGroupedInvites(client, documents, expiresAt, actorUserId) {
  const bySigner = new Map();
  for (const document of documents) for (const signer of document.signers) {
    const key = signer.batchSignerId || signer.id;
    if (!bySigner.has(key)) bySigner.set(key, []);
    bySigner.get(key).push({ document, signer });
  }
  const groups = [];
  for (const members of bySigner.values()) {
    const { token: _token, ...persisted } = signatureTokenData();
    const group = await client.signatureInviteGroup.create({ data: {
      ...persisted, tokenExpiresAt: expiresAt,
      emailStatus: members[0].signer.email ? 'PENDENTE' : 'NAO_APLICAVEL'
    } });
    for (const { document, signer } of members) {
      await client.signatureDocumentSigner.update({ where: { id: signer.id }, data: {
        groupInviteId: group.id, tokenHash: null, tokenEncrypted: null, tokenIv: null, tokenAuthTag: null,
        tokenExpiresAt: expiresAt, status: 'PENDENTE', emailStatus: 'NAO_APLICAVEL'
      } });
      await recordDocumentEvent(client, { document, signer, actorUserId, action: 'CONVITE_CRIADO', description: `Convite único criado para ${signer.name}, reunindo ${members.length} documento(s).` });
    }
    groups.push({ id: group.id, name: members[0].signer.name, documentIds: members.map(member => member.document.id) });
  }
  return groups;
}

export async function findGroupedInviteByHash(client, tokenHash) {
  const group = await client.signatureInviteGroup?.findUnique({ where: { tokenHash }, include: groupMemberInclude });
  if (!group?.members.length) return null;
  const first = group.members[0];
  return {
    ...first, tokenHash: group.tokenHash, tokenExpiresAt: group.tokenExpiresAt,
    status: group.members.every(member => member.status === 'ASSINADO') ? 'ASSINADO'
      : group.members.some(member => member.status === 'VISUALIZADO') ? 'VISUALIZADO' : 'PENDENTE',
    groupInviteId: group.id, members: group.members.map(member => ({ ...member, tokenExpiresAt: group.tokenExpiresAt }))
  };
}

export async function renewGroupedInvite(client, signer, expiresAt, actorUserId, tokenFactory = signatureTokenData) {
  const { token, ...persisted } = tokenFactory();
  // O update obtém o mesmo lock utilizado na confirmação do conjunto.
  await client.signatureInviteGroup.update({ where: { id: signer.groupInviteId }, data: {
    ...persisted, tokenExpiresAt: expiresAt, emailStatus: signer.email ? 'PENDENTE' : 'NAO_APLICAVEL',
    emailAttempts: 0, emailSentAt: null, emailClaimedAt: null, emailLastError: null
  } });
  const group = await client.signatureInviteGroup.findUnique({ where: { id: signer.groupInviteId }, include: groupMemberInclude });
  for (const member of group.members) await client.signatureDocumentSigner.update({ where: { id: member.id }, data: {
    tokenHash: null, tokenEncrypted: null, tokenIv: null, tokenAuthTag: null
  } });
  const pending = group.members.filter(member => ['PENDENTE', 'VISUALIZADO', 'EXPIRADO'].includes(member.status));
  if (!pending.length) throw Object.assign(new Error('Este convite não pode ser renovado.'), { statusCode: 409 });
  for (const member of pending) {
    await client.signatureDocumentSigner.update({ where: { id: member.id }, data: {
      status: 'PENDENTE', tokenExpiresAt: expiresAt, renewalCount: { increment: 1 }, viewedAt: null, expiredAt: null
    } });
    await recordDocumentEvent(client, { document: member.document, signer: member, actorUserId, action: 'CONVITE_RENOVADO', description: `Convite agrupado renovado para ${member.name}.` });
  }
  return { token, signer: { ...signer, status: 'PENDENTE', tokenExpiresAt: expiresAt }, expiresAt };
}
