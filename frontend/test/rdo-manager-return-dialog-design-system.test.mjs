import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { withRdoCompanions } from './rdo-source.mjs';

const frontendRoot = fileURLToPath(new URL('../', import.meta.url));
const source = (path) => withRdoCompanions(path, candidate => readFileSync(join(frontendRoot, candidate), 'utf8'));

function sectionBetween(contents, start, end) {
  const startIndex = contents.indexOf(start);
  const endIndex = contents.indexOf(end, startIndex);

  assert.notEqual(startIndex, -1, `Seção inicial ausente: ${start}`);
  assert.notEqual(endIndex, -1, `Seção final ausente: ${end}`);

  return contents.slice(startIndex, endIndex);
}

function sourceFilesUnder(path) {
  const files = [];

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(absolutePath);
    }
  }

  visit(join(frontendRoot, path));
  return files;
}

function componentTags(contents, componentName) {
  return [
    ...contents.matchAll(new RegExp(`<${componentName}\\b[\\s\\S]*?\\/>`, 'g'))
  ].map((match) => match[0]);
}

test('ReasonDialog preserva trim, validação obrigatória, reset, fechamento e pending', () => {
  const reasonDialog = source('src/components/ui/ReasonDialog.tsx');
  const resetEffect = sectionBetween(
    reasonDialog,
    'useEffect(() => {',
    'if (!open) return null'
  );
  const confirmHandler = sectionBetween(
    reasonDialog,
    'function handleConfirm()',
    'return ('
  );

  assert.match(reasonDialog, /const \[reason, setReason\] = useState\(''\)/);
  assert.match(reasonDialog, /const \[error, setError\] = useState\(''\)/);
  assert.match(resetEffect, /if \(!open\) return/);
  assert.match(resetEffect, /setReason\(''\)/);
  assert.match(resetEffect, /setError\(''\)/);
  assert.match(resetEffect, /\[open\]/);

  assert.match(confirmHandler, /const trimmed = reason\.trim\(\)/);
  assert.match(
    confirmHandler,
    /if \(!trimmed\) \{[\s\S]*?setError\(requiredMessage\);[\s\S]*?return;/
  );
  assert.match(confirmHandler, /onConfirm\(trimmed\)/);
  assert.doesNotMatch(confirmHandler, /mutate(?:Async)?|fetch\(|axios/);

  assert.match(reasonDialog, /isSubmitting = false/);
  assert.match(
    reasonDialog,
    /const reasonInputRef = useRef<HTMLTextAreaElement>\(null\)/
  );
  assert.match(reasonDialog, /initialFocusRef=\{reasonInputRef\}/);
  assert.match(reasonDialog, /<Modal[\s\S]*?open=\{open\}/);
  assert.match(reasonDialog, /onClose=\{onCancel\}/);
  assert.match(reasonDialog, /ariaLabelledBy="reason-dialog-title"/);
  assert.match(reasonDialog, /ariaDescribedBy="reason-dialog-description"/);
  assert.match(reasonDialog, /id="reason-dialog-text"/);
  assert.match(reasonDialog, /rows=\{4\}/);
  assert.match(reasonDialog, /value=\{reason\}/);
  assert.match(
    reasonDialog,
    /function handleReasonChange\(value: string\) \{[\s\S]*?setReason\(value\);[\s\S]*?if \(error\) setError\(''\)/
  );
  assert.ok(
    [...reasonDialog.matchAll(/handleReasonChange\(event\.target\.value\)/g)]
      .length >= 2,
    'os ramos DS e legacy devem compartilhar a limpeza do erro'
  );
  assert.ok(
    /\{error \? [\s\S]*?\{error\}[\s\S]*? : null\}/.test(reasonDialog) ||
      /\berror=\{error(?: \|\| undefined)?\}/.test(reasonDialog),
    'a mensagem obrigatória deve continuar ligada ao estado de erro'
  );
  assert.ok(
    [...reasonDialog.matchAll(/disabled=\{isSubmitting\}/g)].length >= 2,
    'Cancelar e confirmar devem permanecer desabilitados durante pending'
  );
  assert.match(reasonDialog, /onClick=\{onCancel\}[\s\S]*?\{cancelLabel\}/);
  assert.match(
    reasonDialog,
    /onClick=\{handleConfirm\}[\s\S]*?\{confirmLabel\}/
  );
});

test('Gestor preserva abertura, handler, payload, fechamento e toasts da devolução', () => {
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const actions = sectionBetween(
    manager,
    'function renderManagerReportActions',
    'function renderBatchReportActions'
  );
  const statusHandler = sectionBetween(
    manager,
    'async function handleReportStatus',
    'async function handleReportDownload'
  );
  const returnDialog = sectionBetween(
    manager,
    'const reasonDialog = (',
    'const sequenceDialog = ('
  );
  const openDialogHandler = sectionBetween(
    manager,
    'function openReturnReportDialog',
    'function closeReturnReportDialog'
  );
  const closeDialogHandler = sectionBetween(
    manager,
    'function closeReturnReportDialog',
    'function closeReportSequenceEdit'
  );

  assert.match(
    manager,
    /const \[returnReport, setReturnReport\] = useState<ReportSummary \| null>\(null\)/
  );
  assert.match(
    actions,
    /const canReview = tab === 'pendentes' && report\.status !== 'SIGNED'/
  );
  assert.match(actions, /report\.status !== 'RETURNED'/);
  assert.ok(
    [...actions.matchAll(/data-rdo-return-report-id=\{report\.id\}/g)].length >=
      2,
    'os gatilhos DS e legacy devem permanecer identificáveis para restaurar foco'
  );
  assert.ok(
    [
      ...actions.matchAll(
        /openReturnReportDialog\(report, event\.currentTarget\)/g
      )
    ].length >= 2,
    'os gatilhos DS e legacy devem registrar o elemento de origem'
  );
  assert.match(
    manager,
    /const returnReportTriggerRef = useRef<HTMLButtonElement \| null>\(null\)/
  );
  assert.match(
    manager,
    /const returnReportTriggerIdRef = useRef<string \| null>\(null\)/
  );
  assert.match(openDialogHandler, /returnReportTriggerRef\.current = trigger/);
  assert.match(
    openDialogHandler,
    /returnReportTriggerIdRef\.current = report\.id/
  );
  assert.match(openDialogHandler, /setReturnReport\(report\)/);
  assert.match(closeDialogHandler, /setReturnReport\(null\)/);
  assert.match(closeDialogHandler, /window\.requestAnimationFrame/);
  assert.match(
    closeDialogHandler,
    /document\.querySelectorAll<HTMLButtonElement>\([\s\S]*?'\[data-rdo-return-report-id\]'/
  );
  assert.match(closeDialogHandler, /connectedTrigger\?\.focus\(\)/);

  assert.match(
    statusHandler,
    /await reportMutations\.updateStatus\.mutateAsync\(\{\s*id: report\.id,\s*payload: \{ status, reviewNotes \}\s*\}\)/
  );
  assert.match(
    statusHandler,
    /if \(status === 'RETURNED'\) setReturnReport\(null\)/
  );
  assert.match(
    statusHandler,
    /showToast\(status === 'APPROVED' \? 'Relatório aprovado\.' : 'Relatório devolvido\.', 'success'\)/
  );
  assert.match(
    statusHandler,
    /showToast\(error instanceof Error \? error\.message : 'Não foi possível revisar o relatório\.', 'error'\)/
  );

  assert.match(returnDialog, /open=\{!!returnReport\}/);
  assert.match(returnDialog, /title="Devolver relatório"/);
  assert.match(
    returnDialog,
    /description="Informe o motivo da devolução do relatório\."/
  );
  assert.match(returnDialog, /label="Motivo"/);
  assert.match(returnDialog, /confirmLabel="Devolver"/);
  assert.match(
    returnDialog,
    /requiredMessage="Informe um motivo para devolver o relatório\."/
  );
  assert.match(
    returnDialog,
    /isSubmitting=\{reportMutations\.updateStatus\.isPending\}/
  );
  assert.match(returnDialog, /onCancel=\{closeReturnReportDialog\}/);
  assert.match(
    returnDialog,
    /onConfirm=\{(?:\(reason\)|reason) => \{\s*if \(returnReport\) void handleReportStatus\(returnReport, 'RETURNED', reason\);\s*\}\}/
  );

  assert.match(
    manager,
    /useAccumulatedReportsPage, useBatchedReportCounts, useReportCounts, useReportMutations/
  );
  assert.match(manager, /const reportMutations = useReportMutations\(\)/);
});

test('gate B.5 mantém default legacy e habilita o DS apenas nas superfícies migradas', () => {
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const reasonDialog = source('src/components/ui/ReasonDialog.tsx');
  const modal = source('src/components/ui/Modal.tsx');
  const reportDetail = source('src/pages/ReportDetailPage.tsx');
  const managerReturnDialog = sectionBetween(
    manager,
    'const reasonDialog = (',
    'const sequenceDialog = ('
  );
  const detailDialogs = componentTags(reportDetail, 'ReasonDialog');
  const appearanceApiPattern =
    /appearance\?:\s*(?:ModalAppearance|ReasonDialogAppearance|'legacy'\s*\|\s*'design-system')/;
  const hasAppearanceApi = appearanceApiPattern.test(reasonDialog);

  assert.match(
    modal,
    /export type ModalAppearance = 'legacy' \| 'design-system'/
  );
  assert.match(modal, /appearance\?: ModalAppearance/);
  assert.match(modal, /appearance = 'legacy'/);
  assert.doesNotMatch(
    reasonDialog,
    /from ['"][^'"]*(?:api|hooks|store)[^'"]*['"]/
  );

  assert.equal(
    detailDialogs.length,
    2,
    'ReportDetail deve manter suas duas instâncias caracterizadas de ReasonDialog'
  );
  assert.equal(
    detailDialogs.filter((dialog) => /\bappearance="design-system"/.test(dialog)).length,
    2,
    'edição e revisão do cliente devem acompanhar o design system'
  );
  assert.equal(
    detailDialogs.filter((dialog) => !/\bappearance=/.test(dialog)).length,
    0,
    'nenhum diálogo do detalhe migrado deve depender do default legacy'
  );

  if (!hasAppearanceApi) {
    assert.doesNotMatch(
      managerReturnDialog,
      /\bappearance=/,
      'before legacy não deve fingir que o opt-in B.5 já existe'
    );
    assert.doesNotMatch(reasonDialog, /appearance="design-system"/);
    return;
  }

  assert.match(reasonDialog, appearanceApiPattern);
  if (/ReasonDialogAppearance/.test(reasonDialog)) {
    assert.match(
      reasonDialog,
      /type ReasonDialogAppearance = 'legacy' \| 'design-system'/
    );
  }
  assert.match(reasonDialog, /appearance = 'legacy'/);
  assert.match(reasonDialog, /<Modal[\s\S]*?appearance=\{appearance\}/);
  assert.match(
    managerReturnDialog,
    /<ReasonDialog\b[\s\S]*?appearance="design-system"/
  );

  const optedInFiles = sourceFilesUnder('src')
    .filter((path) => /\.tsx$/.test(path))
    .filter((path) =>
      componentTags(readFileSync(path, 'utf8'), 'ReasonDialog').some((tag) =>
        /\bappearance="design-system"/.test(tag)
      )
    );

  assert.deepEqual(
    optedInFiles.sort(),
    [
      join(frontendRoot, 'src/components/reports/ReportDetailActions.tsx'),
      join(frontendRoot, 'src/pages/ReportDetailPage.tsx'),
      join(frontendRoot, 'src/pages/gestor/GestorPage.tsx')
    ].sort()
  );
});
