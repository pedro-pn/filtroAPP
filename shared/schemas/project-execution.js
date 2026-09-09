export const PROJECT_EXECUTION_REPORT_TYPES = [
  { key: 'RTP', label: 'RTP', source: 'SYSTEM' },
  { key: 'RLQ', label: 'RLQ', source: 'SYSTEM' },
  { key: 'RLR', label: 'RLR', source: 'MANUAL' },
  { key: 'RCPU', label: 'RCPU', source: 'SYSTEM' },
  { key: 'RLM', label: 'RLM', source: 'SYSTEM' },
  { key: 'RLF', label: 'RLF', source: 'SYSTEM' },
  { key: 'RLI', label: 'RLI', source: 'SYSTEM' }
];

export const PROJECT_EXECUTION_DEVIATION_CATEGORIES = [
  { key: 'PRAZO', label: 'Prazo' },
  { key: 'ESCOPO', label: 'Escopo' },
  { key: 'CLIENTE', label: 'Cliente' },
  { key: 'EQUIPAMENTO', label: 'Equipamento' },
  { key: 'PESSOAL', label: 'Pessoal' },
  { key: 'MATERIAL', label: 'Material' },
  { key: 'SEGURANCA', label: 'Segurança' },
  { key: 'QUALIDADE', label: 'Qualidade' },
  { key: 'COMERCIAL', label: 'Comercial' }
];

export const PROJECT_EXECUTION_IMPACTS = ['ALTO', 'MEDIO', 'BAIXO'];
export const PROJECT_EXECUTION_DEVIATION_STATUSES = ['ABERTO', 'EM_TRIAGEM', 'EM_OBSERVACAO', 'EM_ACAO', 'FECHADO', 'DIVULGADO'];

function dateOnlySchema(z) {
  return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.').refine(value => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Informe uma data válida.');
}

export function makeProjectExecutionSchemas(z) {
  const reportTypes = PROJECT_EXECUTION_REPORT_TYPES.map(item => item.key);
  const reportTargets = z.object({
    targets: z.array(z.object({
      reportType: z.enum(reportTypes),
      expectedCount: z.coerce.number().int().min(0).max(9999),
      completedCount: z.coerce.number().int().min(0).max(9999).optional()
    }).strict()).max(reportTypes.length)
  }).strict().superRefine((value, ctx) => {
    const seen = new Set();
    value.targets.forEach((target, index) => {
      if (seen.has(target.reportType)) ctx.addIssue({ code: 'custom', path: ['targets', index, 'reportType'], message: 'Tipo de relatório repetido.' });
      seen.add(target.reportType);
      if (target.reportType !== 'RLR' && target.completedCount !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['targets', index, 'completedCount'], message: 'A contagem realizada é automática para este tipo.' });
      }
      if (target.reportType === 'RLR' && target.expectedCount > 0 && (target.completedCount || 0) > target.expectedCount) {
        ctx.addIssue({ code: 'custom', path: ['targets', index, 'completedCount'], message: 'O realizado não pode superar a meta.' });
      }
    });
  });
  const deviationCreate = z.object({
    category: z.enum(PROJECT_EXECUTION_DEVIATION_CATEGORIES.map(item => item.key)),
    description: z.string().trim().min(1, 'Informe o desvio.').max(4000),
    ownerName: z.string().trim().min(1, 'Informe o responsável.').max(180),
    dueDate: dateOnlySchema(z),
    impact: z.enum(PROJECT_EXECUTION_IMPACTS),
    action: z.string().trim().min(1, 'Informe a ação definida.').max(4000),
    status: z.enum(PROJECT_EXECUTION_DEVIATION_STATUSES)
  }).strict();
  const deviationStatus = z.object({ status: z.enum(PROJECT_EXECUTION_DEVIATION_STATUSES) }).strict();
  return { reportTargets, deviationCreate, deviationStatus };
}
