import { Prisma } from '@prisma/client';

// OmiePurchase.valor has scale 2. Sum status subtotals in integer cents so
// regrouping cannot introduce floating-point or Decimal arithmetic rounding.
// Keep SQL's all-null SUM and return the same Decimal type as Prisma groupBy.
export function purchaseStatusTotals(rows) {
  const totals = new Map(), paid = new Map();
  for (const row of rows) {
    const current = totals.get(row.projectId) ?? { cents: 0n, hasValue: false, nonFinite: null };
    if (row._sum.valor !== null) {
      const value = new Prisma.Decimal(row._sum.valor);
      current.hasValue = true;
      if (!value.isFinite()) current.nonFinite = value;
      else current.cents += BigInt(value.toFixed(2).replace('.', ''));
    }
    totals.set(row.projectId, current);
    if (row.statusTitulo === 'PAGO') paid.set(row.projectId, row._sum.valor);
  }
  return {
    totalByProject: new Map([...totals].map(([id, value]) => {
      if (!value.hasValue) return [id, null];
      if (value.nonFinite) return [id, value.nonFinite];
      const absolute = value.cents < 0n ? -value.cents : value.cents;
      return [id, new Prisma.Decimal(`${value.cents < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`)];
    })),
    paidByProject: paid
  };
}
