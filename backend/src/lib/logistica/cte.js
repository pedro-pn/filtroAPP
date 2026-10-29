import { DOMParser } from '@xmldom/xmldom';
import { z } from 'zod';
import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { assertUnloadingUser } from './unloading.js';

export function parseCte(response) {
  const xml = response.cXmlCTe;
  if (typeof xml !== 'string' || xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new IntegrationApiError(422, 'INVALID_CTE', 'XML de CT-e inválido.');
  const errors = [];
  let document;
  try { document = new DOMParser({ onError: (_level, message) => errors.push(message) }).parseFromString(xml, 'text/xml'); }
  catch { throw new IntegrationApiError(422, 'INVALID_CTE', 'XML de CT-e inválido.'); }
  const inf = document.getElementsByTagNameNS('*', 'infCte');
  if (errors.length || inf.length !== 1 || inf[0].namespaceURI !== 'http://www.portalfiscal.inf.br/cte') throw new IntegrationApiError(422, 'INVALID_CTE', 'O documento precisa ser um CT-e válido.');
  const field = (root, name) => root?.getElementsByTagNameNS('*', name)[0]?.textContent?.trim();
  const ide = inf[0].getElementsByTagNameNS('*', 'ide')[0];
  const emit = inf[0].getElementsByTagNameNS('*', 'emit')[0];
  const numero = field(ide, 'nCT'), date = field(ide, 'dhEmi'), transportadora = field(emit, 'xNome');
  if (!numero || !date || !z.iso.datetime({ offset: true }).safeParse(date).success || !transportadora
    || !['57', '67'].includes(field(ide, 'mod'))) throw new IntegrationApiError(422, 'INVALID_CTE', 'CT-e sem número, emissão ou transportadora válidos.');
  if (response.cNumCTe && String(response.cNumCTe).replace(/^0+/, '') !== numero.replace(/^0+/, '')) throw new IntegrationApiError(422, 'INVALID_CTE', 'Número do CT-e diverge do XML.');
  const nfeKeys = [...inf[0].getElementsByTagNameNS('*', 'infNFe')].map(node => field(node, 'chave')).filter(Boolean);
  return { numero, emissao: new Date(date), transportadora, nfeKeys };
}
export async function importCte(client, romaneioId, input, user, call) {
  const { omieId, invoiceId } = z.object({ omieId: z.string().regex(/^[1-9]\d{0,14}$/), invoiceId: z.string().min(1).max(100).optional() }).strict().parse(input);
  const romaneio = await client.romaneio.findFirst({ where: { id: romaneioId, type: 'OUTBOUND', project: { deletedAt: null } }, select: { projectId: true } });
  if (!romaneio) throw new IntegrationApiError(404, 'NOT_FOUND', 'Romaneio de saída não encontrado.');
  await assertUnloadingUser(client, romaneio.projectId, user.email || '', user.id);
  // Consulta externa somente no fluxo interno, nunca na escrita simulável de descarga.
  const response = await call('/produtos/dfedocs/', 'ObterCTe', { nIdCTe: Number(omieId) });
  const data = parseCte(response);
  return client.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Romaneio" WHERE id=${romaneioId} FOR UPDATE`;
    const current = await tx.romaneio.findFirst({ where: { id: romaneioId, type: 'OUTBOUND', project: { deletedAt: null } }, select: { projectId: true } });
    if (current?.projectId !== romaneio.projectId) throw new IntegrationApiError(409, 'ROMANEIO_CHANGED', 'O romaneio mudou durante a consulta ao Omie. Recarregue e tente novamente.');
    await assertUnloadingUser(tx, romaneio.projectId, user.email || '', user.id);
    if (invoiceId) {
      const invoice = await tx.omieInvoice.findFirst({ where: { id: invoiceId }, select: { codigoProjeto: true } });
      const mapping = invoice && await tx.omieProject.findUnique({ where: { codigo: invoice.codigoProjeto }, select: { projectId: true } });
      if (mapping?.projectId !== romaneio.projectId) throw new IntegrationApiError(422, 'INVOICE_PROJECT_MISMATCH', 'A nota deve estar vinculada ao mesmo projeto.');
    }
    const existing = await tx.logisticsCte.findUnique({ where: { omieId } });
    if (existing && (existing.romaneioId !== romaneioId || existing.projectId !== romaneio.projectId)) throw new IntegrationApiError(409, 'CTE_ALREADY_LINKED', 'O CT-e já está vinculado a outro romaneio.');
    // Documento importado é imutável após uso; reimportação idêntica reaproveita o vínculo.
    if (existing) return existing;
    return tx.logisticsCte.create({ data: { ...data, omieId, romaneioId, projectId: romaneio.projectId,
      invoiceId: invoiceId || null, createdByUserId: user.id } });
  });
}
