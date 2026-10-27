import { z } from 'zod';
import { makeEstoqueSchemas } from '../../../../shared/schemas/estoque.js';
import type { StockItem, StockMovementPayload, StockMovementReason, StockMovementType } from '../../api/estoque';

export interface MovementFormValues {
  reason: Exclude<StockMovementReason, 'ESTORNO'>;
  movementType: StockMovementType;
  projectId: string;
  date: string;
  nfNumber: string;
  supplier: string;
  requestedBy: string;
  notes: string;
}

export interface MovementLine {
  id: number;
  itemId: string;
  batchId: string;
  quantity: string;
  lotNumber: string;
  expiryDate: string;
  unitCost: string;
}

let lineSequence = 0;
const schemas = makeEstoqueSchemas(z);

export function createMovementLine(): MovementLine {
  return { id: ++lineSequence, itemId: '', batchId: '', quantity: '', lotNumber: '', expiryDate: '', unitCost: '' };
}

export function formatUnitCost(value: string) {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  return `R$ ${(Number(digits) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function parseUnitCost(value: string) {
  if (!value) return undefined;
  return Number(value.replace(/\D/g, '')) / 100;
}

function optionalValue(value: string) {
  return value.trim() || undefined;
}

export function movementLineToPayload(values: MovementFormValues, line: MovementLine): StockMovementPayload {
  const base = {
    reason: values.reason,
    itemId: line.itemId,
    quantity: line.quantity,
    date: values.date,
    notes: optionalValue(values.notes)
  };
  if (values.reason === 'COMPRA') {
    return {
      ...base, type: 'ENTRADA', nfNumber: values.nfNumber,
      supplier: optionalValue(values.supplier), unitCost: parseUnitCost(line.unitCost),
      lotNumber: optionalValue(line.lotNumber), expiryDate: optionalValue(line.expiryDate)
    };
  }
  if (values.reason === 'DEVOLUCAO_OBRA' || values.reason === 'USO_EM_PROJETO') {
    return {
      ...base, type: values.reason === 'DEVOLUCAO_OBRA' ? 'ENTRADA' : 'SAIDA',
      batchId: line.batchId, projectId: values.projectId, requestedBy: optionalValue(values.requestedBy)
    };
  }
  return { ...base, type: values.reason === 'INVENTARIO' ? values.movementType : 'SAIDA', batchId: line.batchId };
}

export function validateMovementLines(values: MovementFormValues, lines: MovementLine[], items: StockItem[]) {
  const fieldErrors: Partial<Record<keyof MovementFormValues, string>> = {};
  const lineErrors: Record<number, string> = {};
  const payloads = lines.map(line => movementLineToPayload(values, line));
  const labels: Record<string, string> = {
    itemId: 'Produto', batchId: 'Lote', quantity: 'Quantidade', lotNumber: 'Lote', expiryDate: 'Validade', unitCost: 'Custo unitário'
  };
  const seenBatches = new Set<string>();
  lines.forEach((line, index) => {
    const item = items.find(option => option.id === line.itemId);
    const result = schemas.movement({ itemType: item?.type }).safeParse(payloads[index]);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = String(issue.path[0]);
        if (Object.hasOwn(values, field)) {
          fieldErrors[field as keyof MovementFormValues] = issue.message;
        } else if (!lineErrors[line.id]) {
          lineErrors[line.id] = `${labels[field] || field}: ${issue.message}`;
        }
      }
    }
    if (!item) lineErrors[line.id] = 'Selecione o produto.';
    if (values.reason === 'DEVOLUCAO_OBRA') {
      const key = `${line.itemId}:${line.batchId}`;
      if (seenBatches.has(key)) lineErrors[line.id] = 'Este produto e lote já foram adicionados.';
      seenBatches.add(key);
    }
  });
  const formError = !lines.length ? 'Adicione ao menos um item.' : lines.length > 100 ? 'Limite de 100 itens por operação.' : '';
  return { payloads, fieldErrors, lineErrors, formError };
}
