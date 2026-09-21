import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { withRdoCompanions } from './rdo-source.mjs';

const source = (path) =>
  withRdoCompanions(path, candidate => readFileSync(new URL(`../${candidate}`, import.meta.url), 'utf8'));

function sectionBetween(contents, start, end) {
  const startIndex = contents.indexOf(start);
  const endIndex = contents.indexOf(end, startIndex);

  assert.notEqual(startIndex, -1, `Seção inicial ausente: ${start}`);
  assert.notEqual(endIndex, -1, `Seção final ausente: ${end}`);

  return contents.slice(startIndex, endIndex);
}

test('edição de numeração preserva validação, short circuit, payload, fechamento e toasts', () => {
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const openHandler = sectionBetween(
    manager,
    'function openReportSequenceEdit',
    'function closeReportSequenceEdit'
  );
  const closeHandler = sectionBetween(
    manager,
    'function closeReportSequenceEdit',
    'async function handleReportSequenceEditSubmit'
  );
  const submitHandler = sectionBetween(
    manager,
    'async function handleReportSequenceEditSubmit',
    'function resetManualReportModal'
  );
  const unchangedBranch = sectionBetween(
    submitHandler,
    'if (sequenceNumber === sequenceEditReport.sequenceNumber)',
    'try {'
  );

  assert.match(openHandler, /setSequenceEditReport\(report\)/);
  assert.match(
    openHandler,
    /setSequenceEditValue\(report\.sequenceNumber \? String\(report\.sequenceNumber\) : ''\)/
  );
  assert.match(closeHandler, /setSequenceEditReport\(null\)/);
  assert.match(closeHandler, /setSequenceEditValue\(''\)/);

  assert.match(submitHandler, /event\.preventDefault\(\)/);
  assert.match(submitHandler, /if \(!sequenceEditReport\) return/);
  assert.match(
    submitHandler,
    /const normalizedValue = sequenceEditValue\.trim\(\)/
  );
  assert.match(
    submitHandler,
    /const sequenceNumber = \/\^\\d\+\$\/\.test\(normalizedValue\) \? Number\.parseInt\(normalizedValue, 10\) : NaN/
  );
  assert.match(
    submitHandler,
    /if \(!Number\.isInteger\(sequenceNumber\) \|\| sequenceNumber < 1\) \{[\s\S]*?showToast\('Informe um número maior que zero\.', 'error'\);[\s\S]*?return;/
  );

  assert.match(unchangedBranch, /closeReportSequenceEdit\(\)/);
  assert.match(unchangedBranch, /return;/);
  assert.doesNotMatch(unchangedBranch, /mutate(?:Async)?|showToast/);

  assert.match(
    submitHandler,
    /await reportMutations\.updateSequence\.mutateAsync\(\{\s*id: sequenceEditReport\.id,\s*payload: \{ sequenceNumber \}\s*\}\)/
  );
  assert.match(
    submitHandler,
    /mutateAsync\([\s\S]*?closeReportSequenceEdit\(\);\s*showToast\('Numeração atualizada\.', 'success'\)/
  );
  assert.match(
    submitHandler,
    /showToast\(error instanceof Error \? error\.message : 'Não foi possível alterar a numeração\.', 'error'\)/
  );
});

test('diálogo de numeração preserva conteúdo, constraints e estados pending', () => {
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const sequenceDialog = sectionBetween(
    manager,
    'const sequenceDialog = (',
    'return (\n      <>'
  );

  assert.match(sequenceDialog, /open=\{!!sequenceEditReport\}/);
  assert.match(sequenceDialog, /onClose=\{closeReportSequenceEdit\}/);
  assert.match(
    sequenceDialog,
    /backdropClassName="rdo-manager-sequence-dialog-backdrop"/
  );
  assert.match(
    sequenceDialog,
    /panelClassName="rdo-manager-sequence-dialog-modal"/
  );
  assert.match(sequenceDialog, /fullscreenOnMobile=\{false\}/);
  assert.match(
    manager,
    /const sequenceEditInputRef = useRef<HTMLInputElement>\(null\)/
  );
  assert.match(sequenceDialog, /initialFocusRef=\{sequenceEditInputRef\}/);
  assert.match(sequenceDialog, /<Input[\s\S]*?ref=\{sequenceEditInputRef\}/);
  assert.match(sequenceDialog, /ariaLabelledBy="report-sequence-edit-title"/);
  assert.match(sequenceDialog, /Alterar numeração/);
  assert.match(
    sequenceDialog,
    /Informe o novo número para \$\{sequenceEditReport\.reportType\}/
  );
  assert.match(sequenceDialog, /Informe o novo número do relatório\./);
  assert.match(sequenceDialog, /Novo número/);
  assert.match(sequenceDialog, /id="report-sequence-edit-input"/);
  assert.match(sequenceDialog, /type="number"/);
  assert.match(sequenceDialog, /min=\{1\}/);
  assert.match(sequenceDialog, /step=\{1\}/);
  assert.match(sequenceDialog, /inputMode="numeric"/);
  assert.match(sequenceDialog, /value=\{sequenceEditValue\}/);
  assert.match(
    sequenceDialog,
    /onChange=\{\(event\) => setSequenceEditValue\(event\.target\.value\)\}/
  );
  assert.match(sequenceDialog, /required/);
  assert.match(
    sequenceDialog,
    /type="button"[\s\S]*?disabled=\{reportMutations\.updateSequence\.isPending\}[\s\S]*?onClick=\{closeReportSequenceEdit\}[\s\S]*?Cancelar/
  );
  assert.match(
    sequenceDialog,
    /type="submit"[\s\S]*?disabled=\{reportMutations\.updateSequence\.isPending\}/
  );
  assert.match(
    sequenceDialog,
    /reportMutations\.updateSequence\.isPending\s*\?\s*'Salvando\.\.\.'\s*:\s*'Salvar número'/
  );
});

test('diálogo de numeração permanece compacto e centralizado no mobile', () => {
  const styles = source('src/pages/gestor/GestorPage.ds.css');
  const mobileDialog = sectionBetween(
    styles,
    '@media (max-width: 768px) {\n  :where(.fv-ds, [data-fv-ds]).rdo-manager-sequence-dialog-backdrop',
    ':where(.fv-ds, [data-fv-ds])\n  .reason-dialog--design-system'
  );

  assert.match(mobileDialog, /align-items: center/);
  assert.match(mobileDialog, /padding: var\(--space-4\)/);
  assert.match(mobileDialog, /height: auto/);
  assert.match(mobileDialog, /max-height: calc\(100dvh - var\(--space-8\)\)/);
  assert.match(mobileDialog, /border-radius: var\(--radius-lg\)/);
});

test('diálogo de numeração mantém opt-in DS e o formulário de RDO usa o Modal migrado', () => {
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const modal = source('src/components/ui/Modal.tsx');
  const reasonDialog = source('src/components/ui/ReasonDialog.tsx');
  const reportDetail = source('src/pages/ReportDetailPage.tsx');
  const signatureDialog = source('src/components/reports/SignatureDialog.tsx');
  const newReport = source('src/pages/collaborator/NewReportPage.tsx');
  const sequenceDialog = sectionBetween(
    manager,
    'const sequenceDialog = (',
    'return (\n      <>'
  );
  const archiveProjectDialog = sectionBetween(
    manager,
    '<Modal\n        open={Boolean(archiveSurveyProject)}',
    '<Modal open={showSurveyQuestionEditor}'
  );
  const manualReportDialog = sectionBetween(
    manager,
    '<Modal\n        open={manualReportModalOpen}',
    'function renderLoadMoreReports('
  );
  const surveyEditorDialog = sectionBetween(
    manager,
    '<Modal open={showSurveyQuestionEditor}',
    '</AppShell>'
  );
  const segmentDialog = sectionBetween(
    manager,
    '<Modal\n        open={showSegmentForm}',
    '<Modal\n        open={Boolean(archiveSurveyProject)}'
  );
  const detailSequenceDialog = sectionBetween(
    reportDetail,
    '<Modal open={sequenceEditOpen}',
    '</Modal>'
  );
  const collaboratorServiceDialog = sectionBetween(
    newReport,
    '<Modal\n        open={showServiceModal}',
    '</Modal>'
  );
  const signatureModal = sectionBetween(
    signatureDialog,
    '<Modal\n      open={open}',
    '</Modal>'
  );
  const managerWithoutAuthorizedDialogs = manager
    .replace(sectionBetween(manager, '<Modal\n          open={Boolean(dialogProject)}', '</Modal>'), '')
    .replace(sequenceDialog, '')
    .replace(segmentDialog, '')
    .replace(archiveProjectDialog, '')
    .replace(manualReportDialog, '')
    .replace(surveyEditorDialog, '');
  const otherManagerModals = [
    ...managerWithoutAuthorizedDialogs.matchAll(/<Modal\b[\s\S]*?<\/Modal>/g)
  ].map((match) => match[0]);

  assert.match(
    modal,
    /export type ModalAppearance = 'legacy' \| 'design-system'/
  );
  assert.match(modal, /appearance\?: ModalAppearance/);
  assert.match(modal, /appearance = 'legacy'/);

  assert.match(sequenceDialog, /<Modal\b[\s\S]*?appearance="design-system"/);
  assert.match(
    archiveProjectDialog,
    /<Modal\b[\s\S]*?appearance="design-system"/
  );
  assert.match(segmentDialog, /<Modal\b[\s\S]*?appearance="design-system"/);
  assert.match(manualReportDialog, /<Modal\b[\s\S]*?appearance="design-system"/);
  assert.match(surveyEditorDialog, /<Modal\b[\s\S]*?appearance="design-system"/);
  assert.match(manager, /panelClassName="rdo-archived-reports-dialog rdo-ds-actions"/);
  for (const otherModal of otherManagerModals) {
    assert.doesNotMatch(
      otherModal,
      /appearance="design-system"/,
      'todo novo opt-in DS precisa ser coberto explicitamente pelo contrato'
    );
  }
  assert.doesNotMatch(
    reasonDialog,
    /<Modal\b[\s\S]*?appearance="design-system"/,
    'ReasonDialog deve continuar usando a aparência legacy padrão'
  );
  assert.match(
    detailSequenceDialog,
    /appearance="design-system"/,
    'diálogo de numeração do detalhe migrado deve acompanhar o design system'
  );
  assert.match(signatureDialog, /appearance = 'legacy'/);
  assert.match(signatureModal, /appearance=\{appearance\}/);
  assert.doesNotMatch(signatureModal, /appearance="design-system"/);
  assert.match(
    collaboratorServiceDialog,
    /appearance="design-system"/,
    'seletor de serviço do formulário migrado deve usar o design system'
  );
  assert.match(collaboratorServiceDialog, /fullscreenOnMobile=\{false\}/);
  assert.match(collaboratorServiceDialog, /panelClassName="rdo-service-picker"/);
});
