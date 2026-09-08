const ITEM_TYPES = ['FILTRO', 'PRODUTO_QUIMICO'];
const MOVEMENT_TYPES = ['ENTRADA', 'SAIDA'];
const CHEMICAL_UNITS = ['kg', 'L'];
const MAX_CHECKLIST_ITEMS = 100;
const MAX_CHECKLIST_ITEM_LENGTH = 300;

function optionalText(z, max) {
  let schema = z.string().trim();
  if (Number.isInteger(max)) schema = schema.max(max);
  return schema.optional().nullable().transform(value => {
    const text = String(value || '').trim();
    return text || null;
  });
}

function requiredText(z, max, message = 'Campo obrigatório.') {
  let schema = z.string().trim().min(1, message);
  if (Number.isInteger(max)) schema = schema.max(max);
  return schema;
}

function decimalNumber(z, { positive = false, nonnegative = false, scale = 3 } = {}) {
  return z.union([z.number(), z.string()])
    .transform(value => {
      if (typeof value === 'number') return value;
      const normalized = value.trim().replace(',', '.');
      return normalized === '' ? Number.NaN : Number(normalized);
    })
    .superRefine((value, ctx) => {
      if (!Number.isFinite(value)) {
        ctx.addIssue({ code: 'custom', message: 'Informe um número válido.' });
        return;
      }
      if (positive && value <= 0) {
        ctx.addIssue({ code: 'custom', message: 'Informe um valor maior que zero.' });
      }
      if (nonnegative && value < 0) {
        ctx.addIssue({ code: 'custom', message: 'Informe um valor maior ou igual a zero.' });
      }
      const [, decimal = ''] = String(value).split('.');
      if (decimal.length > scale) {
        ctx.addIssue({ code: 'custom', message: `Use no máximo ${scale} casas decimais.` });
      }
    });
}

function optionalDecimalNumber(z, options) {
  return z.any().optional().nullable()
    .transform(value => {
      if (value === null || value === undefined || value === '') return null;
      if (typeof value === 'number') return value;
      if (typeof value !== 'string') return Number.NaN;
      const normalized = value.trim().replace(',', '.');
      return normalized === '' ? null : Number(normalized);
    })
    .superRefine((value, ctx) => {
      if (value === null) return;
      const parsed = decimalNumber(z, options).safeParse(value);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) ctx.addIssue(issue);
      }
    });
}

function checklistItemsSchema(z) {
  return z.array(z.string().trim().min(1).max(MAX_CHECKLIST_ITEM_LENGTH)).max(MAX_CHECKLIST_ITEMS).optional().nullable();
}

function itemBaseSchema(z) {
  return {
    categoryId: optionalText(z, 80),
    code: requiredText(z, 60),
    name: requiredText(z, 180),
    manufacturer: optionalText(z, 180),
    description: optionalText(z, 1000),
    minQuantity: optionalDecimalNumber(z, { nonnegative: true, scale: 3 }),
    location: optionalText(z, 180)
  };
}

function forbidFields(data, fields, ctx) {
  for (const field of fields) {
    if (data[field] !== null && data[field] !== undefined && data[field] !== '') {
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: 'Campo incompatível com o tipo do item.'
      });
    }
  }
}

function stockItemCreateSchema(z) {
  const filter = z.object({
    type: z.literal('FILTRO'),
    ...itemBaseSchema(z),
    filterModel: optionalText(z, 180),
    filterKind: optionalText(z, 120),
    filterMicron: optionalText(z, 60),
    unitLabel: optionalText(z, 20),
    unNumber: optionalText(z, 80),
    casNumber: optionalText(z, 80),
    checklistEnabled: z.boolean().optional(),
    checklistItems: checklistItemsSchema(z)
  });

  const chemical = z.object({
    type: z.literal('PRODUTO_QUIMICO'),
    ...itemBaseSchema(z),
    unitLabel: z.enum(CHEMICAL_UNITS),
    unNumber: optionalText(z, 80),
    casNumber: optionalText(z, 80),
    filterModel: optionalText(z, 180),
    filterKind: optionalText(z, 120),
    filterMicron: optionalText(z, 60),
    checklistEnabled: z.boolean().optional(),
    checklistItems: checklistItemsSchema(z)
  });

  return z.discriminatedUnion('type', [filter, chemical])
    .superRefine((data, ctx) => {
      if (data.type === 'FILTRO') {
        forbidFields(data, ['unitLabel', 'unNumber', 'casNumber'], ctx);
      } else {
        forbidFields(data, ['filterModel', 'filterKind', 'filterMicron'], ctx);
      }
    })
    .transform(data => {
      if (data.type === 'FILTRO') {
        return {
          ...data,
          unitLabel: 'un',
          unNumber: null,
          casNumber: null,
          checklistEnabled: Boolean(data.checklistEnabled),
          checklistItems: data.checklistItems === undefined ? null : data.checklistItems
        };
      }
      return {
        ...data,
        filterModel: null,
        filterKind: null,
        filterMicron: null,
        casNumber: data.casNumber,
        checklistEnabled: Boolean(data.checklistEnabled),
        checklistItems: data.checklistItems === undefined ? null : data.checklistItems
      };
    });
}

function stockItemUpdateSchema(z, type) {
  const base = itemBaseSchema(z);

  if (type === 'FILTRO') {
    return z.object({
      ...base,
      filterModel: optionalText(z, 180),
      filterKind: optionalText(z, 120),
      filterMicron: optionalText(z, 60),
      unitLabel: optionalText(z, 20),
      unNumber: optionalText(z, 80),
      casNumber: optionalText(z, 80),
      checklistEnabled: z.boolean().optional(),
      checklistItems: checklistItemsSchema(z)
    }).superRefine((data, ctx) => {
      forbidFields(data, ['unitLabel', 'unNumber', 'casNumber'], ctx);
    }).transform(data => ({
      ...data,
      unitLabel: 'un',
      unNumber: null,
      casNumber: null,
      checklistEnabled: Boolean(data.checklistEnabled),
      checklistItems: data.checklistItems === undefined ? null : data.checklistItems
    }));
  }

  if (type === 'PRODUTO_QUIMICO') {
    return z.object({
      ...base,
      unitLabel: z.enum(CHEMICAL_UNITS),
      unNumber: optionalText(z, 80),
      casNumber: optionalText(z, 80),
      filterModel: optionalText(z, 180),
      filterKind: optionalText(z, 120),
      filterMicron: optionalText(z, 60),
      checklistEnabled: z.boolean().optional(),
      checklistItems: checklistItemsSchema(z)
    }).superRefine((data, ctx) => {
      forbidFields(data, ['filterModel', 'filterKind', 'filterMicron'], ctx);
    }).transform(data => ({
      ...data,
      filterModel: null,
      filterKind: null,
      filterMicron: null,
      casNumber: data.casNumber,
      checklistEnabled: Boolean(data.checklistEnabled),
      checklistItems: data.checklistItems === undefined ? null : data.checklistItems
    }));
  }

  throw new Error(`Tipo de item inválido: ${type}`);
}

function movementBaseSchema(z) {
  return {
    itemId: requiredText(z, 80),
    quantity: decimalNumber(z, { positive: true, scale: 3 }),
    date: requiredText(z, 40),
    notes: optionalText(z, 1000)
  };
}

function requireNotes(data, ctx) {
  if (!data.notes) {
    ctx.addIssue({ code: 'custom', path: ['notes'], message: 'Informe a justificativa.' });
  }
}

function stockMovementSchema(z, { itemType } = {}) {
  const base = movementBaseSchema(z);
  const batchId = requiredText(z, 80);
  const projectId = requiredText(z, 80);

  const compra = z.object({
    reason: z.literal('COMPRA'),
    type: z.literal('ENTRADA').default('ENTRADA'),
    ...base,
    nfNumber: requiredText(z, 80),
    lotNumber: optionalText(z, 120),
    expiryDate: optionalText(z, 40),
    supplier: optionalText(z, 180),
    unitCost: optionalDecimalNumber(z, { nonnegative: true, scale: 2 })
  });

  const devolucao = z.object({
    reason: z.literal('DEVOLUCAO_OBRA'),
    type: z.literal('ENTRADA').default('ENTRADA'),
    ...base,
    projectId,
    batchId
  });

  const uso = z.object({
    reason: z.literal('USO_EM_PROJETO'),
    type: z.literal('SAIDA').default('SAIDA'),
    ...base,
    projectId,
    batchId,
    requestedBy: optionalText(z, 180),
    confirmExpired: z.boolean().optional().default(false)
  });

  const perda = z.object({
    reason: z.literal('PERDA'),
    type: z.literal('SAIDA').default('SAIDA'),
    ...base,
    batchId
  });

  const descarte = z.object({
    reason: z.literal('DESCARTE_VALIDADE'),
    type: z.literal('SAIDA').default('SAIDA'),
    ...base,
    batchId
  });

  const inventario = z.object({
    reason: z.literal('INVENTARIO'),
    type: z.enum(MOVEMENT_TYPES),
    ...base,
    batchId
  });

  const estorno = z.object({
    reason: z.literal('ESTORNO'),
    type: z.enum(MOVEMENT_TYPES),
    ...base,
    batchId,
    reversalOfId: requiredText(z, 80)
  });

  return z.discriminatedUnion('reason', [compra, devolucao, uso, perda, descarte, inventario, estorno])
    .superRefine((data, ctx) => {
      if (['PERDA', 'DESCARTE_VALIDADE', 'INVENTARIO'].includes(data.reason)) {
        requireNotes(data, ctx);
      }
      if (itemType === 'FILTRO' && !Number.isInteger(data.quantity)) {
        ctx.addIssue({
          code: 'custom',
          path: ['quantity'],
          message: 'Filtros aceitam apenas quantidades inteiras.'
        });
      }
      if (itemType === 'PRODUTO_QUIMICO' && data.reason === 'COMPRA') {
        if (!data.lotNumber) {
          ctx.addIssue({ code: 'custom', path: ['lotNumber'], message: 'Informe o lote do produto químico.' });
        }
        if (!data.expiryDate) {
          ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: 'Informe a validade do produto químico.' });
        }
      }
    });
}

function stockReturnMovementsSchema(z) {
  return z.object({
    reason: z.literal('DEVOLUCAO_OBRA'),
    projectId: requiredText(z, 80),
    date: requiredText(z, 40),
    notes: optionalText(z, 1000),
    items: z.array(z.object({
      itemId: requiredText(z, 80),
      batchId: requiredText(z, 80),
      quantity: decimalNumber(z, { positive: true, scale: 3 })
    })).min(1, 'Adicione ao menos um produto.').max(100, 'Limite de 100 produtos por devolução.')
  }).superRefine((data, ctx) => {
    const batches = new Set();
    data.items.forEach((item, index) => {
      const key = `${item.itemId}:${item.batchId}`;
      if (batches.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'batchId'],
          message: 'Este produto e lote já foram adicionados.'
        });
      }
      batches.add(key);
    });
  });
}

export function makeEstoqueSchemas(z) {
  if (!z?.object || !z?.discriminatedUnion) {
    throw new TypeError('A valid Zod instance is required to build estoque schemas.');
  }

  return {
    ITEM_TYPES,
    MOVEMENT_TYPES,
    CHEMICAL_UNITS,
    itemCreate: stockItemCreateSchema(z),
    itemUpdateForType: type => stockItemUpdateSchema(z, type),
    movement: options => stockMovementSchema(z, options),
    returnMovements: stockReturnMovementsSchema(z),
    activePatch: z.object({ isActive: z.boolean() }),
    reverseMovement: z.object({ notes: optionalText(z, 1000) })
  };
}
