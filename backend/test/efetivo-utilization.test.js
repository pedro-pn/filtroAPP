import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateUtilization90Days } from '../src/lib/efetivo/planning/capacity.js';

const role = { id: 'r1', name: 'Operador', isActive: true, isOperational: true };
const collaborator = { id: 'c1', name: 'Ana', role: 'Operador', jobRoleId: 'r1', admissionDate: '2026-01-01', isActive: true };

test('janela móvel possui exatamente 90 datas inclusivas e deduplica pessoa-dia', () => {
  const result = calculateUtilization90Days({ date: '2026-01-01', jobRoles: [role], collaborators: [collaborator], missions: [
    { id: 'm1', scheduleStatus: 'CONFIRMED', mobilizationDate: '2026-01-05', returnDate: '2026-01-09', allocations: [{ collaboratorId: 'c1' }] },
    { id: 'm2', scheduleStatus: 'CONFIRMED', mobilizationDate: '2026-01-05', returnDate: '2026-01-09', allocations: [{ collaboratorId: 'c1' }] }
  ] });
  assert.equal(result.startDate, '2026-01-01');
  assert.equal(result.endDate, '2026-03-31');
  assert.equal(result.committedPersonDays, 5);
  assert.ok(result.rate > 0 && result.rate <= 100);
});

test('denominador zero retorna indisponível, não zero enganoso', () => {
  const result = calculateUtilization90Days({ date: '2026-01-01', jobRoles: [role], collaborators: [{ ...collaborator, admissionDate: '2027-01-01' }] });
  assert.equal(result.availablePersonDays, 0);
  assert.equal(result.rate, null);
});
