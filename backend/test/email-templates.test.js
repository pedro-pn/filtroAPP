import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildInternalUserWelcomeEmailTemplate,
  buildReportRejectedByClientEmailTemplate,
  buildSurveyExpiredEmailTemplate
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

test('buildReportRejectedByClientEmailTemplate identifies the rejecting client', () => {
  const template = buildReportRejectedByClientEmailTemplate({
    projectCode: 'PRJ-001',
    projectName: 'Projeto Teste',
    clientName: 'Maria Cliente (maria@example.com)',
    reportType: 'RDO',
    reportNumber: '12',
    reportDate: '13/05/2026',
    comment: 'Corrigir medição informada.',
    appUrl: 'https://app.example.com'
  });

  assert.match(template.text, /Cliente que reprovou: Maria Cliente \(maria@example\.com\)/);
  assert.match(template.text, /Justificativa: Corrigir medição informada\./);
  assert.match(template.html, /<strong>Cliente que reprovou:<\/strong> Maria Cliente \(maria@example\.com\)/);
});

test('buildSurveyExpiredEmailTemplate identifies expired survey details', () => {
  const template = buildSurveyExpiredEmailTemplate({
    clientName: 'Cliente A',
    projectCode: 'PRJ-002',
    projectName: 'Projeto NPS',
    emailTo: 'cliente@example.com',
    sentAt: '13/04/2026',
    expiresAt: '13/05/2026',
    appUrl: 'https://app.example.com'
  });

  assert.equal(template.subject, '[Filtrovali] Pesquisa expirada - PRJ-002');
  assert.match(template.text, /expirou sem resposta do cliente/);
  assert.match(template.text, /E-mail enviado: cliente@example\.com/);
  assert.match(template.html, /<strong>Expirada em:<\/strong> 13\/05\/2026/);
});
