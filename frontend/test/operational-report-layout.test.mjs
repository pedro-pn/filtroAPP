import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createServer } from 'vite';

async function loadOperationalReportSchema() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule('/src/schemas/operationalReport.ts');
  } finally {
    await server.close();
  }
}

async function loadOperationalReportsNovelty() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule('/src/utils/operationalReportsNovelty.ts');
  } finally {
    await server.close();
  }
}

test('RDO comum e relatórios operacionais compartilham os campos centrais', async () => {
  const [rdo, operational] = await Promise.all([
    readFile(
      new URL('../src/pages/collaborator/NewReportPage.tsx', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL(
        '../src/pages/collaborator/OperationalReportFormPage.tsx',
        import.meta.url
      ),
      'utf8'
    )
  ]);
  const sharedComponents = [
    'ReportFormStepper',
    'ReportDateField',
    'ReportScheduleCard',
    'ReportCollaboratorsCard',
    'ReportOvertimeCard',
    'ReportFormActions'
  ];

  for (const component of sharedComponents) {
    assert.match(rdo, new RegExp(`<${component}`));
    assert.match(operational, new RegExp(`<${component}`));
  }
});

test('turno noturno usa a mesma implementação nos dois fluxos', async () => {
  const [specialConditions, operational] = await Promise.all([
    readFile(
      new URL(
        '../src/components/reports/NewReportSpecialConditions.tsx',
        import.meta.url
      ),
      'utf8'
    ),
    readFile(
      new URL(
        '../src/pages/collaborator/OperationalReportFormPage.tsx',
        import.meta.url
      ),
      'utf8'
    )
  ]);

  assert.match(specialConditions, /<ReportNightShiftFields/);
  assert.match(operational, /<ReportNightShiftFields/);
  assert.doesNotMatch(operational, /operational-collaborator-grid/);
  assert.doesNotMatch(operational, /operational-toggle/);
});

test('componente compartilhado preserva a estrutura visual consolidada do RDO', async () => {
  const shared = await readFile(
    new URL('../src/components/reports/ReportCoreFields.tsx', import.meta.url),
    'utf8'
  );

  assert.match(shared, /className="page-card rdo-step-panel"/);
  assert.match(shared, /className="fg-r2"/);
  assert.match(shared, /colab-list/);
  assert.match(shared, /className="cadd"/);
  assert.match(shared, /className="tog-row"/);
  assert.match(shared, /className="collapse-section noturno-section"/);
  assert.match(shared, /className="page-card rdo-bottom-actions"/);
});

test('manutenção usa o padrão visual de anexos e exibe os dados cadastrados do equipamento', async () => {
  const [form, uploadField] = await Promise.all([
    readFile(
      new URL(
        '../src/pages/collaborator/OperationalReportFormPage.tsx',
        import.meta.url
      ),
      'utf8'
    ),
    readFile(
      new URL('../src/components/ui/UploadField.tsx', import.meta.url),
      'utf8'
    )
  ]);

  assert.match(form, /<PdfDropzone/);
  assert.equal((form.match(/<UploadPreviewListItem/g) || []).length, 2);
  assert.match(
    form,
    /className="upload-list operational-maintenance-photo-list"/
  );
  assert.match(form, /className="operational-maintenance-photos"/);
  assert.match(form, /className="operational-equipment-data"/);
  assert.match(form, /selectedEquipment\.attributes/);
  assert.match(uploadField, /className="upload-list-thumb"/);
  assert.match(uploadField, /target="_blank"/);
  assert.doesNotMatch(
    form,
    /id=\{`maintenance-photos-\$\{index\}`\}\s*type="file"/
  );
  assert.match(
    await readFile(
      new URL('../src/styles/operational-reports.css', import.meta.url),
      'utf8'
    ),
    /\.operational-repeat-card > \*,[\s\S]*?\.operational-maintenance-photo-list\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;/
  );
  assert.match(
    await readFile(
      new URL('../src/styles/operational-reports.css', import.meta.url),
      'utf8'
    ),
    /\.operational-maintenance-photo-list \.upload-list-item > a:first-child\s*\{[^}]*flex:\s*0 0 44px;[^}]*min-width:\s*44px;/s
  );
});

test('seleção da manutenção filtra equipamentos pela categoria escolhida', async () => {
  const form = await readFile(
    new URL(
      '../src/pages/collaborator/OperationalReportFormPage.tsx',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(form, /Categoria do equipamento/);
  assert.match(form, /item\.category\?\.id === equipmentCategoryId/);
  assert.match(form, /disabled=\{!equipmentCategoryId\}/);
  assert.doesNotMatch(form, /maintenance-equipment-search/);
});

test('categoria controla sua presença em todas as áreas de manutenção', async () => {
  const [modal, manager, config, api] = await Promise.all([
    readFile(
      new URL('../src/pages/equipamentos/CategoryFormModal.tsx', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL('../src/pages/equipamentos/CategoryManager.tsx', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL('../src/pages/equipamentos/MaintenanceConfigPanel.tsx', import.meta.url),
      'utf8'
    ),
    readFile(new URL('../src/api/equipamentos.ts', import.meta.url), 'utf8')
  ]);

  assert.match(modal, /category\?\.showInMaintenance \?\? true/);
  assert.match(modal, /Exibir no módulo de manutenção/);
  assert.match(modal, /showInMaintenance,/);
  assert.match(manager, /fora da manutenção/);
  assert.match(
    config,
    /categories\.filter\(\(category\) => category\.showInMaintenance !== false\)/
  );
  assert.match(api, /showInMaintenance: boolean;/);
  assert.match(api, /showInMaintenance\?: boolean;/);
});

test('serviço de terceiros usa grade responsiva sem larguras mínimas fixas', async () => {
  const styles = await readFile(
    new URL('../src/styles/operational-reports.css', import.meta.url),
    'utf8'
  );

  assert.match(
    styles,
    /\.operational-third-party\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s
  );
  assert.match(styles, /\.operational-third-party > \.field-group/);
  assert.doesNotMatch(styles, /grid-template-columns:\s*150px minmax\(140px/);
});

test('checklist de serviços da manutenção não possui scroll interno no mobile', async () => {
  const styles = await readFile(
    new URL('../src/styles/operational-reports.css', import.meta.url),
    'utf8'
  );

  assert.match(
    styles,
    /@media \(max-width: 720px\)[\s\S]*?\.operational-checklist\s*\{[^}]*max-height:\s*none;[^}]*overflow:\s*visible;/s
  );
});

test('cabeçalhos e anexos do formulário operacional cabem em celulares estreitos', async () => {
  const [form, styles] = await Promise.all([
    readFile(
      new URL(
        '../src/pages/collaborator/OperationalReportFormPage.tsx',
        import.meta.url
      ),
      'utf8'
    ),
    readFile(
      new URL('../src/styles/operational-reports.css', import.meta.url),
      'utf8'
    )
  ]);

  assert.equal(
    (form.match(/operational-card-head operational-section-head/g) || [])
      .length,
    2
  );
  assert.match(styles, /@media \(max-width: 360px\)/);
  assert.match(
    styles,
    /\.operational-form-page \.operational-section-head\s*\{[^}]*flex-direction:\s*column/s
  );
  assert.match(
    styles,
    /\.operational-form-page \.operational-section-head > button\s*\{[^}]*width:\s*100%/s
  );
  assert.match(
    styles,
    /\.operational-form-page \.pdf-dropzone\s*\{[^}]*padding-inline:\s*12px/s
  );
  assert.match(
    styles,
    /\.pdf-dropzone > input\.visually-hidden,[\s\S]*?width:\s*1px;[\s\S]*?height:\s*1px;/
  );
  assert.match(
    styles,
    /@media \(max-width: 720px\)[\s\S]*?\.operational-profile-card,[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/
  );
});

test('envio operacional é direto e a revisão abre o editor completo sem resumo intermediário', async () => {
  const [
    form,
    modulePage,
    reportPermissions,
    newReportPage
  ] = await Promise.all([
    readFile(
      new URL(
        '../src/pages/collaborator/OperationalReportFormPage.tsx',
        import.meta.url
      ),
      'utf8'
    ),
    readFile(
      new URL('../src/pages/MaintenanceProductionPage.tsx', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL('../src/auth/reportPermissions.ts', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL('../src/pages/collaborator/NewReportPage.tsx', import.meta.url),
      'utf8'
    )
  ]);

  assert.match(form, /navigate\(operationalModuleReturnPath\(mode\)\)/);
  assert.match(form, /\(values\) => mutation\.mutate\(values\)/);
  assert.doesNotMatch(form, /confirmationOpen|Confirmar envio|<ConfirmDialog/);
  assert.match(form, /reviewMode \|\| currentStep === 0/);
  assert.match(form, /reviewMode \|\| currentStep === 1/);
  assert.match(form, />\s*Aprovar\s*</);
  assert.match(form, />\s*Devolver\s*</);
  assert.doesNotMatch(form, /await persistReport\(values\);\s*if \(action/);
  assert.match(form, /<ReasonDialog/);
  assert.match(modulePage, /operationalReportEditorPath/);
  assert.match(modulePage, /'manutencao-avulsa'/);
  assert.match(modulePage, /<option value="PENDING">Pendente<\/option>/);
  assert.match(reportPermissions, /params\.set\('revisao', '1'\)/);
  assert.match(newReportPage, /const operationalSelection/);
  assert.doesNotMatch(modulePage, /<Modal|<ConfirmDialog|openReport\(/);
});

test('cards internos seguem o padrão dos RDOs e aprovados ficam disponíveis para consulta', async () => {
  const [modulePage, card, form] = await Promise.all([
    readFile(new URL('../src/pages/MaintenanceProductionPage.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL(
        '../src/components/reports/OperationalReportSummaryCard.tsx',
        import.meta.url
      ),
      'utf8'
    ),
    readFile(
      new URL(
        '../src/pages/collaborator/OperationalReportFormPage.tsx',
        import.meta.url
      ),
      'utf8'
    )
  ]);

  assert.match(modulePage, /<OperationalReportSummaryCard/);
  assert.match(modulePage, /<StandaloneMaintenanceSummaryCard/);
  assert.match(modulePage, /value="APPROVED">Aprovado/);
  assert.match(card, /rel-item report-card report-card-clickable/);
  assert.match(card, /className="report-card-main"/);
  assert.match(card, /className="rel-info"/);
  assert.match(card, /className="report-card-side"/);
  assert.match(modulePage, /operationalReportEditorPath/);
  assert.match(form, /approvedReadOnly/);
  assert.match(form, /disponível somente para consulta/);
  assert.match(form, /const approvedReadOnly = reportStatus === 'APPROVED'/);
  assert.match(form, /disabled=\{formReadOnly\}/);
});

test('histórico baixa o PDF pela rota da API e ações do equipamento não estouram o card', async () => {
  const [api, history, equipmentCard, styles] = await Promise.all([
    readFile(
      new URL('../src/api/operationalReports.ts', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL(
        '../src/pages/equipamentos/MaintenanceHistoryModal.tsx',
        import.meta.url
      ),
      'utf8'
    ),
    readFile(
      new URL('../src/pages/equipamentos/EquipmentCard.tsx', import.meta.url),
      'utf8'
    ),
    readFile(new URL('../src/styles/base.css', import.meta.url), 'utf8')
  ]);

  assert.match(api, /attachment\.url\.startsWith\('\/api\/'\)/);
  assert.match(api, /attachment\.url\.slice\('\/api'\.length\)/);
  assert.match(api, /document\.body\.appendChild\(anchor\)/);
  assert.match(history, /handleDownload/);
  assert.match(history, /Não foi possível baixar o PDF da manutenção/);
  assert.match(equipmentCard, /equip-maintenance-action/);
  assert.match(
    styles,
    /\.equip-card \.report-card-actions \.mini-btn\s*\{[^}]*flex:\s*1 1 108px[^}]*overflow-wrap:\s*anywhere/s
  );
});

test('configuração de manutenção usa perfil padrão por categoria e exceções individuais', async () => {
  const config = await readFile(
    new URL(
      '../src/pages/equipamentos/MaintenanceConfigPanel.tsx',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(config, /Perfil padrão por categoria/);
  assert.match(config, /Exceções por equipamento/);
  assert.match(config, /maintenanceProfileOverride/);
  assert.match(config, /useForm<MaintenanceProfileFormValues>/);
  assert.match(config, /zodResolver\(maintenanceProfileFormSchema\)/);
  assert.match(config, /item\.isActive/);
  assert.match(config, /panelClassName="modal-card equip-modal"/);
  assert.match(
    config,
    /className="admin-form-actions equip-form-actions"[\s\S]*?Salvar supervisor/
  );
});

test('manutenção avulsa usa React Hook Form com resolver Zod', async () => {
  const [form, schema] = await Promise.all([
    readFile(
      new URL(
        '../src/pages/collaborator/OperationalReportFormPage.tsx',
        import.meta.url
      ),
      'utf8'
    ),
    loadOperationalReportSchema()
  ]);

  assert.match(form, /standaloneOperationalReportFormSchema/);
  assert.doesNotMatch(form, /resolver:\s*standalone\s*\?\s*undefined/);
  assert.ok(schema.standaloneOperationalReportFormSchema);
});

test('tutorial operacional fica concentrado no novo módulo', async () => {
  const [home, manager, modulePage, equipment] = await Promise.all([
    readFile(new URL('../src/pages/collaborator/HomePage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/gestor/GestorPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/MaintenanceProductionPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/equipamentos/EquipamentosPage.tsx', import.meta.url), 'utf8')
  ]);

  assert.doesNotMatch(home, /<OperationalReportsNovelty/);
  assert.doesNotMatch(manager, /<OperationalReportsNovelty/);
  assert.match(modulePage, /<OperationalReportsNovelty/);
  assert.doesNotMatch(equipment, /<OperationalReportsNovelty/);
});

test('campanha de novidade respeita elegibilidade, exibição única e expiração', async () => {
  const {
    canStartOperationalModuleTutorial,
    canStartOperationalReportsNovelty,
    OPERATIONAL_REPORTS_NOVELTY_EXPIRES_AT
  } = await loadOperationalReportsNovelty();
  const beforeExpiry = OPERATIONAL_REPORTS_NOVELTY_EXPIRES_AT.getTime() - 1;

  assert.equal(
    canStartOperationalReportsNovelty({
      user: { id: 'manager-1' },
      eligible: true,
      now: beforeExpiry,
      seen: false
    }),
    true
  );
  assert.equal(
    canStartOperationalReportsNovelty({
      user: { id: 'manager-1' },
      eligible: true,
      now: beforeExpiry,
      seen: true
    }),
    false
  );
  assert.equal(
    canStartOperationalReportsNovelty({
      user: { id: 'manager-1' },
      eligible: true,
      now: OPERATIONAL_REPORTS_NOVELTY_EXPIRES_AT.getTime() + 1,
      seen: false
    }),
    false
  );
  assert.equal(
    canStartOperationalReportsNovelty({
      user: { id: 'manager-1' },
      eligible: false,
      now: beforeExpiry,
      seen: false
    }),
    false
  );
  assert.equal(
    canStartOperationalModuleTutorial({
      user: { id: 'manager-1' },
      eligible: true,
      seen: false
    }),
    true
  );
  assert.equal(
    canStartOperationalModuleTutorial({
      user: { id: 'manager-1' },
      eligible: true,
      seen: true
    }),
    false
  );
});

test('manutenção e produção possuem módulo próprio com abas e histórico responsivo', async () => {
  const [registry, hubModules, app, modulePage, history, styles, newReport] =
    await Promise.all([
      readFile(new URL('../../shared/modules/registry.json', import.meta.url), 'utf8'),
      readFile(new URL('../src/pages/hubModules.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/pages/MaintenanceProductionPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/reports/MaintenanceHistoryTable.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/styles/operational-reports.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/pages/collaborator/NewReportPage.tsx', import.meta.url), 'utf8')
    ]);

  assert.match(registry, /"id": "maintenance-production"/);
  assert.match(registry, /"title": "Manutenção e produção"/);
  assert.match(hubModules, /canAccessOperationalModule/);
  assert.match(app, /MaintenanceProductionPage/);
  assert.match(modulePage, /historico-manutencao/);
  assert.match(modulePage, /data-operational-module-tabs/);
  assert.match(history, /operational-maintenance-history-table/);
  assert.match(history, /operational-maintenance-history-cards/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*?operational-maintenance-history-table[\s\S]*?display:\s*none/s);
  assert.doesNotMatch(newReport, /<ReportTypeChooser/);
  assert.match(newReport, /resolveSiteReportSelection/);
});

test('intervalos compartilhados preservam segundos e a validação aceita HH:mm:ss', async () => {
  const shared = await readFile(
    new URL('../src/components/reports/ReportCoreFields.tsx', import.meta.url),
    'utf8'
  );
  const { operationalReportFormSchema } = await loadOperationalReportSchema();
  const result = operationalReportFormSchema.safeParse({
    kind: 'MAINTENANCE',
    reportDate: '2026-09-03',
    arrivalTime: '07:00',
    departureTime: '17:00',
    lunchBreak: '01:00:00',
    collaboratorIds: ['collaborator-1'],
    nightShift: {
      enabled: true,
      arrivalTime: '18:00',
      departureTime: '22:00',
      breakTime: '00:30:00',
      collaboratorIds: ['collaborator-1']
    },
    overtimeReason: '',
    dailyDescription: 'Manutenção preventiva',
    maintenanceRecords: [
      {
        equipmentId: 'equipment-1',
        selectedServiceIds: ['service-1'],
        observations: '',
        thirdPartyServices: [],
        photos: [],
        removePhotoIds: []
      }
    ],
    chemicalCleanings: []
  });

  assert.equal(result.success, true);
  assert.equal((shared.match(/step=\{1\}/g) || []).length, 2);
  assert.doesNotMatch(shared, /normalizeReportMinuteTime/);
});

test('módulo usa largura de desktop e histórico ordenável no servidor', async () => {
  const [page, table, api, styles] = await Promise.all([
    readFile(
      new URL('../src/pages/MaintenanceProductionPage.tsx', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL(
        '../src/components/reports/MaintenanceHistoryTable.tsx',
        import.meta.url
      ),
      'utf8'
    ),
    readFile(
      new URL('../src/api/operationalReports.ts', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL('../src/styles/operational-reports.css', import.meta.url),
      'utf8'
    )
  ]);

  assert.match(
    styles,
    /\.app-shell:has\(\.operational-module-page\)\s*\{[^}]*max-width:\s*none;/s
  );
  assert.match(table, /aria-sort=\{ariaSort\}/);
  assert.match(table, /onSortChange\(field, nextDirection\)/);
  assert.match(api, /sortDirection\?: MaintenanceHistorySortDirection/);
  assert.match(page, /searchParams\.get\('sort'\)/);
  assert.match(page, /searchParams\.get\('direction'\)/);
});

test('programação preventiva fica restrita à manutenção, calcula prazos no backend e possui alternativa mobile', async () => {
  const [page, board, config, api, schema, styles, backendRoute] =
    await Promise.all([
      readFile(
        new URL('../src/pages/MaintenanceProductionPage.tsx', import.meta.url),
        'utf8'
      ),
      readFile(
        new URL(
          '../src/components/reports/MaintenanceScheduleBoard.tsx',
          import.meta.url
        ),
        'utf8'
      ),
      readFile(
        new URL(
          '../src/pages/equipamentos/MaintenanceConfigPanel.tsx',
          import.meta.url
        ),
        'utf8'
      ),
      readFile(
        new URL('../src/api/operationalReports.ts', import.meta.url),
        'utf8'
      ),
      loadOperationalReportSchema(),
      readFile(
        new URL('../src/styles/operational-reports.css', import.meta.url),
        'utf8'
      ),
      readFile(
        new URL(
          '../../backend/src/routes/resources/operational-reports.js',
          import.meta.url
        ),
        'utf8'
      )
    ]);

  assert.match(page, /programacao-manutencao/);
  assert.match(page, /data-operational-schedule-tab/);
  assert.match(page, /listMaintenanceSchedule/);
  assert.match(board, /operational-schedule-table/);
  assert.match(board, /operational-schedule-cards/);
  assert.match(board, /item\.status === 'OVERDUE'/);
  assert.match(config, /Intervalo preventivo \(dias\)/);
  assert.match(config, /maintenanceCategoryIntervalFormSchema/);
  assert.match(api, /MaintenanceScheduleStatus/);
  assert.ok(schema.maintenanceCategoryIntervalFormSchema);
  assert.equal(
    schema.maintenanceCategoryIntervalFormSchema.safeParse({
      maintenanceIntervalDays: '30'
    }).success,
    true
  );
  assert.equal(
    schema.maintenanceCategoryIntervalFormSchema.safeParse({
      maintenanceIntervalDays: '0'
    }).success,
    false
  );
  assert.match(
    styles,
    /\.operational-module-tabs\s*\{[^}]*top:\s*0;/s
  );
  assert.match(
    styles,
    /@media \(max-width: 720px\)[\s\S]*?\.operational-schedule-table\s*\{[^}]*display:\s*none/s
  );
  assert.match(
    styles,
    /\.operational-schedule-table \.operational-schedule-status \+ \.form-hint\s*\{[^}]*margin-top:\s*6px/s
  );
  assert.match(
    backendRoute,
    /\/maintenance\/schedule[\s\S]*?status:\s*"APPROVED"/
  );
});

test('campos obrigatórios operacionais exibem asterisco vermelho', async () => {
  const [form, shared] = await Promise.all([
    readFile(
      new URL(
        '../src/pages/collaborator/OperationalReportFormPage.tsx',
        import.meta.url
      ),
      'utf8'
    ),
    readFile(
      new URL('../src/components/reports/ReportCoreFields.tsx', import.meta.url),
      'utf8'
    )
  ]);

  for (const label of [
    'Categoria do equipamento',
    'Equipamento',
    'Serviços realizados',
    'Data',
    'Local',
    'Serviço',
    'Descrição',
    'Material',
    'Qual material?',
    'Quantidade (kg)'
  ]) {
    assert.match(form, new RegExp(`${label.replace(/[?()]/g, '\\$&')}<RequiredMark \\/>`));
  }
  assert.match(shared, /Equipe diurna\{requiredMark\(required\)\}/);
  assert.match(shared, /Intervalo noturno\{requiredMark\(true\)\}/);
  assert.match(shared, /Equipe noturna\{requiredMark\(true\)\}/);
  assert.match(shared, /color: 'var\(--rd\)'/);
  assert.match(form, /<ReportActivitiesCard[\s\S]*?required[\s\S]*?\/>/);
});
