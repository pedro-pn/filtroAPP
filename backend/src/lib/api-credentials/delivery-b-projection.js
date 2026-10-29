import { Prisma } from '@prisma/client';
import { MEASUREMENT_VALUE_SCOPE } from './delivery-b-resources.js';

export function projectMeasurement(row, context = { scopes: new Set() }) {
  const m = row.workflow?.measurement;
  return { projectId: row.id, projectCode: row.code, preparedAt: m?.preparedAt ?? null, sentAt: m?.sentAt ?? null,
    approvedAt: m?.approvedAt ?? null, situacao: m?.approvedAt ? 'APROVADA' : m?.sentAt ? 'ENVIADA' : m?.preparedAt ? 'PREPARADA' : 'SEM_MEDICAO',
    saldoPendente: m?.approvedAmount == null || m?.executedAmount == null ? null
      : new Prisma.Decimal(m.approvedAmount).lt(m.executedAmount), updatedAt: row.updatedAt,
    ...(context.scopes.has(MEASUREMENT_VALUE_SCOPE) ? { executedAmount: m?.executedAmount ?? null,
      measuredAmount: m?.measuredAmount ?? null, approvedAmount: m?.approvedAmount ?? null, currency: 'BRL' } : {}) };
}
export const projectRomaneio = row => ({ id: row.id, projectId: row.projectId, projectCode: row.project?.code,
  tipo: row.type === 'OUTBOUND' ? 'SAIDA' : 'RETORNO', data: row.romaneioDate, emitidoEm: row.emittedAt,
  quantidadeItens: row._count?.items ?? 0, pesoCarga: row.cargoWeight, unidadePeso: row.cargoWeightUnit, updatedAt: row.updatedAt });
export const projectUnloading = row => ({ ...row, projectCode: row.project?.code,
  cte: row.cte ? { numero: row.cte.numero, emissao: new Date(row.cte.emissao).toISOString(), transportadora: row.cte.transportadora } : null });

// Na ausência de saldo confiável de um título parcial, não afirmar que ele está quitado.
function openAmount(row, received) {
  const status = String(row.statusTitulo || '').trim().toUpperCase();
  if (/CANCELAD|^C$/.test(status) || (received ? status === 'RECEBIDO' : status === 'PAGO')) return undefined;
  if (/PARCIAL/.test(status)) {
    const raw = row.rawPayload || {};
    const balance = raw.valor_em_aberto ?? raw.saldo_em_aberto;
    if (balance != null && /^\d+(\.\d+)?$/.test(String(balance))) return new Prisma.Decimal(balance);
    return null;
  }
  return row.valor == null ? null : new Prisma.Decimal(row.valor);
}
function aggregate(rows, received) {
  let amount = new Prisma.Decimal(0), unknown = false, count = 0, next = null;
  for (const row of rows) {
    const value = openAmount(row, received);
    if (value === undefined || value?.lte(0)) continue;
    count++;
    if (value === null) unknown = true; else amount = amount.plus(value);
    if (row.dataVencimento && (!next || row.dataVencimento < next)) next = row.dataVencimento;
  }
  return { quantidade: count, valorEmAberto: unknown ? null : amount.toFixed(2), proximoVencimento: next?.toISOString() ?? null };
}
export async function enrichProjectPending(client, rows) {
  if (!rows.length) return rows;
  const select = { projectId: true, statusTitulo: true, valor: true, dataVencimento: true, rawPayload: true };
  const where = { projectId: { in: rows.map(row => row.id) } };
  const [purchases, receivables] = await Promise.all([
    client.omiePurchase.findMany({ where, select }), client.omieReceivable.findMany({ where, select })
  ]);
  return rows.map(row => ({ ...row, projectId: row.id, projectCode: row.code, atualizadoEm: row.updatedAt,
    aPagar: aggregate(purchases.filter(item => item.projectId === row.id), false),
    aReceber: aggregate(receivables.filter(item => item.projectId === row.id), true) }));
}
