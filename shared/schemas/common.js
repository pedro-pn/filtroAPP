export function makeCommonSchemas(z) {
  if (!z?.string || !z?.array) {
    throw new TypeError('A valid Zod instance is required to build shared schemas.');
  }

  function nonEmptyTrimmedString({ min = 1, max, message } = {}) {
    let schema = z.string().trim().min(min, message);
    if (Number.isInteger(max)) schema = schema.max(max);
    return schema;
  }

  function optionalTrimmedString({ max, emptyAs = null } = {}) {
    let schema = z.string().trim();
    if (Number.isInteger(max)) schema = schema.max(max);
    return schema.optional().nullable().transform(value => {
      const text = String(value || '').trim();
      return text || emptyAs;
    });
  }

  function stringIdList({ min = 1, max = 100 } = {}) {
    return z.array(z.string().trim().min(1)).min(min).max(max);
  }

  return {
    nonEmptyTrimmedString,
    optionalTrimmedString,
    stringIdList
  };
}
