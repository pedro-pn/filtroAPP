import assert from 'node:assert/strict';
import test from 'node:test';

import { nthBusinessDayOfMonth, weekStartsTouchingMonth } from '../src/lib/calendar/business-day-deadline.js';

test('3º dia útil conta o dia 1º quando é útil', () => {
  // 2027-01-01 é sexta-feira: sexta (1), segunda (2), terça (3) → dia 5.
  assert.equal(nthBusinessDayOfMonth('2027-01', 3), '2027-01-05');
});

test('3º dia útil pula fim de semana inicial', () => {
  // 2026-08-01 é sábado: segunda 3, terça 4, quarta 5.
  assert.equal(nthBusinessDayOfMonth('2026-08', 3), '2026-08-05');
});

test('feriado corporativo não conta como dia útil', () => {
  assert.equal(nthBusinessDayOfMonth('2027-01', 3, new Set(['2027-01-04'])), '2027-01-06');
  assert.equal(nthBusinessDayOfMonth('2027-01', 3, new Set(['2027-01-01'])), '2027-01-06');
});

test('mês inválido é recusado', () => {
  assert.throws(() => nthBusinessDayOfMonth('2026-13', 3));
  assert.throws(() => nthBusinessDayOfMonth('2026-11', 0));
});

test('semanas que tocam o mês incluem a semana que atravessa a virada', () => {
  const weeks = weekStartsTouchingMonth('2026-10');
  assert.equal(weeks[0], '2026-09-28');
  assert.equal(weeks.at(-1), '2026-10-26');
  assert.equal(weeks.length, 5);
  assert.deepEqual(weekStartsTouchingMonth('2026-11').slice(0, 2), ['2026-10-26', '2026-11-02']);
});
