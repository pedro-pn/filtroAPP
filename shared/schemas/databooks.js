export function validDatabookDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function makeDatabookSchemas(z) {
  const date = z.string().refine(validDatabookDate, 'Informe uma data válida.');
  const id = z.string().trim().min(1).max(160);
  const period = z.object({ startDate: date, endDate: date }).strict().refine(
    value => value.startDate <= value.endDate,
    { path: ['endDate'], message: 'A data final deve ser igual ou posterior à inicial.' }
  );
  const unique = (values, ctx, field, key = value => value) => {
    if (new Set(values.map(key)).size !== values.length) ctx.addIssue({
      code: 'custom', path: [field], message: 'Há seleções repetidas.'
    });
  };
  const create = z.object({
    title: z.string().trim().min(1, 'Informe a etapa ou o título.').max(160, 'Use até 160 caracteres no título.'),
    startDate: date,
    endDate: date,
    summary: z.string().trim().max(5000, 'Use até 5000 caracteres no resumo.').default(''),
    productsReviewed: z.literal(true),
    reportIds: z.array(id).min(1, 'Selecione ao menos um relatório.').max(500),
    photos: z.array(z.object({
      key: id,
      caption: z.string().trim().max(500, 'Use até 500 caracteres na legenda.').default(''),
      tag: z.string().trim().max(120, 'Use até 120 caracteres no TAG.').default(''),
      phase: z.enum(['UNSPECIFIED', 'BEFORE', 'DURING', 'AFTER']).default('UNSPECIFIED')
    }).strict()).max(500).default([]),
    products: z.array(z.object({
      itemId: id, documentId: id,
      revision: z.string().trim().min(1, 'Informe a revisão/data da FDS conferida.').max(160),
      confirmed: z.literal(true)
    }).strict()).max(100).default([]),
    documentVersionIds: z.array(id).max(100).default([]),
    previousId: id.optional()
  }).strict().superRefine((value, ctx) => {
    if (value.startDate > value.endDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'A data final deve ser igual ou posterior à inicial.' });
    unique(value.reportIds, ctx, 'reportIds');
    unique(value.photos, ctx, 'photos', item => item.key);
    unique(value.products, ctx, 'products', item => item.itemId);
    unique(value.documentVersionIds, ctx, 'documentVersionIds');
  });
  return { period, create, empty: z.object({}).strict() };
}
