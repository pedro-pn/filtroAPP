import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = path => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('gestor reúne PDF e serviços no mesmo acesso, incluindo projetos arquivados', async () => {
  const gestor = await source('pages/gestor/GestorPage.tsx');
  assert.doesNotMatch(gestor, /Upload PDF antigo|onHistoricalServices|historicalServicesProjectId|<HistoricalServicesModal/);
  assert.match(gestor, /Upload de relatórios antigos/);
  assert.equal(gestor.match(/onUploadOldReports: project => openManualReportUpload\(project.id\)/g)?.length, 2);
  assert.match(gestor, /<LegacyReportsUploadModal[\s\S]*?<form[^>]+onSubmit=\{handleManualReportSubmit\}/);
  assert.match(gestor, /if \(!manualReportModalOpen\) return null/);
});

test('abas preservam painéis e oferecem navegação acessível por teclado', async () => {
  const modal = await source('pages/gestor/LegacyReportsUploadModal.tsx');
  assert.match(modal, /label: 'PDFs antigos'/);
  assert.match(modal, /label: 'Serviços históricos'/);
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) assert.ok(modal.includes(`'${key}'`));
  assert.match(modal, /role="tablist"/);
  assert.match(modal, /aria-selected=\{activeTab === tab.id\}/);
  assert.match(modal, /hidden=\{activeTab !== 'services'\} inert=\{activeTab !== 'services'\}/);
  assert.match(modal, /hidden=\{!replacing && activeTab !== 'pdf'\}/);
  assert.match(modal, /<HistoricalServicesContent key=\{projectId\}/);
});

test('edição de PDF existente não mostra as abas de nova importação', async () => {
  const modal = await source('pages/gestor/LegacyReportsUploadModal.tsx');
  assert.match(modal, /replacing \? 'Editar relatório manual' : 'Upload de relatórios antigos'/);
  assert.match(modal, /!replacing && <div className="legacy-upload-tabs"/);
  assert.match(modal, /!replacing && <div id="legacy-upload-panel-services"/);
});

test('operações em andamento bloqueiam troca de aba e fechamento', async () => {
  const modal = await source('pages/gestor/LegacyReportsUploadModal.tsx');
  const history = await source('pages/gestor/HistoricalServicesModal.tsx');
  assert.match(modal, /const busy = submitting \|\| historicalBusy/);
  assert.match(modal, /closeOnEscape=\{!busy\}/);
  assert.match(modal, /tabIndex=\{activeTab === tab.id \? 0 : -1\} disabled=\{busy\}/);
  assert.match(history, /setBusy\(true\); onBusyChange\(true\)/);
  assert.match(history, /finally \{ setBusy\(false\); onBusyChange\(false\); \}/);
});

test('serviços embutidos não criam outro modal nem subordinam CSV ao envio de PDF', async () => {
  const modal = await source('pages/gestor/LegacyReportsUploadModal.tsx');
  const history = await source('pages/gestor/HistoricalServicesModal.tsx');
  const content = history.slice(history.indexOf('export function HistoricalServicesContent'));
  assert.match(modal, /<HistoricalServicesContent/);
  assert.doesNotMatch(modal, /<HistoricalServicesModal/);
  assert.doesNotMatch(content, /<Modal|pdfDataUrl/);
  assert.match(content, /onProjectChange\(event.target.value\); resetInput\(\)/);
});

test('foco do modal ignora campos das abas ocultas e campos desabilitados', async () => {
  const modal = await source('components/ui/Modal.tsx');
  assert.match(modal, /!element.matches\(':disabled'\)/);
  assert.match(modal, /!element.closest\('\[hidden\], \[inert\]'\)/);
  assert.match(modal, /element.getClientRects\(\).length > 0/);
  assert.match(modal, /visibleFocusableElements\(panelRef\.current\)/);
});
