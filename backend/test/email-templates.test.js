import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildInternalUserWelcomeEmailTemplate,
  buildReportSignatureCompletedEmailTemplate,
  buildReportSignatureReceivedEmailTemplate
} from '../src/lib/email-templates.js';

test('buildInternalUserWelcomeEmailTemplate includes account credentials', () => {
  const template = buildInternalUserWelcomeEmailTemplate({
    userName: 'Maria Silva',
    username: 'maria.silva',
    password: 'senha123',
    roleLabel: 'coordenador',
    appUrl: 'https://app.example.com'
  });

  assert.equal(template.subject, '[Filtrovali] Seu acesso foi criado');
  assert.match(template.text, /A conta de coordenador Maria Silva foi criada/);
  assert.match(template.text, /Perfil: coordenador/);
  assert.match(template.text, /Usuário: maria\.silva/);
  assert.match(template.text, /Senha inicial: senha123/);
  assert.match(template.text, /Acesso: https:\/\/app\.example\.com/);
  assert.match(template.html, /<strong>Usuário:<\/strong> maria\.silva/);
  assert.match(template.html, /<strong>Senha inicial:<\/strong> senha123/);
});

test('buildReportSignatureReceivedEmailTemplate includes signer and progress', () => {
  const template = buildReportSignatureReceivedEmailTemplate({
    projectCode: 'P-001',
    projectName: 'Projeto Teste',
    reportType: 'RDO',
    reportNumber: '12',
    reportDate: '12/05/2026',
    signerName: 'Cliente A',
    signerEmail: 'cliente@example.com',
    signedCount: 1,
    requiredCount: 2,
    appUrl: 'https://app.example.com'
  });

  assert.equal(template.subject, '[Filtrovali] RDO 12 recebeu uma assinatura');
  assert.match(template.text, /Signatário: Cliente A \(cliente@example\.com\)/);
  assert.match(template.text, /Progresso: 1\/2 assinaturas obrigatórias/);
  assert.match(template.html, /<strong>Progresso:<\/strong> 1\/2 assinaturas obrigatórias/);
});

test('buildReportSignatureCompletedEmailTemplate includes final document hash', () => {
  const template = buildReportSignatureCompletedEmailTemplate({
    projectCode: 'P-001',
    projectName: 'Projeto Teste',
    reportType: 'RDO',
    reportNumber: '12',
    reportDate: '12/05/2026',
    signerName: 'Cliente A',
    signerEmail: 'cliente@example.com',
    finalDocumentHash: 'abc123',
    appUrl: 'https://app.example.com'
  });

  assert.equal(template.subject, '[Filtrovali] RDO 12 assinado');
  assert.match(template.text, /Todas as assinaturas obrigatórias/);
  assert.match(template.text, /Último signatário: Cliente A \(cliente@example\.com\)/);
  assert.match(template.text, /Hash PDF final: abc123/);
  assert.match(template.html, /<strong>Hash PDF final:<\/strong>/);
});
