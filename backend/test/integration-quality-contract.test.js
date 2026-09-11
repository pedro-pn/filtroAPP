import assert from 'node:assert/strict';
import test from 'node:test';

import { publicQualityNature, publicQualityRecord } from '../src/lib/qualidade/public-serializer.js';

const row = {
  id: 'record_1', number: 'D-2026-001', type: 'DESVIO', seq: 1, year: 2026,
  registeredAt: new Date('2026-09-01Z'), origin: 'Auditoria', projectId: 'project_1', eventDate: new Date('2026-09-02Z'),
  natureId: 'nature_1', description: 'Descrição', impact: 'MEDIO', linkedRnc: null, disposition: 'TRATAR',
  definedAction: 'Corrigir', actionOwner: 'Qualidade', actionDeadline: new Date('2026-09-30Z'), evidence: 'https://legacy.invalid',
  resultVerification: null, status: 'EM_ACAO', createdById: 'user_secret', updatedById: 'user_secret', deletedById: null,
  deletedAt: null, createdAt: new Date('2026-09-01Z'), updatedAt: new Date('2026-09-03Z'),
  project: { id: 'project_1', code: 'P-1', name: 'Projeto 1', clientCnpj: 'secret' },
  nature: { id: 'nature_1', name: 'Processo', isActive: true },
  evidences: [{ id: 'ev_1', kind: 'ATTACHMENT', label: 'Foto', fileName: 'foto.jpg', mimeType: 'image/jpeg', position: 0, createdAt: new Date('2026-09-02Z'), storagePath: 'secret/path', publicToken: 'public-secret', url: null }]
};

test('quality record serializer is an explicit public allowlist', () => {
  const result = publicQualityRecord(row, { scopes: new Set(['qualidade.registros.read']), recurrence: { occurrences12m: 2, recurrent: false } });
  assert.deepEqual(Object.keys(result).sort(), [
    'actionDeadline', 'actionOwner', 'createdAt', 'definedAction', 'description', 'disposition', 'eventDate', 'evidenceSummary',
    'id', 'impact', 'linkedRnc', 'nature', 'number', 'origin', 'project', 'recurrence', 'registeredAt', 'resultVerification',
    'status', 'type', 'updatedAt'
  ].sort());
  assert.equal(result.project.clientCnpj, undefined);
  assert.doesNotMatch(JSON.stringify(result), /seq|year|createdBy|updatedBy|storagePath|publicToken|user_secret/);
});

test('evidence metadata and tombstone are included only by their scopes and still omit physical/public paths', () => {
  const result = publicQualityRecord(row, { scopes: new Set(['qualidade.registros.read', 'qualidade.evidencias.metadata.read', 'qualidade.excluidos.read']) });
  assert.equal(result.evidences[0].downloadAvailable, true);
  assert.equal(result.deletedAt, null);
  assert.doesNotMatch(JSON.stringify(result), /storagePath|publicToken|https:\/\/legacy/);
});

test('quality nature serializer contains exactly the contracted fields', () => {
  const result = publicQualityNature({ id: 'n1', name: 'Processo', isActive: true, position: 2, createdAt: new Date('2026-09-01Z'), updatedAt: new Date('2026-09-02Z'), records: ['secret'] });
  assert.deepEqual(Object.keys(result), ['id', 'name', 'isActive', 'position', 'createdAt', 'updatedAt']);
});
