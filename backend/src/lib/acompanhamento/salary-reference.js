const dateKey = set => new Date(set.effectiveDate).toISOString().slice(0, 10);

// Each Conecta occurrence has immutable local revisions. A correction can also
// move its effective date, so collapse revisions before applying the date filter.
export function currentSalaryParameterSets(sets = []) {
  const occurrences = new Map();
  for (const set of sets) {
    const reference = set.params?.salaryReference;
    if (!reference?.id) continue;
    const previous = occurrences.get(reference.id);
    if (!previous || reference.revision > previous.params.salaryReference.revision
      || reference.revision === previous.params.salaryReference.revision && set.version > previous.version) occurrences.set(reference.id, set);
  }
  const superseded = new Set([...occurrences.values()]
    .map(set => set.params.salaryReference.supersedesId).filter(Boolean));
  return sets.filter(set => {
    const id = set.params?.salaryReference?.id;
    return !id || set.params.salaryReference.revision === occurrences.get(id).params.salaryReference.revision && !superseded.has(id);
  });
}

export function salaryReferenceAt(sets = [], referenceDate) {
  const applicable = currentSalaryParameterSets(sets).filter(set => dateKey(set) <= referenceDate)
    .sort((a, b) => dateKey(b).localeCompare(dateKey(a)) || b.version - a.version);
  const set = applicable[0];
  const metadata = set?.params?.salaryReference;
  return {
    set,
    salaryStatus: metadata?.status === 'CANCELLED' ? 'CANCELLED' : set ? 'CURRENT' : 'UNAVAILABLE',
    salaryOrigin: metadata ? 'CONECTA' : set ? 'LOCAL' : null,
    salaryReferenceId: metadata?.id ?? null,
    salarySourceRevision: metadata?.revision ?? null,
    // This is a publication revision, independent of the selected effective date.
    referenceRevision: Math.max(0, ...sets.map(item => item.version || 0))
  };
}
