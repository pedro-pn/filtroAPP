export const QUALITY_RECORD_TYPES = ['DESVIO', 'LICAO_APRENDIDA', 'INCIDENTE', 'RECLAMACAO_CLIENTE', 'MELHORIA'];
export const QUALITY_EVIDENCE_KINDS = ['LINK', 'ATTACHMENT'];
export const QUALITY_IMPACTS = ['ALTO', 'MEDIO', 'BAIXO'];
export const QUALITY_DISPOSITIONS = ['TRATAR', 'MONITORAR', 'ARQUIVAR_DIVULGAR'];
export const QUALITY_STATUSES = ['ABERTO', 'EM_TRIAGEM', 'EM_OBSERVACAO', 'EM_ACAO', 'FECHADO', 'DIVULGADO'];

export const QUALITY_TYPE_LETTERS = {
  DESVIO: 'D',
  LICAO_APRENDIDA: 'L',
  INCIDENTE: 'I',
  RECLAMACAO_CLIENTE: 'R',
  MELHORIA: 'M'
};

export const QUALITY_TYPE_OPTIONS = [
  { value: 'DESVIO', label: 'Desvio', letter: 'D' },
  { value: 'LICAO_APRENDIDA', label: 'Lição aprendida', letter: 'L' },
  { value: 'INCIDENTE', label: 'Incidente', letter: 'I' },
  { value: 'RECLAMACAO_CLIENTE', label: 'Reclamação de cliente', letter: 'R' },
  { value: 'MELHORIA', label: 'Melhoria', letter: 'M' }
];

export const QUALITY_IMPACT_OPTIONS = [
  { value: 'ALTO', label: 'Alto' },
  { value: 'MEDIO', label: 'Médio' },
  { value: 'BAIXO', label: 'Baixo' }
];

export const QUALITY_DISPOSITION_OPTIONS = [
  { value: 'TRATAR', label: 'Tratar' },
  { value: 'MONITORAR', label: 'Monitorar' },
  { value: 'ARQUIVAR_DIVULGAR', label: 'Arquivar/Divulgar' }
];

export const QUALITY_STATUS_OPTIONS = [
  { value: 'ABERTO', label: 'Aberto' },
  { value: 'EM_TRIAGEM', label: 'Em triagem' },
  { value: 'EM_OBSERVACAO', label: 'Em observação' },
  { value: 'EM_ACAO', label: 'Em ação' },
  { value: 'FECHADO', label: 'Fechado' },
  { value: 'DIVULGADO', label: 'Divulgado' }
];

function optionalText(z, max) {
  let schema = z.string().trim();
  if (Number.isInteger(max)) schema = schema.max(max);
  return z.any().optional().nullable().transform(value => {
    const text = String(value || '').trim();
    return text || null;
  }).pipe(schema.optional().nullable());
}

function requiredText(z, max, message = 'Campo obrigatório.') {
  let schema = z.string().trim().min(1, message);
  if (Number.isInteger(max)) schema = schema.max(max);
  return schema;
}

function optionalEnum(z, values) {
  return z.any().optional().nullable().transform(value => {
    const text = String(value || '').trim();
    return text || null;
  }).pipe(z.enum(values).optional().nullable());
}

function optionalUrl(z) {
  return z.any().optional().nullable().transform(value => {
    const text = String(value || '').trim();
    return text || null;
  }).refine(value => {
    if (value === null) return true;
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol);
    } catch {
      return false;
    }
  }, { message: 'Informe um link válido.' });
}

function evidenceItemSchema(z) {
  return z.object({
    id: optionalText(z, 120),
    kind: z.enum(QUALITY_EVIDENCE_KINDS),
    label: optionalText(z, 180),
    url: optionalUrl(z),
    fileName: optionalText(z, 240),
    mimeType: optionalText(z, 120),
    dataUrl: optionalText(z)
  });
}

function evidencesSchema(z) {
  return z.array(evidenceItemSchema(z)).max(20, 'Informe no máximo 20 evidências.').optional().default([]);
}

function dateText(z, message = 'Informe uma data válida.') {
  return z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, message);
}

function optionalDateText(z) {
  return z.any().optional().nullable().transform(value => {
    const text = String(value || '').trim();
    return text || null;
  }).refine(value => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value), {
    message: 'Informe uma data válida.'
  });
}

function recordBaseSchema(z, { includeType = true } = {}) {
  return {
    ...(includeType ? { type: z.enum(QUALITY_RECORD_TYPES) } : {}),
    registeredAt: dateText(z),
    origin: optionalText(z, 180),
    projectId: optionalText(z, 80),
    eventDate: dateText(z),
    natureId: optionalText(z, 80),
    description: optionalText(z, 4000),
    impact: optionalEnum(z, QUALITY_IMPACTS),
    linkedRnc: optionalText(z, 120),
    disposition: optionalEnum(z, QUALITY_DISPOSITIONS),
    definedAction: optionalText(z, 4000),
    actionOwner: optionalText(z, 180),
    actionDeadline: optionalDateText(z),
    evidence: optionalUrl(z),
    evidences: evidencesSchema(z),
    resultVerification: optionalText(z, 4000),
    status: optionalEnum(z, QUALITY_STATUSES)
  };
}

function recordSchema(z, options = {}) {
  return z.object(recordBaseSchema(z, options)).superRefine((data, ctx) => {
    const recordType = options.includeType === false ? options.recordType : data.type;
    if (recordType === 'DESVIO') {
      [
        ['origin', data.origin],
        ['natureId', data.natureId],
        ['description', data.description],
        ['impact', data.impact],
        ['disposition', data.disposition],
        ['status', data.status]
      ].forEach(([path, value]) => {
        if (value) return;
        ctx.addIssue({ code: 'custom', path: [path], message: 'Campo obrigatório.' });
      });
    }
    if (recordType === 'DESVIO' && data.disposition === 'TRATAR' && !data.definedAction) {
      ctx.addIssue({
        code: 'custom',
        path: ['definedAction'],
        message: 'Informe a ação definida para disposição Tratar.'
      });
    }
    const evidences = Array.isArray(data.evidences) ? data.evidences : [];
    evidences.forEach((evidence, index) => {
      if (evidence.kind === 'LINK' && !evidence.url) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidences', index, 'url'],
          message: 'Informe o link da evidência.'
        });
      }
      if (evidence.kind === 'ATTACHMENT' && !evidence.id && (!evidence.fileName || !evidence.dataUrl)) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidences', index, 'fileName'],
          message: 'Selecione uma imagem ou PDF para a evidência.'
        });
      }
      if (evidence.kind === 'ATTACHMENT' && evidence.url) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidences', index, 'url'],
          message: 'Anexos não devem ter link.'
        });
      }
      if (evidence.kind === 'LINK' && evidence.dataUrl) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidences', index, 'dataUrl'],
          message: 'Links não devem ter arquivo anexado.'
        });
      }
    });
  });
}

function natureSchema(z) {
  return z.object({
    name: requiredText(z, 180)
  });
}

function natureOrderSchema(z) {
  return z.object({
    ids: z.array(requiredText(z, 80)).min(1, 'Informe a ordem das Naturezas.').max(300, 'Informe no máximo 300 Naturezas por ordenação.')
  });
}

export function makeQualidadeSchemas(z) {
  if (!z?.object || !z?.enum) {
    throw new TypeError('A valid Zod instance is required to build qualidade schemas.');
  }

  const recordUpdateForType = type => {
    if (!QUALITY_RECORD_TYPES.includes(type)) throw new TypeError('Tipo de registro de qualidade inválido.');
    return recordSchema(z, { includeType: false, recordType: type });
  };

  return {
    RECORD_TYPES: QUALITY_RECORD_TYPES,
    EVIDENCE_KINDS: QUALITY_EVIDENCE_KINDS,
    IMPACTS: QUALITY_IMPACTS,
    DISPOSITIONS: QUALITY_DISPOSITIONS,
    STATUSES: QUALITY_STATUSES,
    TYPE_LETTERS: QUALITY_TYPE_LETTERS,
    typeOptions: QUALITY_TYPE_OPTIONS,
    impactOptions: QUALITY_IMPACT_OPTIONS,
    dispositionOptions: QUALITY_DISPOSITION_OPTIONS,
    statusOptions: QUALITY_STATUS_OPTIONS,
    recordCreate: recordSchema(z),
    recordUpdate: recordUpdateForType('DESVIO'),
    recordUpdateForType,
    natureCreate: natureSchema(z),
    natureUpdate: natureSchema(z),
    natureOrder: natureOrderSchema(z),
    activePatch: z.object({ isActive: z.boolean() })
  };
}
