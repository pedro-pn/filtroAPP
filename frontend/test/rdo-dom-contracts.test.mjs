import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { withRdoCompanions } from './rdo-source.mjs';

const source = (path) =>
  withRdoCompanions(path, candidate => readFileSync(new URL(`../${candidate}`, import.meta.url), 'utf8'));

function assertIncludesAll(actual, expected, context) {
  for (const value of expected) {
    assert.ok(actual.includes(value), `${context}: contrato ausente: ${value}`);
  }
}

test('tutorial do cliente mantém seletores Driver.js com produtores no DOM do RDO', () => {
  const tutorial = source('src/components/ClientTutorial.tsx');
  const clientPage = source('src/pages/client/ClientPage.tsx');
  const signatureProgress = source(
    'src/components/reports/SignatureProgress.tsx'
  );

  const requiredSelectors = [
    '.client-welcome-card',
    '.stats-grid',
    'input[aria-label="Buscar relatórios"]',
    '.filter-tabs[aria-label="Projetos do cliente"]',
    '.det-section',
    '.filter-tabs[aria-label="Tipos de relatório"]',
    '.client-report-card',
    '.client-report-card .fv-button--secondary',
    '.client-report-comment textarea',
    '.client-report-actions .fv-button--primary',
    '.client-report-actions .fv-button--danger',
    '.signature-progress',
    '.report-batch-toolbar',
    '.fv-topbar-profile:not(:disabled)'
  ];

  assertIncludesAll(tutorial, requiredSelectors, 'ClientTutorial');
  assertIncludesAll(
    clientPage,
    [
      'className="client-welcome-card"',
      'className="stats-grid"',
      'aria-label="Buscar relatórios"',
      'aria-label="Projetos do cliente"',
      'aria-label="Tipos de relatório"',
      'className="client-report-card report-card-clickable"',
      'className="field-group client-report-comment"',
      'className="client-report-actions"',
      'className="report-batch-toolbar',
      'variant="secondary"',
      'variant="primary"',
      'variant="danger"'
    ],
    'ClientPage'
  );
  assert.ok(signatureProgress.includes('className="signature-progress"'));
});

test('tours contextuais do cliente mantêm data attributes produzidos e consultados', () => {
  const clientPage = source('src/pages/client/ClientPage.tsx');

  assertIncludesAll(
    clientPage,
    [
      '`[data-client-report-tab="${report.projectId}-${report.reportType}"]`',
      '`[data-client-report-id="${reportIdSelector}"]`',
      '`[data-client-report-checkbox="${reportIdSelector}"]`',
      "document.querySelector('[data-client-batch-signature-button]')",
      'data-client-report-id={report.id}',
      'data-client-report-checkbox={report.id}',
      'data-client-batch-signature-button',
      'data-client-report-tab={`${activeProject.id}-${reportType}`}'
    ],
    'ClientPage'
  );
});

test('novidade de DDS mantém o mesmo alvo entre Driver.js e formulário', () => {
  const novelty = source('src/components/reports/RdoDdsNovelty.tsx');
  const conditions = source(
    'src/components/reports/NewReportSpecialConditions.tsx'
  );

  assert.ok(
    novelty.includes("const DDS_TOGGLE_SELECTOR = '[data-dds-novelty]'")
  );
  assert.ok(novelty.includes('document.querySelector(DDS_TOGGLE_SELECTOR)'));
  assert.ok(novelty.includes('element: DDS_TOGGLE_SELECTOR'));
  assert.ok(conditions.includes('data-dds-novelty={isDay ? true : undefined}'));
});

test('editor de RDO mantém âncoras de campos, etapas e validação focável', () => {
  const editor = source('src/pages/collaborator/NewReportPage.tsx');
  const progressSteps = source('src/components/ui/ds/ProgressSteps.tsx');
  const conditions = source(
    'src/components/reports/NewReportSpecialConditions.tsx'
  );

  assertIncludesAll(
    editor,
    [
      '<ProgressSteps',
      'ariaLabel="Etapas do relatório"',
      'onKeyDown={handleHorizontalTabListKeyDown}',
      'id="rdo-project"',
      'id="rdo-date"',
      'id="rdo-arrival"',
      'id="rdo-departure"',
      'id="rdo-lunch"',
      'id="rdo-overtime"',
      'id="rdo-description"',
      'data-invalid-target="header:projectId"',
      'data-invalid-target="header:reportDate"',
      'data-invalid-target="header:arrivalTime"',
      'data-invalid-target="header:departureTime"',
      'data-invalid-target="header:lunchBreak"',
      'data-invalid-target="header:collaborators"',
      'data-invalid-target="services:empty"',
      'data-service-id={service.id}',
      '`[data-invalid-target="${target}"]`',
      '`[data-service-id="${serviceId}"] .field-invalid input`'
    ],
    'NewReportPage'
  );

  assertIncludesAll(
    progressSteps,
    [
      'role="tablist"',
      'role="tab"',
      'aria-selected={index === currentIndex}',
      "aria-current={index === currentIndex ? 'step' : undefined}",
      'aria-disabled={disabled || undefined}'
    ],
    'ProgressSteps'
  );

  assertIncludesAll(
    conditions,
    [
      'data-invalid-target={startTarget}',
      'data-invalid-target={endTarget}',
      'data-invalid-target={themesTarget}',
      'data-invalid-target="header:standbyDuration"',
      'data-invalid-target="header:standbyMotivo"',
      'data-invalid-target="header:noturnoStart"',
      'data-invalid-target="header:noturnoEnd"',
      'data-invalid-target="header:noturnoInterval"',
      'data-invalid-target="header:nightCollaborators"'
    ],
    'NewReportSpecialConditions'
  );
});

test('abas do RDO preservam nomes acessíveis, estado e teclado após a migração visual', () => {
  const contracts = [
    {
      file: 'src/pages/collaborator/MyReportsPage.tsx',
      label: 'aria-label="Status dos relatórios"',
      selected: 'aria-selected={tab ===',
      keyboard: 'handleHorizontalTabListKeyDown',
      values: ["param: 'tab'", "defaultValue: 'pending'"]
    },
    {
      file: 'src/pages/client/ClientPage.tsx',
      label: 'aria-label="Projetos do cliente"',
      selected: 'aria-selected={project.id === activeProject.id}',
      keyboard: 'handleHorizontalTabListKeyDown',
      values: ['aria-label="Tipos de relatório"']
    }
  ];

  for (const contract of contracts) {
    const page = source(contract.file);
    assertIncludesAll(
      page,
      [
        contract.label,
        contract.selected,
        contract.keyboard,
        ...contract.values
      ],
      contract.file
    );
    assert.ok(page.includes('role="tablist"'), contract.file);
    assert.ok(page.includes('role="tab"'), contract.file);
  }

  const coordinator = source('src/pages/coordinator/CoordinatorPage.tsx');
  const sectionNavigation = source('src/pages/gestor/RdoSectionNavigation.tsx');
  assertIncludesAll(coordinator, [
    'ariaLabel="Seções do coordenador"',
    'current={tab}',
    'sections={COORDINATOR_SECTIONS}',
    'onNavigate={setTab}',
    "param: 'tab'",
    "defaultValue: 'pending'"
  ], 'CoordinatorPage');
  assertIncludesAll(sectionNavigation, [
    "'ArrowLeft'",
    "'ArrowRight'",
    "'Home'",
    "'End'",
    "aria-current={active ? 'page' : undefined}",
    'aria-pressed={active}'
  ], 'RdoSectionNavigation');
});

test('gestor usa navegação secundária responsiva sem a barra horizontal global', () => {
  const page = source('src/pages/gestor/GestorPage.tsx');
  const navigation = source('src/pages/gestor/RdoSectionNavigation.tsx');

  assertIncludesAll(
    page,
    [
      "searchParams.get('tab')",
      ": 'pendentes'",
      '<RdoSectionNavigation',
      'subNavigation:',
      "parentId: 'rdo'"
    ],
    'GestorPage'
  );
  assertIncludesAll(
    navigation,
    [
      "ariaLabel = 'Navegar nas áreas de Relatórios e Projetos'",
      'aria-label={ariaLabel}',
      'role="group"',
      'aria-pressed={active}',
      "aria-current={active ? 'page' : undefined}"
    ],
    'RdoSectionNavigation'
  );
  assert.doesNotMatch(navigation, /aria-haspopup|role="menu"|role="menuitem"/);
  assert.doesNotMatch(navigation, /<Select\b|<option\b/);
  assert.doesNotMatch(page, /aria-label="Seções do gestor"/);
  assert.doesNotMatch(page, /rdo-manager-tabs-wrap/);
});

test('busca legada do RDO mantém nome acessível, limpeza e contagem', () => {
  const searchBar = source('src/components/ui/SearchBar.tsx');

  assertIncludesAll(
    searchBar,
    [
      'type="search"',
      'aria-label={ariaLabel || placeholder}',
      'aria-label="Limpar busca"',
      "onClick={() => onChange('')}",
      '{count.shown} de {count.total}'
    ],
    'SearchBar'
  );
});

test('lista agrupada mantém interação por teclado e quantidade visível anunciada', () => {
  const groupedList = source('src/components/reports/GroupedReportList.tsx');

  assertIncludesAll(
    groupedList,
    [
      'role="button"',
      'tabIndex={0}',
      "e.key === 'Enter' || e.key === ' '",
      'aria-expanded={!projectClosed}',
      'aria-controls={projectPanelId}',
      'id={projectPanelId}',
      'aria-expanded={!typeClosed}',
      'aria-controls={typePanelId}',
      'id={typePanelId}',
      '{visibleReports.length} de {totalReports} relatório',
      'disabled={typeLoading}',
      "typeLoading ? 'Carregando...'",
      'aria-hidden="true"'
    ],
    'GroupedReportList'
  );
});

test('diálogo de assinatura mantém IDs e nomes acessíveis consumidos pelo fluxo', () => {
  const signatureDialog = source('src/components/reports/SignatureDialog.tsx');

  assertIncludesAll(
    signatureDialog,
    [
      "ariaLabelledBy={isDesignSystem ? undefined : 'signature-dialog-title'}",
      'title={isDesignSystem ? title : undefined}',
      'id="signature-dialog-title"',
      'aria-label="Fechar"',
      'htmlFor="signature-signer-name"',
      'id="signature-signer-name"',
      "aria-describedby={signerNameInvalid ? 'signature-dialog-error' : undefined}",
      'aria-label="Modo de assinatura"',
      'aria-label="Área para desenhar assinatura"',
      'alt="Prévia da assinatura"',
      'id="signature-dialog-error"'
    ],
    'SignatureDialog'
  );
});
