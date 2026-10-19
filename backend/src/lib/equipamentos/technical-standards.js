import { isDeepStrictEqual } from 'node:util';

import { normalizeTechnicalSchema } from '../equipment-categories.js';

function standardError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

async function lockTechnicalStandard(tx, id) {
  // Serializa edição e novos vínculos para que uma associação concorrente não
  // grave uma cópia antiga depois da propagação dos campos às categorias.
  await tx.$queryRaw`SELECT "id" FROM "EquipmentTechnicalStandard" WHERE "id" = ${id} FOR UPDATE`;
  const standard = await tx.equipmentTechnicalStandard.findUnique({ where: { id } });
  if (!standard) throw standardError(404, 'Padrão de dados técnicos não encontrado.');
  return standard;
}

// Execute dentro da mesma transação que grava o padrão. A cópia na categoria
// mantém RDO, documentos e demais consumidores compatíveis com o schema antigo.
export async function updateTechnicalStandard(tx, id, data) {
  const previous = await lockTechnicalStandard(tx, id);
  const technicalSchema = data.technicalSchema === undefined
    ? previous.technicalSchema
    : normalizeTechnicalSchema(data.technicalSchema);
  const standard = await tx.equipmentTechnicalStandard.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.technicalSchema !== undefined ? { technicalSchema } : {})
    }
  });
  if (!isDeepStrictEqual(previous.technicalSchema, technicalSchema)) {
    await tx.equipmentCategory.updateMany({
      where: { technicalStandardId: id },
      data: { technicalSchema }
    });
    // Os PDFs anteriores continuam no histórico e passam a constar como desatualizados.
    await tx.companyEquipment.updateMany({
      where: { category: { technicalStandardId: id } },
      data: { technicalUpdatedAt: new Date() }
    });
  }
  return standard;
}

// A categoria já guarda uma cópia dos campos. Remove somente o vínculo e o
// cadastro compartilhado, mantendo formulários, documentos e valores existentes.
export async function removeTechnicalStandard(tx, id) {
  await lockTechnicalStandard(tx, id);
  await tx.equipmentCategory.updateMany({
    where: { technicalStandardId: id },
    data: { technicalStandardId: null }
  });
  await tx.equipmentTechnicalStandard.delete({ where: { id } });
}

// Compatibilidade com cadastros/importações que ainda enviam o schema inline.
// A seleção explícita de um padrão sempre prevalece sobre uma cópia do cliente.
export async function resolveCategoryTechnicalStandard(tx, data, previous = null) {
  if (data.technicalStandardId !== undefined) {
    if (data.technicalStandardId === null) {
      return { technicalStandardId: null, technicalSchema: previous?.technicalSchema ?? [] };
    }
    const standard = await lockTechnicalStandard(tx, data.technicalStandardId);
    return { technicalStandardId: standard.id, technicalSchema: standard.technicalSchema };
  }
  if (data.technicalSchema === undefined) return {};
  const technicalSchema = normalizeTechnicalSchema(data.technicalSchema);
  if (previous?.technicalStandardId) {
    const standard = await updateTechnicalStandard(tx, previous.technicalStandardId, { technicalSchema });
    return { technicalStandardId: standard.id, technicalSchema: standard.technicalSchema };
  }
  if (!technicalSchema.length) return { technicalStandardId: null, technicalSchema };
  const standard = await tx.equipmentTechnicalStandard.create({
    data: { name: data.name || previous?.name || 'Dados técnicos', technicalSchema }
  });
  return { technicalStandardId: standard.id, technicalSchema: standard.technicalSchema };
}

export async function saveCategoryTechnicalStandard(tx, id, data) {
  const previous = id ? await tx.equipmentCategory.findUnique({ where: { id } }) : null;
  if (id && !previous) throw standardError(404, 'Categoria não encontrada.');
  const selection = await resolveCategoryTechnicalStandard(tx, data, previous);
  const category = id
    ? await tx.equipmentCategory.update({ where: { id }, data: { ...data, ...selection } })
    : await tx.equipmentCategory.create({ data: { ...data, ...selection } });
  if (previous && selection.technicalSchema !== undefined && !isDeepStrictEqual(previous.technicalSchema, selection.technicalSchema)) {
    await tx.companyEquipment.updateMany({
      where: { categoryId: id },
      data: { technicalUpdatedAt: new Date() }
    });
  }
  return category;
}
