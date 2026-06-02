import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDataSubjectRequestCreatedEmailTemplate,
  buildDataSubjectRequestResponseEmailTemplate,
  buildInternalUserWelcomeEmailTemplate,
  buildReportRejectedByClientEmailTemplate,
  buildReportSignatureCompletedEmailTemplate,
  buildReportSignatureReceivedEmailTemplate,
  buildSurveyExpiredEmailTemplate
} from '../src/lib/email-templates.js';

test('buildDataSubjectRequestCreatedEmailTemplate identifies protocol and requester', () => {
  const template = buildDataSubjectRequestCreatedEmailTemplate({
    protocol: 'LGPD-20260522-ACS-000001',
    typeLabel: 'Acesso aos dados',
    requesterName: 'Maria Cliente',
    requesterEmail: 'maria@example.com',
    identifier: 'PRJ-001',
    details: 'Solicito acesso aos dados tratados.',
    appUrl: 'https://app.example.com/privacidade/solicitacoes'
  });

  assert.equal(template.subject, '[Filtrovali] Nova solicitação LGPD - LGPD-20260522-ACS-000001');
  assert.match(template.text, /Tipo: Acesso aos dados/);
  assert.match(template.text, /Titular: Maria Cliente/);
  assert.match(template.text, /Acesso: https:\/\/app\.example\.com\/privacidade\/solicitacoes/);
  assert.match(template.html, /<strong>Protocolo:<\/strong> LGPD-20260522-ACS-000001/);
});

test('buildDataSubjectRequestResponseEmailTemplate includes status and response', () => {
  const template = buildDataSubjectRequestResponseEmailTemplate({
    protocol: 'LGPD-20260522-ACS-000001',
    typeLabel: 'Acesso aos dados',
    requesterName: 'Maria Cliente',
    message: 'Encaminhamos em anexo as informações solicitadas.',
    resolved: true
  });

  assert.equal(template.subject, '[Filtrovali] Resposta à solicitação LGPD - LGPD-20260522-ACS-000001');
  assert.match(template.text, /Status: concluída/);
  assert.match(template.text, /Encaminhamos em anexo/);
  assert.match(template.html, /<strong>Status:<\/strong> concluída/);
});

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

test('buildReportRejectedByClientEmailTemplate escapes client-provided HTML', () => {
  const template = buildReportRejectedByClientEmailTemplate({
    projectCode: 'PRJ-<001>',
    projectName: 'Projeto <Teste>',
    clientName: 'Cliente <script>alert(1)</script>',
    reportType: 'RDO',
    reportNumber: '12',
    reportDate: '13/05/2026',
    comment: 'Corrigir<br><img src=x onerror=alert(1)>',
    appUrl: 'https://app.example.com/reports?x=<script>'
  });

  assert.doesNotMatch(template.html, /<script>/);
  assert.doesNotMatch(template.html, /<img src=x/);
  assert.doesNotMatch(template.html, /Corrigir<br>/);
  assert.match(template.html, /Cliente &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(template.html, /Corrigir&lt;br&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(template.html, /https:\/\/app\.example\.com\/reports\?x=&lt;script&gt;/);
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
