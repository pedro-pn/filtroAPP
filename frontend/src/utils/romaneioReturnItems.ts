import type { RomaneioItemKind, RomaneioMeasureType } from '../api/romaneio';

export interface RomaneioReturnKeyFields {
  catalogItemId?: string | null;
  itemCode?: string | null;
  itemName: string;
  categoryName: string;
  kind: RomaneioItemKind;
  measureType: RomaneioMeasureType;
  unitLabel: string;
}

export interface RomaneioReturnSelection extends RomaneioReturnKeyFields {
  key: string;
  quantity: number;
  isExtra?: boolean;
  returnMaxQuantity?: number;
}

function returnKeyPart(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase();
}

// Espelha romaneioItemReturnKey do backend: itens de saída e de entrada são
// casados pelo item de catálogo ou, na falta dele, pelo snapshot do item.
export function romaneioReturnKey(item: RomaneioReturnKeyFields) {
  if (item.catalogItemId) return `catalog:${item.catalogItemId}`;
  return [
    'snapshot',
    returnKeyPart(item.itemCode),
    returnKeyPart(item.itemName),
    returnKeyPart(item.categoryName),
    item.kind || 'EQUIPMENT',
    item.measureType || 'UNIT',
    returnKeyPart(item.unitLabel)
  ].join('|');
}

// A lista de itens retornáveis vinda da API é a fonte da verdade do romaneio de
// entrada: rascunho e edições locais só podem reaproveitar quantidades digitadas
// e itens extras, nunca esconder um item que saiu para a missão.
export function mergeRomaneioReturnSelection<T extends RomaneioReturnSelection>(
  returnSelection: T[],
  currentSelection: T[]
): T[] {
  const current = currentSelection || [];
  const quantityByKey = new Map<string, number>();
  current.forEach(item => {
    if (item.isExtra) return;
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) return;
    quantityByKey.set(romaneioReturnKey(item), quantity);
  });

  return [
    ...(returnSelection || []).map(item => {
      const previousQuantity = quantityByKey.get(romaneioReturnKey(item));
      if (previousQuantity == null) return item;
      const maxQuantity = Number(item.returnMaxQuantity ?? item.quantity);
      const quantity = Number.isFinite(maxQuantity) ? Math.min(previousQuantity, maxQuantity) : previousQuantity;
      return { ...item, quantity };
    }),
    ...current.filter(item => item.isExtra)
  ];
}
