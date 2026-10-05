import { parseDateKey } from './date-only.js';

// A desmobilização é um fato e pode estar vazia enquanto a missão está em andamento.
// Para cálculos prospectivos, o fim previsto da execução continua delimitando o período.
export function missionEndDate(mission) {
  const forecast = parseDateKey(mission?.returnDate || mission?.executionEndDate, 'a data final da missão');
  if (!mission?.cycles?.some(cycle => cycle.isDefault)) return forecast;
  return (mission?.cycles || []).reduce((end, cycle) => {
    const date = parseDateKey(cycle.demobilizationDate || cycle.mobilizationDate);
    return date > end ? date : end;
  }, forecast);
}

export function missionPeriod(mission) {
  return {
    startDate: parseDateKey(mission?.cycles?.find(cycle => cycle.isDefault)?.mobilizationDate || mission?.mobilizationDate, 'a mobilização'),
    endDate: missionEndDate(mission)
  };
}

export function missionEndsOnOrAfter(value) {
  return {
    OR: [
      { returnDate: { gte: value } },
      { returnDate: null, executionEndDate: { gte: value } },
      { cycles: { some: { demobilizationDate: { gte: value } } } },
      { cycles: { some: { mobilizationDate: { gte: value } } } },
      { allocations: { some: { deletedAt: null, cycles: { some: { OR: [
        { demobilizationDate: { gte: value } },
        { mobilizationDate: { gte: value } }
      ] } } } } }
    ]
  };
}

export function missionStartsOnOrBefore(value) {
  return { AND: [{ OR: [
    { mobilizationDate: { lte: value } },
    { cycles: { some: { mobilizationDate: { lte: value } } } },
    { allocations: { some: { deletedAt: null, cycles: { some: { mobilizationDate: { lte: value } } } } } }
  ] }] };
}
