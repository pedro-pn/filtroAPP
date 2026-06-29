import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasTechnicalRevisionBaseline,
  shouldIncrementTechnicalRevision,
  technicalPayloadChanged
} from '../src/routes/resources/equipamentos.js';

test('first technical data fill does not increment revision from zero', () => {
  const previous = {
    technicalData: {},
    technicalFieldOverrides: {},
    technicalRevision: 0,
    technicalUpdatedAt: null
  };
  const fields = {
    technicalData: { potencia: '10 cv' },
    technicalFieldOverrides: {},
    bumpRevision: true
  };

  assert.equal(hasTechnicalRevisionBaseline(previous), false);
  assert.equal(technicalPayloadChanged(previous, fields), true);
  assert.equal(shouldIncrementTechnicalRevision(previous, fields), false);
});

test('technical data changes increment after the first saved fill', () => {
  const previous = {
    technicalData: { potencia: '10 cv' },
    technicalFieldOverrides: {},
    technicalRevision: 0,
    technicalUpdatedAt: new Date('2026-06-01T00:00:00.000Z')
  };
  const fields = {
    technicalData: { potencia: '12 cv' },
    technicalFieldOverrides: {},
    bumpRevision: true
  };

  assert.equal(hasTechnicalRevisionBaseline(previous), true);
  assert.equal(technicalPayloadChanged(previous, fields), true);
  assert.equal(shouldIncrementTechnicalRevision(previous, fields), true);
});

test('revision is not incremented when requested without actual technical changes', () => {
  const previous = {
    technicalData: { potencia: '10 cv' },
    technicalFieldOverrides: { observacao: false },
    technicalRevision: 1,
    technicalUpdatedAt: new Date('2026-06-01T00:00:00.000Z')
  };
  const fields = {
    technicalData: { potencia: '10 cv' },
    technicalFieldOverrides: { observacao: false },
    bumpRevision: true
  };

  assert.equal(hasTechnicalRevisionBaseline(previous), true);
  assert.equal(technicalPayloadChanged(previous, fields), false);
  assert.equal(shouldIncrementTechnicalRevision(previous, fields), false);
});
