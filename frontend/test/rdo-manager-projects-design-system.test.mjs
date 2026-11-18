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

test('Projetos em desktop compartilha a grade sem misturar a composição interna de Arquivados', () => {
  const css = source('src/pages/gestor/GestorPage.ds.css');
  const grid = sectionBetween(css, '/* Desktop: the existing project card', '/* Archived tiles retain');
  assert.match(grid, /@media \(min-width: 1024px\)/);
  assert.match(grid, /\.rdo-manager-projects__list,/);
  assert.match(grid, /\.rdo-manager-projects__loading/);
  assert.match(grid, /repeat\(auto-fill, minmax\(min\(100%, 26rem\), 1fr\)\)/);
  assert.match(grid, /align-items: start/);
  assert.match(grid, /container: rdo-project-tile \/ inline-size/);
  assert.match(grid, /@container rdo-project-tile \(max-width: 40rem\)/);
  assert.match(grid, /\[data-project-editing='true'\][\s\S]*?grid-column: 1 \/ -1/);
  assert.match(grid, /\.rdo-active-project-card__summary[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(grid, /\.rdo-active-project-card__details-grid[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(grid, /\.rdo-project-action-label--compact/);
  assert.match(grid, /\.rdo-archived-projects__list,/);
  assert.doesNotMatch(grid, /\.rdo-project-card--archived|grid-auto-flow:\s*(?:dense|column)|overflow:\s*(?:hidden|scroll|auto)/);
  assert.match(source('src/pages/gestor/GestorPage.shared.tsx'), /data-project-editing=\{Boolean\(options\.editing\)\}/);
});

test('Projetos migra a superfície principal com opt-in explícito no DS', () => {
  const page = source('src/pages/gestor/GestorPage.tsx');
  const projectsTab = sectionBetween(
    page,
    'function renderProjectsTab',
    'function renderArchivedProjectsTab'
  );
  const search = sectionBetween(
    page,
    'function renderGestorSearch',
    'function renderEstatisticasTab'
  );
  const projectMetrics = sectionBetween(
    page,
    'function renderProjectMetrics',
    'function renderAdminMetrics'
  );

  assert.match(page, /const projectsTab = tab === 'projetos'/);
  assert.match(page, /'rdo-manager-projects-page'/);
  assert.match(
    page,
    /title="Projetos"[\s\S]*?description="Gerencie os projetos ativos, acompanhe cadastros pendentes e revise suas informações\."/
  );
  assert.match(page, />\s*Novo projeto\s*<\/Button>/);
  assert.match(page, /function renderProjectMetrics\(\)/);
  assert.match(page, /label="Projetos ativos"/);
  assert.match(page, /label="Aguardando revisão"/);
  assert.doesNotMatch(projectMetrics, /label="Com responsável"/);
  assert.doesNotMatch(projectMetrics, /label="Escala estendida"/);

  assert.match(projectsTab, /id="rdo-manager-project-results"/);
  assert.match(projectsTab, /className="rdo-manager-projects rdo-ds-actions"/);
  assert.match(projectsTab, /aria-label="Lista de projetos ativos"/);
  assert.match(projectsTab, /appearance: 'design-system'/);
  assert.match(projectsTab, /<Badge\b/);
  assert.match(projectsTab, /<Button\b/);
  assert.match(projectsTab, /<Card\b/);
  assert.match(projectsTab, /<Skeleton\b/);
  assert.match(projectsTab, /<EmptyState\b/);
  assert.doesNotMatch(
    projectsTab,
    /<section className="page-card project-admin-panel"/
  );

  assert.match(
    search,
    /reportListingTab \|\| projectsTab \|\| archivedProjectsTab \|\| adminTab/
  );
  assert.match(search, /'rdo-manager-project-results'/);
  assert.match(search, /'Busca dos projetos ativos'/);
  assert.match(search, /<FilterBar[\s\S]*?<SearchInput/);
  assert.match(
    search,
    /reportListingTab \|\| projectsTab \|\| archivedProjectsTab/
  );
});

test('diálogo de equipe permanece uma caixa compacta no mobile', () => {
  const page = source('src/pages/gestor/GestorPage.tsx');
  const pageCss = source('src/pages/gestor/GestorPage.ds.css');

  assert.match(
    page,
    /backdropClassName="rdo-manager-project-team-dialog-backdrop"[\s\S]*?panelClassName="rdo-manager-project-team-dialog rdo-ds-actions"[\s\S]*?fullscreenOnMobile=\{false\}/
  );
  assert.match(
    pageCss,
    /@media \(max-width: 768px\)[\s\S]*?\.rdo-manager-project-team-dialog-backdrop\s*\{[\s\S]*?align-items:\s*center[\s\S]*?padding:\s*var\(--space-4\)/
  );
  assert.match(
    pageCss,
    /\.rdo-manager-project-team-dialog\s*\{[\s\S]*?height:\s*auto[\s\S]*?max-height:\s*calc\(100dvh - var\(--space-16\)\)[\s\S]*?border-radius:\s*var\(--radius-lg\)/
  );
  assert.match(
    page,
    /id="project-team-dialog-title"[\s\S]*?<Button[\s\S]*?variant="secondary"[\s\S]*?size="sm"[\s\S]*?Cancelar[\s\S]*?<Button[\s\S]*?variant="primary"[\s\S]*?size="sm"[\s\S]*?Salvar equipe/
  );
  assert.match(
    pageCss,
    /\.rdo-manager-project-team-dialog[\s\S]*?\.fv-modal__title\s*\{[\s\S]*?font-size:\s*var\(--text-base\)/
  );
  assert.match(
    pageCss,
    /\.rdo-manager-project-team-dialog[\s\S]*?:where\(\.fv-modal__body, \.fv-modal__footer\)[\s\S]*?\.fv-button\s*\{[\s\S]*?min-height:\s*calc\(var\(--space-8\) \+ var\(--space-1\)\)[\s\S]*?--fv-button-padding:\s*var\(--space-2\)/
  );
  assert.match(
    pageCss,
    /\.rdo-manager-project-team-dialog__form[\s\S]*?\.fv-select-shell\s*\{[\s\S]*?height:\s*calc\(var\(--space-8\) \+ var\(--space-1\)\)[\s\S]*?--fv-control-padding:\s*var\(--space-2\)/
  );
  assert.match(
    pageCss,
    /\.rdo-manager-project-team-dialog__form[\s\S]*?\.fv-select\s*\{[\s\S]*?font-size:\s*var\(--text-sm\)/
  );
});

test('Projetos preserva bootstrap, busca, ordenação e contratos CRUD', () => {
  const page = source('src/pages/gestor/GestorPage.tsx');
  const reportsHook = source('src/hooks/useReports.ts');
  const projectsTab = sectionBetween(
    page,
    'function renderProjectsTab',
    'function renderArchivedProjectsTab'
  );
  const submit = sectionBetween(
    page,
    'async function handleProjectSubmit',
    'async function handleSegmentSubmit'
  );
  const archive = sectionBetween(
    page,
    'async function applyProjectArchiveChange',
    'async function handleSendSurvey'
  );
  const remove = sectionBetween(
    page,
    'async function handleProjectRemove',
    'async function handleCollaboratorSubmit'
  );

  assert.match(page, /data: gestorBootstrapQuery\.data\?\.activeProjects/);
  assert.match(
    projectsTab,
    /partitionProjectsByRegistration\(allActiveProjects\)/
  );
  assert.match(
    projectsTab,
    /matchesSearch\(projectSearchParts\(project\), gestorSearch\)/
  );
  assert.match(
    projectsTab,
    /sortProjects\(pendingRegistrationProjects, projectSortDir\)/
  );
  assert.match(projectsTab, /sortProjects\(activeProjects, projectSortDir\)/);
  assert.match(page, /useBatchedReportCounts\(/);
  assert.match(reportsHook, /queries\.slice\(index \* 8, index \* 8 \+ 8\)/);
  assert.match(
    reportsHook,
    /Promise\.all\(batches\.map\(batch => fetchReportCounts\(batch\)\)\)/
  );
  assert.match(projectsTab, /onToggleArchive: handleProjectToggleArchive/);
  assert.match(projectsTab, /onRemove: setRemoveProjectTarget/);
  assert.match(projectsTab, /onToggleDetails: toggleProjectDetails/);
  assert.match(projectsTab, /segments: projectSegmentsQuery\.data/);

  assert.match(submit, /event\.preventDefault\(\)/);
  assert.match(submit, /projectMutations\.updateProject\.mutateAsync/);
  assert.match(
    submit,
    /projectMutations\.createProject\.mutateAsync\(payload\)/
  );
  assert.match(submit, /resetProjectForm\(\)/);
  assert.match(archive, /payload: \{ isActive: !project\.isActive \}/);
  assert.match(
    remove,
    /projectMutations\.removeProject\.mutateAsync\(project\.id\)/
  );
});

test('Projetos reaproveita o card DS e mantém formulários e revisões isolados', () => {
  const page = source('src/pages/gestor/GestorPage.tsx');
  const pendingReview = source('src/pages/gestor/PendingProjectReviewForm.tsx');
  const revisionPicker = source(
    'src/components/projects/ProjectRevisionPicker.tsx'
  );
  const projectCard = sectionBetween(
    page,
    'function renderProjectCard',
    'export function GestorPage'
  );
  const projectsTab = sectionBetween(
    page,
    'function renderProjectsTab',
    'function renderArchivedProjectsTab'
  );
  const headerActionsStart = projectCard.indexOf(
    'className="rdo-active-project-card__header-actions"'
  );
  const detailsDisclosureStart = projectCard.indexOf(
    'className="rdo-active-project-card__details-disclosure"'
  );
  const expandedContentStart = projectCard.indexOf(
    'className="rdo-archived-project-card__details rdo-active-project-card__expanded-content"'
  );
  const quickActionsStart = projectCard.indexOf(
    'className="rdo-active-project-card__detail-panel rdo-active-project-card__quick-actions"'
  );
  const detailsGridStart = projectCard.indexOf(
    'className="rdo-active-project-card__details-grid"'
  );

  assert.match(
    projectCard,
    /const activeProject = project\.isActive !== false/
  );
  assert.match(
    projectCard,
    /className=\{`rdo-project-card rdo-archived-project-card/
  );
  assert.match(
    projectCard,
    /data-active-project-id=\{activeProject \? project\.id : undefined\}/
  );
  assert.match(projectCard, /Projeto aguardando revisão/);
  assert.match(projectCard, /Projeto ativo/);
  assert.match(projectCard, /Projeto arquivado/);
  assert.match(projectCard, /label=\{stateLabel\}/);
  assert.match(projectCard, /className="rdo-project-card__overview"/);
  assert.match(projectCard, /className="rdo-active-project-card__summary"/);
  assert.match(projectCard, /rdo-active-project-card__details-grid/);
  assert.match(projectCard, /rdo-active-project-card__quick-actions/);
  assert.match(
    projectCard,
    /className="rdo-project-card__title-toggle"[\s\S]{0,360}?aria-expanded=\{options\.detailsExpanded\}[\s\S]{0,240}?onClick=\{\(\) => options\.onToggleDetails\(project\)\}/
  );
  assert.match(
    projectCard,
    /className="rdo-active-project-card__details-toggle"[\s\S]{0,520}?>\s*Detalhes\s*<\/Button>/
  );
  assert.ok(headerActionsStart >= 0);
  assert.ok(quickActionsStart > headerActionsStart);
  assert.ok(detailsDisclosureStart > quickActionsStart);
  assert.doesNotMatch(
    projectCard.slice(headerActionsStart, detailsDisclosureStart),
    /rdo-active-project-card__details-toggle/
  );
  assert.ok(expandedContentStart > detailsDisclosureStart);
  assert.ok(detailsGridStart > expandedContentStart);
  assert.match(projectCard, /rdo-project-action-label--compact/);
  assert.match(projectCard, /aria-label="Gerenciar equipe"/);
  assert.match(projectCard, /aria-label="Ver relatórios"/);
  assert.doesNotMatch(projectCard, /rdo-active-project-card__section-nav/);
  assert.doesNotMatch(projectCard, />Visão geral<\/a>/);
  assert.match(projectCard, /project\.authorizedUsers\?\.length/);
  assert.match(projectCard, /<dt>Relatórios<\/dt>/);
  assert.match(projectCard, /<dt>Relatórios vinculados<\/dt>/);
  assert.match(
    projectCard,
    /<dt>Exige assinatura em relatórios de serviço<\/dt>/
  );
  assert.match(projectCard, /options\.reportCount \?\? '—'/);
  assert.match(projectCard, /options\.editing[\s\S]*?'Fechar edição'/);
  assert.match(projectCard, />Gerenciar equipe<\/span>/);
  assert.match(projectCard, />Ver relatórios<\/span>/);
  assert.doesNotMatch(projectCard, />\s*Arquivar projeto\s*<\/Button>/);
  assert.doesNotMatch(projectCard, />\s*Excluir projeto\s*<\/Button>/);
  assert.match(projectCard, /\['Cliente', project\.clientName/);
  assert.match(projectCard, /\['Segmento', segmentLabel\]/);
  assert.match(projectCard, /: 'Sem categoria';/);
  assert.match(projectCard, /\['Responsável', project\.operator\?\.name/);
  assert.match(projectCard, /\['Atualização', formatDate\(/);
  assert.match(projectCard, /label="Arquivar"/);
  assert.match(projectCard, /label=\{`Restaurar projeto: \$\{title\}`\}/);
  assert.match(projectCard, /<dl>[\s\S]*?<dt>[\s\S]*?<dd>/);

  assert.match(projectsTab, /<PendingProjectReviewForm\b/);
  assert.match(
    projectsTab,
    /<form className="admin-inline-form admin-inline-grid rdo-project-edit-form"/
  );
  assert.match(projectsTab, /className="rdo-manager-projects__legacy-form"/);
  assert.match(projectsTab, /onEdit: toggleProjectEdit/);
  assert.match(projectsTab, /onManageTeam: openProjectTeamDialog/);
  assert.match(projectsTab, /onViewReports: handleViewProjectReports/);
  assert.match(
    projectsTab,
    /reportCount: activeProjectReportCountById\.get\(project\.id\)/
  );
  assert.match(projectCard, /<ProjectRevisionPicker projectId=\{project\.id\}/);
  assert.match(
    page,
    /const initiallyExpandedId =\s*sortProjects\(readyProjects, projectSortDir\)\[0\]\?\.id \|\|\s*activeProjects\[0\]\?\.id/
  );
  assert.match(page, /stored !== null && Array\.isArray\(parsed\)/);

  assert.match(
    projectsTab,
    /<Button variant="primary" size="md" type="submit" disabled=\{projectMutations\.updateProject\.isPending\}>\s*Salvar projeto\s*<\/Button>/
  );
  assert.match(
    projectsTab,
    /<Button variant="secondary" size="md" type="button" onClick=\{resetProjectForm\}>\s*Cancelar edição\s*<\/Button>/
  );
  assert.match(page, /async function handleProjectTeamSubmit/);
  assert.match(
    page,
    /payload: \{\s*operatorId: projectTeamForm\.operatorId \|\| null,\s*authorizedUserIds: projectTeamForm\.authorizedUserIds\s*\}/
  );
  assert.match(page, /function handleViewProjectReports/);
  assert.match(
    page,
    /setPersistentSearchValue\([\s\S]*?:aprovados`[\s\S]*?searchValue/
  );
  assert.equal(
    page.match(
      /<Button[\s\S]{0,240}?variant="primary"[\s\S]{0,240}?size="sm"[\s\S]{0,240}?type="button"[^>]*>[\s\S]{0,300}?\+ Adicionar[\s\S]{0,80}?<\/Button>/g
    )?.length,
    2
  );
  assert.equal(
    projectsTab.match(
      /<Button variant="secondary" size="sm" type="button" onClick=\{openSegmentForm\}>\s*\+ Adicionar segmento\s*<\/Button>/g
    )?.length,
    2
  );
  assert.match(
    projectsTab,
    /<Button variant="primary" type="submit" disabled=\{projectMutations\.createProject\.isPending\}>\s*Criar projeto\s*<\/Button>/
  );

  assert.doesNotMatch(revisionPicker, /mini-btn/);
  assert.match(revisionPicker, /project-revision-picker__select/);
  assert.match(revisionPicker, /project-revision-picker__button/);
  assert.match(
    revisionPicker,
    /<Button[\s\S]*?variant="primary"[\s\S]*?size="sm"[\s\S]*?mutation\.isPending[\s\S]*?Aplicar/
  );
  assert.match(
    revisionPicker,
    /<Button[\s\S]*?variant="secondary"[\s\S]*?size="sm"[\s\S]*?removeAdditionalMutation\.isPending[\s\S]*?Remover/
  );
  assert.doesNotMatch(pendingReview, /mini-btn/);
  assert.match(
    pendingReview,
    /<Button variant="primary" type="submit" disabled=\{saving\}>Confirmar e salvar<\/Button>/
  );
  assert.match(
    pendingReview,
    /<Button variant="secondary" size="sm" type="button" onClick=\{onCancel\}>Cancelar revisão<\/Button>/
  );
});

test('Projetos compartilha o layout de Arquivados com CSS escopado e responsivo', () => {
  const css = source('src/pages/gestor/GestorPage.ds.css');
  const cssStart = css.indexOf('Projetos arquivados');
  const cssEnd = css.indexOf('RDO B.11', cssStart);

  assert.ok(cssStart >= 0, 'bloco compartilhado de projetos ausente');
  assert.ok(cssEnd > cssStart, 'limite do bloco compartilhado ausente');
  const block = css.slice(cssStart, cssEnd);

  assert.match(
    block,
    /\.rdo-manager-projects-page,\s*:where\(\.fv-ds, \[data-fv-ds\]\)\.rdo-manager-archived-page/
  );
  assert.match(block, /\.rdo-manager-projects__filters/);
  assert.match(block, /\.rdo-project-card__overview/);
  const compactRevisionSelectIndex = block.indexOf(
    '.project-revision-picker__select'
  );
  const compactRevisionMediaIndex = block.lastIndexOf(
    '@media (max-width: 768px)',
    compactRevisionSelectIndex
  );
  assert.ok(compactRevisionSelectIndex >= 0, 'estilo compacto da revisão ausente');
  assert.ok(compactRevisionMediaIndex >= 0, 'estilo compacto da revisão fora do mobile');
  assert.doesNotMatch(
    block.slice(0, compactRevisionMediaIndex),
    /\.project-revision-picker__(?:select|button)/
  );
  assert.match(
    block.slice(compactRevisionMediaIndex),
    /\.project-revision-picker__select\s*\{[\s\S]*?height:\s*var\(--space-8\)[\s\S]*?font-size:\s*var\(--text-xs\)/
  );
  assert.match(
    block.slice(compactRevisionMediaIndex),
    /\.project-revision-picker__button\s*\{[\s\S]*?--fv-button-height:\s*var\(--space-8\)[\s\S]*?--fv-button-font-size:\s*var\(--text-xs\)/
  );
  assert.match(
    block.slice(compactRevisionMediaIndex),
    /\.project-revision-picker__actions\s*\{[\s\S]*?width:\s*100%[\s\S]*?max-width:\s*none/
  );
  assert.match(block, /\.rdo-manager-projects__pending/);
  assert.match(block, /\.rdo-active-project-card__identity/);
  assert.match(
    block,
    /\.rdo-active-project-card\s*> \.fv-card__header\s*> \.fv-card__actions\s*\{[\s\S]*?overflow: visible/
  );
  assert.match(block, /\.rdo-active-project-card__details-region/);
  assert.match(
    block,
    /\.rdo-active-project-card__details-disclosure\s*\{[\s\S]*?justify-content: flex-start/
  );
  assert.match(block, /\.rdo-active-project-card__quick-action-list/);
  assert.match(block, /\.rdo-project-card__title-toggle:focus-visible/);
  assert.match(block, /\.rdo-archived-project-card__reports-toggle/);
  assert.match(block, /\.rdo-manager-projects__legacy-form/);
  assert.match(block, /@media \(min-width: 768px\)/);
  assert.match(block, /@media \(max-width: 480px\)/);
  assert.match(block, /var\(--/);
  assert.doesNotMatch(block, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(block, /\brgba?\(/i);
  assert.doesNotMatch(block, /!important/);
});

test('Edição de projeto usa densidade compacta e ações em uma linha no mobile', () => {
  const css = source('src/pages/gestor/GestorPage.ds.css');
  const compactForm = sectionBetween(
    css,
    'A edição acontece dentro de um card que já possui padding.',
    ':where(.fv-ds, [data-fv-ds]) .rdo-archived-report-type'
  );

  assert.match(compactForm, /@media \(max-width: 768px\)/);
  assert.match(compactForm, /\.rdo-project-edit-form\s*\{/);
  assert.match(compactForm, /padding: var\(--space-2\)/);
  assert.match(compactForm, /min-height: calc\(var\(--space-8\) \+ 2px\)/);
  assert.match(compactForm, /\.admin-form-actions\s*\{[\s\S]*?flex-wrap: nowrap/);
  assert.match(compactForm, /\.admin-form-actions\s+\.fv-button\s*\{[\s\S]*?flex: 1 1 0/);
  assert.match(
    compactForm,
    /\.admin-inline-form\s*\{[\s\S]*?border-color: var\(--line\)[\s\S]*?background: var\(--surface-2\)[\s\S]*?color: var\(--ink\)/
  );
  assert.match(
    compactForm,
    /input:not\(\[type='checkbox'\]\), select, textarea\) \{[\s\S]*?background-color: var\(--surface\)[\s\S]*?color: var\(--ink\)/
  );
  assert.match(
    compactForm,
    /\.cc-list \{[\s\S]*?background: var\(--surface\)[\s\S]*?color: var\(--ink\)/
  );
  assert.match(
    compactForm,
    /\.project-sequence-field \{[\s\S]*?background: var\(--surface\)[\s\S]*?color: var\(--ink\)/
  );
  assert.match(
    compactForm,
    /\.tog-lbl \{[\s\S]*?color: var\(--ink\)/
  );
  assert.doesNotMatch(compactForm, /!important/);
});
