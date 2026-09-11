import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const api = fs.readFileSync(new URL('../src/api/projectDocuments.ts', import.meta.url), 'utf8');
const form = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectDocumentForm.tsx', import.meta.url), 'utf8');
const category = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectDocumentsCategory.tsx', import.meta.url), 'utf8');
const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowModal.tsx', import.meta.url), 'utf8');
const intake = fs.readFileSync(new URL('../src/pages/efetivo/components/ProjectWorkflowIntakePanels.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');

test('catálogo mantém URL do projeto, estados e histórico de versões no diálogo atual', () => {
  assert.match(modal, /ProjectDocumentsCategory projectId=\{workflow\.projectId\}/);
  assert.match(category, /Carregando documentos do projeto/);
  assert.match(category, /Não foi possível carregar os documentos/);
  assert.match(category, /Nenhum documento cadastrado/);
  assert.match(category, /Histórico de versões/);
  assert.match(category, /Projeto encerrado: documentos disponíveis somente para consulta/);
  assert.doesNotMatch(category, /useSearchParams|setSearchParams/);
  assert.match(api, /projectDocumentsQueryKey/);
  assert.match(api, /includeHistory: true/);
});

test('formulários mostram erros, exigência, aceite e formatos permitidos', () => {
  assert.match(form, /zodResolver/);
  assert.match(form, /react-hook-form/);
  assert.match(form, /field-invalid/);
  assert.match(form, /aria-invalid/);
  assert.match(form, /field-error/);
  assert.match(form, /Exigência no fluxo/);
  assert.match(form, /Aceite necessário/);
  assert.match(form, /Registrar decisão/);
  assert.match(form, /\.pdf,\.docx,\.xlsx,\.png,\.jpg,\.jpeg,\.dwg,\.dxf/);
});

test('documentos CRM, assinatura e projeções operacionais preservam suas origens', () => {
  assert.match(category, /Conteúdo sincronizado pelo CRM e mantido como somente leitura/);
  assert.match(category, /Abrir na origem/);
  assert.match(category, /Preparar assinatura/);
  assert.match(category, /PDF assinado/);
  assert.match(category, /RDOs e relatórios técnicos/);
  assert.match(category, /sem criar cópias no catálogo/);
  assert.match(category, /Conteúdo indisponível/);
});

test('documentos explícitos explicam bloqueios e invalidam a autorização na interface', () => {
  assert.match(category, /Documentos que bloqueiam o fluxo/);
  assert.match(category, /A autorização de mobilização precisa ser revalidada/);
  assert.match(intake, /COMMERCIAL_PROPOSAL/);
  assert.match(intake, /TECHNICAL_PROPOSAL/);
  assert.match(intake, /Abrir anexo/);
  assert.match(styles, /project-document-requirement-blockers/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /project-document-form-body/);
});
