import assert from 'node:assert/strict';
import test from 'node:test';

import { makeQualidadeSchemas } from '../schemas/qualidade.js';

const dates = { registeredAt: '2026-10-15', eventDate: '2026-10-14' };
const optionalValues = {
  origin: 'Reunião semanal',
  projectId: 'project-1',
  natureId: 'nature-1',
  subnatureId: 'subnature-1',
  description: 'Melhoria no processo',
  impact: 'BAIXO',
  linkedRnc: 'D-001/26',
  disposition: 'MONITORAR',
  definedAction: 'Revisar procedimento',
  actionOwner: 'Equipe de qualidade',
  actionDeadline: '2026-10-20',
  evidence: 'https://example.com/evidencia',
  resultVerification: 'Resultado conferido',
  status: 'ABERTO'
};
const emptyValues = Object.fromEntries(Object.keys(optionalValues).map(key => [key, null]));

export function registerQualidadeContractTests(z) {
  const schemas = makeQualidadeSchemas(z);
  const operations = [
    ['creation', schemas.recordCreate, { type: 'MELHORIA', ...dates }],
    ['update', schemas.recordUpdateForType('MELHORIA'), dates]
  ];

  for (const [operation, schema, required] of operations) {
    test(`quality ${operation} keeps omitted, undefined, null and blank optional fields as explicit nulls`, () => {
      for (const value of [undefined, null, '', '   ']) {
        const input = Object.fromEntries(Object.keys(optionalValues).map(key => [key, value]));
        assert.deepEqual(schema.parse({ ...required, ...input }), { ...required, ...emptyValues, evidences: [] });
      }
      assert.deepEqual(schema.parse(required), { ...required, ...emptyValues, evidences: [] });
    });

    test(`quality ${operation} trims and preserves populated optional fields`, () => {
      const padded = Object.fromEntries(Object.entries(optionalValues).map(([key, value]) => [key, `  ${value}  `]));
      assert.deepEqual(schema.parse({ ...required, ...padded }), { ...required, ...optionalValues, evidences: [] });
    });

    test(`quality ${operation} still rejects invalid optional values`, () => {
      const invalidValues = {
        origin: 'x'.repeat(181),
        projectId: 'x'.repeat(81),
        natureId: 'x'.repeat(81),
        subnatureId: 'x'.repeat(81),
        description: 'x'.repeat(4001),
        impact: 'INVALIDO',
        disposition: 'INVALIDO',
        status: 'INVALIDO',
        actionDeadline: '20/10/2026',
        evidence: 'javascript:alert(1)'
      };
      for (const [key, value] of Object.entries(invalidValues)) {
        const result = schema.safeParse({ ...required, [key]: value });
        assert.equal(result.success, false, key);
        assert.ok(result.error.issues.some(issue => issue.path[0] === key), key);
      }
    });

    test(`quality ${operation} normalizes optional evidence metadata and preserves evidence validation`, () => {
      const result = schema.parse({
        ...required,
        evidences: [
          { kind: 'LINK', url: ' https://example.com/evidencia ' },
          { kind: 'ATTACHMENT', id: ' existing-attachment ' }
        ]
      });
      const emptyEvidence = { id: null, label: null, url: null, fileName: null, mimeType: null, dataUrl: null };
      assert.deepEqual(result.evidences, [
        { ...emptyEvidence, kind: 'LINK', url: 'https://example.com/evidencia' },
        { ...emptyEvidence, kind: 'ATTACHMENT', id: 'existing-attachment' }
      ]);
      for (const evidence of [{ kind: 'LINK' }, { kind: 'ATTACHMENT' }, { kind: 'ATTACHMENT', id: 'existing-attachment', url: 'https://example.com/evidencia' }]) {
        assert.equal(schema.safeParse({ ...required, evidences: [evidence] }).success, false);
      }
    });
  }

  test('quality deviation creation and update still require their business fields', () => {
    for (const [schema, required] of [[schemas.recordCreate, { type: 'DESVIO', ...dates }], [schemas.recordUpdateForType('DESVIO'), dates]]) {
      for (const key of ['natureId', 'description', 'impact', 'disposition', 'status']) {
        for (const value of [undefined, null, '', '   ']) {
          const input = { ...required, ...optionalValues, [key]: value };
          if (value === undefined) delete input[key];
          const result = schema.safeParse(input);
          assert.equal(result.success, false, key);
          assert.ok(result.error.issues.some(issue => issue.path[0] === key), key);
        }
      }
      assert.equal(schema.safeParse({ ...required, ...optionalValues, disposition: 'TRATAR', definedAction: '' }).success, false);
      assert.equal(schema.safeParse({ ...required, ...optionalValues, origin: null }).success, true);
    }
  });
}
