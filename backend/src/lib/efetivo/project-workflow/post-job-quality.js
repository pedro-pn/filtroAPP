import { nextQualityRecordNumber } from '../../qualidade/numbering.js';

function text(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function qualityDescription(postJob) {
  return [
    ['Feedback do responsável de campo', postJob.fieldLeaderFeedback],
    ['Feedback dos colaboradores', postJob.teamFeedback],
    ['Problemas encontrados', postJob.problemsFound],
    ['Soluções adotadas', postJob.solutionsAdopted],
    ['Oportunidades de melhoria', postJob.improvementOpportunities],
    ['Lições aprendidas', postJob.lessonsLearned],
    ['Feedback sobre equipamentos', postJob.equipmentFeedback],
    ['Feedback sobre planejamento', postJob.planningFeedback]
  ].filter(([, value]) => text(value)).map(([label, value]) => `${label}:\n${text(value)}`).join('\n\n');
}

function qualityOrigin(serviceTypes) {
  const services = (serviceTypes || []).map(text).filter(Boolean).join(', ');
  return (`Pós-job / fechamento técnico${services ? ` · ${services}` : ''}`).slice(0, 180);
}

export async function synchronizePostJobQualityRecord(tx, {
  projectId,
  qualityRecordId = null,
  postJob,
  serviceTypes = [],
  actorUserId = null,
  now = new Date()
}) {
  const lessonsLearned = text(postJob.lessonsLearned);
  if (!lessonsLearned) {
    if (qualityRecordId) {
      await tx.qualityRecord.updateMany({
        where: { id: qualityRecordId, deletedAt: null },
        data: { deletedAt: now, deletedById: actorUserId, updatedById: actorUserId }
      });
    }
    return null;
  }

  const eventDate = postJob.meetingDate || now;
  const data = {
    registeredAt: eventDate,
    eventDate,
    origin: qualityOrigin(serviceTypes),
    projectId,
    natureId: null,
    description: qualityDescription(postJob),
    impact: null,
    linkedRnc: null,
    disposition: 'ARQUIVAR_DIVULGAR',
    definedAction: text(postJob.improvementOpportunities),
    actionOwner: null,
    actionDeadline: null,
    evidence: null,
    resultVerification: null,
    status: 'DIVULGADO',
    updatedById: actorUserId,
    deletedAt: null,
    deletedById: null
  };
  const current = qualityRecordId
    ? await tx.qualityRecord.findFirst({ where: { id: qualityRecordId, deletedAt: null }, select: { id: true } })
    : null;
  if (current) {
    await tx.qualityRecord.update({ where: { id: current.id }, data });
    return current.id;
  }

  const numbering = await nextQualityRecordNumber(tx, { type: 'LICAO_APRENDIDA', registeredAt: eventDate });
  const created = await tx.qualityRecord.create({
    data: {
      ...data,
      type: 'LICAO_APRENDIDA',
      seq: numbering.seq,
      year: numbering.year,
      number: numbering.number,
      createdById: actorUserId
    },
    select: { id: true }
  });
  return created.id;
}

export const __postJobQualityTestables = { qualityDescription, qualityOrigin };
