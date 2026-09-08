import assert from 'node:assert/strict';
import test from 'node:test';

import { rankAutoAllocationCandidates } from '../src/lib/efetivo/planning/auto-allocation.js';

test('autoalocação usa ordem determinística por admissão, nome e id', () => {
  const ranked = rankAutoAllocationCandidates([{ id: '2', name: 'Bia', admissionDate: '2025-01-01' }, { id: '3', name: 'Ana', admissionDate: '2025-01-01' }, { id: '1', name: 'Zeca', admissionDate: '2024-01-01' }]);
  assert.deepEqual(ranked.map(item => item.id), ['1', '3', '2']);
});
