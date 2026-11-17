import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'databook-certificates-'));
process.env.REPORTS_DIR = uploadDir;
const { materializar, sugerirCertificados } = await import('../src/lib/databook/anexos.js');
const { resolveReportCounter, resolveReportManometers } = await import('../src/lib/report-equipment-resolve.js');

const certificate = (id, extra = {}) => ({
  id, kind: 'CALIBRATION_CERTIFICATE', fileName: `${id}.pdf`, mimeType: 'application/pdf',
  publicToken: `token-${id}`, createdAt: new Date('2026-10-01'), storagePath: `${id}.pdf`, ...extra
});
const equipment = (extra = {}) => ({
  id: 'equipment-1', code: 'MAN-174', attributes: { scale: '0–20 bar', calibrationCertCode: 'CAL-174', serialNumber: 'SN-174' },
  calibratedAt: new Date('2026-09-15'), expiresAt: new Date('2027-09-15'), attachments: [certificate('current')], ...extra
});

function clientFor(attachments, legacy = [], item = equipment()) {
  return {
    companyEquipment: { findMany: async () => [item], findUnique: async () => item },
    equipmentAttachment: {
      findMany: async ({ where }) => attachments.filter(a => where.id.in.includes(a.id) && a.kind === where.kind),
      findUnique: async ({ where }) => attachments.find(a => a.id === where.id) || null
    },
    calibrationCertificate: {
      findMany: async ({ where }) => legacy.filter(c => where.id.in.includes(c.id)),
      findUnique: async ({ where }) => legacy.find(c => c.id === where.id) || null
    }
  };
}

for (const tipo of ['RTP', 'RCPU']) {
  test(`${tipo}: certificado do cadastro de Equipamentos usado no relatório entra uma vez no Anexo C`, async () => {
    const item = equipment({ code: tipo === 'RTP' ? 'MAN-174' : 'CP-174' });
    const client = clientFor([certificate('current', { equipment: item })], [], item);
    const resolved = tipo === 'RTP'
      ? (await resolveReportManometers(client, [item.id]))[0]
      : await resolveReportCounter(client, item.id);
    const snapshot = { ...resolved, certCode: resolved.calibrationCertCode, certificate: resolved.currentCalibrationCertificate };
    const report = { reportType: tipo, specialConditions: tipo === 'RTP' ? { resolvedManometers: [snapshot] } : { resolvedCounter: snapshot } };
    const result = await sugerirCertificados(client, [report, structuredClone(report)]);
    assert.deepEqual(result.avisos, []);
    assert.equal(result.itens.length, 1);
    assert.equal(result.itens[0].arquivo, 'equipmentcert:current');
    assert.equal(result.itens[0].codigo, item.code);
    assert.equal(result.itens[0].aplicacao, tipo);
    assert.equal(result.itens[0].calibracao, '15/09/2026');
    assert.equal(result.itens[0].validade, '15/09/2027');
  });
}

test('Anexo C preserva o certificado histórico do relatório após nova calibração do mesmo equipamento', async () => {
  const item = equipment({ code: 'CP-174' });
  const client = clientFor([certificate('previous', { equipment: item }), certificate('current', { equipment: item })]);
  const report = id => ({ reportType: 'RCPU', specialConditions: { resolvedCounter: {
    code: item.code, certificate: { id, fileName: `${id}.pdf` }
  } } });
  const { itens, avisos } = await sugerirCertificados(client, [report('previous'), report('current')]);
  assert.deepEqual(avisos, []);
  assert.deepEqual(itens.map(c => c.arquivo), ['equipmentcert:previous', 'equipmentcert:current']);
  assert.equal(itens[0].validade, undefined, 'a validade atual não pertence ao certificado anterior');
  assert.equal(itens[1].validade, '15/09/2027');
});

test('certificados legados e atuais coexistem; anexos ausentes ou de outro tipo geram aviso', async () => {
  const item = equipment();
  const client = clientFor([certificate('current', { equipment: item }), certificate('manual', { kind: 'TECHNICAL_DOC' })], [certificate('legacy')]);
  const reports = ['legacy', 'current', 'missing', 'manual'].map(id => ({
    reportType: 'RTP', specialConditions: { resolvedManometers: [{
      code: item.code, certificate: { id }, calibratedAt: '2025-03-01', expiresAt: '2026-03-01'
    }] }
  }));
  const { itens, avisos } = await sugerirCertificados(client, reports);
  assert.deepEqual(itens.map(c => c.arquivo), ['cert:legacy', 'equipmentcert:current']);
  assert.ok(itens.every(c => c.calibracao === '01/03/2025' && c.validade === '01/03/2026'));
  assert.equal(avisos.length, 2);
  assert.ok(avisos.every(a => a.includes('não está disponível para anexar')));
});

test('prévia e geração materializam os PDFs atuais e legados sem mudar a entrada salva', async () => {
  const client = clientFor([certificate('current')], [certificate('legacy')]);
  for (const id of ['current', 'legacy']) await fs.writeFile(path.join(uploadDir, `${id}.pdf`), `%PDF-1.4 ${id}`);
  const dados = { dias: [], certificados: [
    { equipamento: 'Manômetro', codigo: 'MAN-174', arquivo: 'equipmentcert:current' },
    { equipamento: 'Manômetro', codigo: 'MAN-012', arquivo: 'cert:legacy' }
  ] };
  for (const modo of ['verificar', 'gerar']) {
    const result = await materializar(client, dados, { pasta: uploadDir, modo });
    assert.deepEqual(result.certificados.map(c => c.arquivo), [path.join(uploadDir, 'current.pdf'), path.join(uploadDir, 'legacy.pdf')]);
    assert.equal(await fs.readFile(result.certificados[0].arquivo, 'utf8'), '%PDF-1.4 current');
  }
  assert.equal(dados.certificados[0].arquivo, 'equipmentcert:current');
});

test('materialização rejeita certificado ausente, anexo de outro tipo e caminho fora do armazenamento', async () => {
  const client = clientFor([
    certificate('no-file'), certificate('manual', { kind: 'TECHNICAL_DOC', storagePath: 'current.pdf' }),
    certificate('outside', { storagePath: '../outside.pdf' })
  ]);
  for (const id of ['missing', 'no-file', 'manual', 'outside']) {
    await assert.rejects(materializar(client, { dias: [], certificados: [
      { equipamento: 'Manômetro', codigo: 'MAN-174', arquivo: `equipmentcert:${id}` }
    ] }, { modo: 'verificar' }), error => error.status === 422 && /Certificado de calibração.*não encontrado/.test(error.message));
  }
});

test.after(() => fs.rm(uploadDir, { recursive: true, force: true }));
