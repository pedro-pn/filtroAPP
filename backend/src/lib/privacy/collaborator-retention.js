// LGPD — retenção de colaboradores desligados (decisão de 2026-11-18, ROPA).
//
// 5 anos após o desligamento (Collaborator.terminationDate, preenchida pelo
// cadastro ou pelo Conecta RH), os dados que não têm obrigação de guarda mais
// longa são anonimizados:
//   - sempre: e-mail, observação do Efetivo, imagem de assinatura, ausências
//     (podem conter dado de saúde), apelidos/vínculos do ponto e os dados
//     pessoais guardados nos agregados brutos do Conecta RH;
//   - nome, CPF e matrícula só são mantidos quando o colaborador aparece em
//     registro com guarda mais longa (fichas/solicitações de EPI — 20 anos — ou
//     RDO). Sem esses vínculos, viram "Colaborador anonimizado <código>".
// Salário não é dado individual aqui: o Conecta envia salário por cargo.
// Colaboradores com exceção (DataRetentionHold kind COLLABORATOR), ativos ou sem
// data de desligamento nunca são tocados (os sem data aparecem só na simulação).

export const COLLABORATOR_RETENTION_YEARS = 5;
export const ANONYMIZED_COLLABORATOR_PREFIX = 'Colaborador anonimizado';
export const COLLABORATOR_HOLD_KIND = 'COLLABORATOR';
const CONECTA_PERSON_AGGREGATES = ['employment', 'compliance'];

export function collaboratorRetentionCutoff(now = new Date(), years = COLLABORATOR_RETENTION_YEARS) {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  return cutoff;
}

export function collaboratorRetentionWhere(cutoff, heldIds = []) {
  return {
    isActive: false,
    privacyAnonymizedAt: null,
    terminationDate: { lt: cutoff },
    ...(heldIds.length ? { id: { notIn: heldIds } } : {})
  };
}

export async function heldCollaboratorIds(prismaClient) {
  const holds = await prismaClient.dataRetentionHold.findMany({
    where: { kind: COLLABORATOR_HOLD_KIND }, select: { targetId: true }
  });
  return holds.map(hold => hold.targetId);
}

export function anonymizedCollaboratorName(code) {
  return `${ANONYMIZED_COLLABORATOR_PREFIX} ${code}`;
}

// Mantém só identificadores e o estado do vínculo; descarta nome, CPF,
// matrícula, e-mail e o conteúdo de documentos/exames.
export function redactConectaAggregateData(aggregateType, data, now = new Date()) {
  const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const redactedAt = now.toISOString();
  if (aggregateType === 'employment') {
    return {
      personId: source.personId ?? null,
      employmentId: source.employmentId ?? null,
      status: source.status ?? null,
      admissionDate: source.admissionDate ?? null,
      terminationDate: source.terminationDate ?? null,
      currentJobRoleId: source.currentJobRoleId ?? null,
      isOperational: source.isOperational ?? null,
      redactedAt
    };
  }
  return {
    id: source.id ?? null,
    personId: source.personId ?? null,
    category: source.category ?? null,
    status: source.status ?? null,
    redactedAt
  };
}

export async function previewCollaboratorRetention({ prismaClient, now = new Date(), sampleLimit = 20 }) {
  const cutoff = collaboratorRetentionCutoff(now);
  const heldIds = await heldCollaboratorIds(prismaClient);
  const where = collaboratorRetentionWhere(cutoff, heldIds);
  const [eligible, sample, inactiveWithoutTerminationDate] = await Promise.all([
    prismaClient.collaborator.count({ where }),
    prismaClient.collaborator.findMany({
      where, orderBy: { terminationDate: 'asc' }, take: sampleLimit, select: { id: true, code: true }
    }),
    prismaClient.collaborator.count({ where: { isActive: false, terminationDate: null, privacyAnonymizedAt: null } })
  ]);
  const onHold = heldIds.length;
  return {
    collaboratorAnonymizeBefore: cutoff.toISOString(),
    collaboratorsToAnonymize: eligible,
    collaboratorsToAnonymizeSample: sample.map(item => ({ id: item.id, code: item.code })),
    inactiveCollaboratorsWithoutTerminationDate: inactiveWithoutTerminationDate,
    collaboratorsOnRetentionHold: onHold
  };
}

// Anonimiza um colaborador dentro da transação recebida. Retorna null quando o
// colaborador deixou de ser elegível (exceção, já anonimizado ou reativado).
export async function anonymizeCollaborator(tx, collaboratorId, { now = new Date(), cutoff = collaboratorRetentionCutoff(now) } = {}) {
  const collaborator = await tx.collaborator.findFirst({
    where: { id: collaboratorId, ...collaboratorRetentionWhere(cutoff) },
    select: {
      id: true,
      code: true,
      conectaPerson: { select: { companyId: true, personId: true } },
      _count: { select: { epiRecords: true, epiSignatureRequests: true, reportLinks: true } }
    }
  });
  if (!collaborator) return null;
  // Exceção marcada depois da seleção vence (lida dentro da mesma transação).
  const hold = await tx.dataRetentionHold.findUnique({
    where: { kind_targetId: { kind: COLLABORATOR_HOLD_KIND, targetId: collaborator.id } }, select: { id: true }
  });
  if (hold) return null;

  const links = collaborator._count || {};
  const keepIdentity = (links.epiRecords || 0) + (links.epiSignatureRequests || 0) + (links.reportLinks || 0) > 0;
  const label = anonymizedCollaboratorName(collaborator.code);

  await tx.collaborator.update({
    where: { id: collaborator.id },
    data: {
      email: null,
      efetivoNote: null,
      signatureImage: null,
      privacyAnonymizedAt: now,
      ...(keepIdentity ? {} : { name: label, cpf: null, registrationNumber: null })
    }
  });
  const absences = await tx.collaboratorAbsence.deleteMany({ where: { collaboratorId: collaborator.id } });
  const aliases = await tx.pontoNameAlias.deleteMany({ where: { collaboratorId: collaborator.id } });
  const externalLinks = await tx.pontoExternalEmployeeLink.deleteMany({ where: { collaboratorId: collaborator.id } });
  const pontoSummaries = keepIdentity
    ? { count: 0 }
    : await tx.pontoPeriodSummary.updateMany({
      where: { collaboratorId: collaborator.id },
      data: { rawName: label, normalizedName: label.toLowerCase(), registrationNumber: null, externalEmployeeId: null }
    });

  let conectaAggregates = 0;
  const person = collaborator.conectaPerson;
  if (person?.personId) {
    const aggregates = await tx.conectaRhAggregate.findMany({
      where: {
        companyId: person.companyId,
        aggregateType: { in: CONECTA_PERSON_AGGREGATES },
        data: { path: ['personId'], equals: person.personId }
      },
      select: { id: true, aggregateType: true, data: true }
    });
    for (const aggregate of aggregates) {
      if (aggregate.data?.redactedAt) continue;
      await tx.conectaRhAggregate.update({
        where: { id: aggregate.id },
        data: { data: redactConectaAggregateData(aggregate.aggregateType, aggregate.data, now) }
      });
      conectaAggregates += 1;
    }
  }

  return {
    keepIdentity,
    absencesDeleted: absences.count,
    pontoAliasesDeleted: aliases.count + externalLinks.count,
    pontoSummariesAnonymized: pontoSummaries.count,
    conectaAggregatesRedacted: conectaAggregates
  };
}

export async function runCollaboratorRetention({
  prismaClient,
  now = new Date(),
  batchSize = 50,
  maxBatches = 20,
  lock = async () => {},
  onlyIds = null
}) {
  const cutoff = collaboratorRetentionCutoff(now);
  const baseWhere = collaboratorRetentionWhere(cutoff, await heldCollaboratorIds(prismaClient));
  // onlyIds restringe a execução (testes de integração em banco compartilhado).
  const where = onlyIds ? { AND: [baseWhere, { id: { in: onlyIds } }] } : baseWhere;
  const totals = {
    collaboratorsAnonymized: 0,
    collaboratorsIdentityKept: 0,
    collaboratorAbsencesDeleted: 0,
    pontoAliasesDeleted: 0,
    pontoSummariesAnonymized: 0,
    conectaAggregatesRedacted: 0,
    collaboratorBatches: 0
  };
  for (let index = 0; index < maxBatches; index += 1) {
    const candidates = await prismaClient.collaborator.findMany({
      where, orderBy: { terminationDate: 'asc' }, take: batchSize, select: { id: true }
    });
    if (!candidates.length) break;
    // Um colaborador por transação: falha em um não desfaz os anteriores e
    // nunca deixa um colaborador parcialmente anonimizado.
    let progressed = false;
    for (const { id } of candidates) {
      const result = await prismaClient.$transaction(async tx => {
        await lock(tx);
        return anonymizeCollaborator(tx, id, { now, cutoff });
      });
      if (!result) continue;
      progressed = true;
      totals.collaboratorsAnonymized += 1;
      if (result.keepIdentity) totals.collaboratorsIdentityKept += 1;
      totals.collaboratorAbsencesDeleted += result.absencesDeleted;
      totals.pontoAliasesDeleted += result.pontoAliasesDeleted;
      totals.pontoSummariesAnonymized += result.pontoSummariesAnonymized;
      totals.conectaAggregatesRedacted += result.conectaAggregatesRedacted;
    }
    totals.collaboratorBatches += 1;
    if (!progressed || candidates.length < batchSize) break;
  }
  return totals;
}
