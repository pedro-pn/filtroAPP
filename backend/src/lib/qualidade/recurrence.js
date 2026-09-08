function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function subtractMonths(date, months) {
  const copy = new Date(date.getTime());
  copy.setUTCMonth(copy.getUTCMonth() - months);
  return copy;
}

export function calculateQualityRecurrence(records) {
  const byNature = new Map();
  for (const record of records || []) {
    const eventDate = normalizeDate(record.eventDate);
    if (!record?.id || !record.natureId || !eventDate) continue;
    const list = byNature.get(record.natureId) || [];
    list.push({ id: record.id, eventDate });
    byNature.set(record.natureId, list);
  }

  const result = new Map();
  for (const recordsForNature of byNature.values()) {
    for (const record of recordsForNature) {
      const from = subtractMonths(record.eventDate, 12);
      const count = recordsForNature.filter(candidate => (
        candidate.eventDate >= from && candidate.eventDate <= record.eventDate
      )).length;
      result.set(record.id, {
        occurrences12m: count,
        recurrent: count >= 3
      });
    }
  }

  return result;
}
