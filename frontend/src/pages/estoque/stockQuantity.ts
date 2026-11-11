const formatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

export function formatStockQuantity(value: string | number) {
  return formatter.format(Number(value));
}
