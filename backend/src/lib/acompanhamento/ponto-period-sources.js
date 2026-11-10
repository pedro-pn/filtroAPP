// The import scope already read the creation dates used by mergePontoPeriods.
// Attach them without repeating an Import relation query for every period.
export function withPontoImportDates(periodRows, imports) {
  const byId = new Map(imports.map(item => [item.id, item.createdAt]));
  return periodRows.map(row => ({
    ...row, import: { createdAt: byId.get(row.importId) ?? row.import?.createdAt }
  }));
}
