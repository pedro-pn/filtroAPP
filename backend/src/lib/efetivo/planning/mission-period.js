import { parseDateKey } from './date-only.js';

// A desmobilização é um fato e pode estar vazia enquanto a missão está em andamento.
// Para cálculos prospectivos, o fim previsto da execução continua delimitando o período.
export function missionEndDate(mission) {
  return parseDateKey(mission?.returnDate || mission?.executionEndDate, 'a data final da missão');
}

export function missionPeriod(mission) {
  return {
    startDate: parseDateKey(mission?.mobilizationDate, 'a mobilização'),
    endDate: missionEndDate(mission)
  };
}

export function missionEndsOnOrAfter(value) {
  return {
    OR: [
      { returnDate: { gte: value } },
      { returnDate: null, executionEndDate: { gte: value } }
    ]
  };
}
