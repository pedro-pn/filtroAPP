export type EstoqueSchema = {
  safeParse: (value: unknown) => any;
};

export type EstoqueSchemas = {
  ITEM_TYPES: readonly string[];
  MOVEMENT_TYPES: readonly string[];
  CHEMICAL_UNITS: readonly string[];
  itemCreate: EstoqueSchema;
  itemUpdateForType: (type: string) => EstoqueSchema;
  movement: (options?: { itemType?: string }) => EstoqueSchema;
  movements: EstoqueSchema;
  returnMovements: EstoqueSchema;
  activePatch: EstoqueSchema;
  reverseMovement: EstoqueSchema;
};

export function makeEstoqueSchemas(zod: unknown): EstoqueSchemas;
