import assert from 'node:assert/strict';
import test from 'node:test';

import { buildInternalUserWelcomeEmailTemplate } from '../src/lib/email-templates.js';

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
