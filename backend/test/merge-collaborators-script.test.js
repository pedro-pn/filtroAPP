import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mergedCollaboratorFields } from '../scripts/merge-collaborators.js';

const keep = {
  id: 'old', isActive: true, jobRoleId: 'role-old', email: null, cpf: null, registrationNumber: null,
  admissionDate: null, admissionDateProvisional: false, rhStatus: null, rhEmploymentId: null,
  workforceClassificationOverride: 'OPERATIONAL', efetivoNote: 'nota antiga'
};
const remove = {
  id: 'new', isActive: true, jobRoleId: 'role-new', email: 'pessoa@exemplo.invalid', cpf: '000.000.000-00', registrationNumber: 'MATR-TESTE',
  admissionDate: new Date('2020-01-01'), admissionDateProvisional: false, rhStatus: 'ACTIVE', rhEmploymentId: 'emp-1',
  workforceClassificationOverride: 'NON_OPERATIONAL', efetivoNote: 'nota nova', sourceIsOperational: false
};

test('dados de RH do cadastro removido preenchem só as lacunas do mantido', () => {
  const data = mergedCollaboratorFields(keep, remove, 'role-new');
  assert.equal(data.cpf, '000.000.000-00');
  assert.equal(data.registrationNumber, 'MATR-TESTE');
  assert.equal(data.rhEmploymentId, 'emp-1');
  assert.equal(data.admissionDateProvisional, false);
  assert.equal(data.efetivoNote, undefined, 'valor existente no cadastro mantido não é sobrescrito');
  assert.equal(data.workforceClassificationOverride, undefined, 'classificação do mantido prevalece');
  assert.equal(data.jobRoleId, 'role-new', 'cargo segue o histórico mais recente');
});

test('sem classificação no mantido, herda a do removido; cargo igual não é regravado', () => {
  const data = mergedCollaboratorFields({ ...keep, workforceClassificationOverride: null }, remove, keep.jobRoleId);
  assert.equal(data.workforceClassificationOverride, 'NON_OPERATIONAL');
  assert.equal('jobRoleId' in data, false);
});

test('cadastro mantido inativo é reativado quando o removido está ativo', () => {
  assert.equal(mergedCollaboratorFields({ ...keep, isActive: false }, remove, null).isActive, true);
});
