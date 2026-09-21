import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { withRdoCompanions } from './rdo-source.mjs';

const source = (path) =>
  withRdoCompanions(path, candidate => readFileSync(new URL(`../${candidate}`, import.meta.url), 'utf8'));

const expectedAppearance = (() => {
  const value = process.env.RDO_B10_EXPECT_APPEARANCE ?? 'design-system';
  if (value === 'legacy' || value === 'design-system') return value;
  throw new Error(`RDO_B10_EXPECT_APPEARANCE inválido: ${value}`);
})();

function sectionBetween(contents, start, end) {
  const startIndex = contents.indexOf(start);
  const endIndex = contents.indexOf(end, startIndex);

  assert.notEqual(startIndex, -1, `Seção inicial ausente: ${start}`);
  assert.notEqual(endIndex, -1, `Seção final ausente: ${end}`);

  return contents.slice(startIndex, endIndex);
}

function archiveDialogSource(manager) {
  return sectionBetween(
    manager,
    '<Modal\n        open={Boolean(archiveSurveyProject)}',
    '<Modal open={showSurveyQuestionEditor}'
  );
}

test('B.10 preserva abertura, ramo direto, mutations, payloads e toasts', () => {
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const applyHandler = sectionBetween(
    manager,
    'async function applyProjectArchiveChange',
    'async function handleProjectToggleArchive'
  );
  const openHandler = sectionBetween(
    manager,
    'async function handleProjectToggleArchive',
    'async function handleArchiveSurveyChoice'
  );
  const choiceHandler = sectionBetween(
    manager,
    'async function handleArchiveSurveyChoice',
    'async function handleSendSurvey'
  );

  assert.match(
    manager,
    /const \[archiveSurveyProject, setArchiveSurveyProject\] = useState<Project \| null>\(null\)/
  );
  assert.match(
    openHandler,
    /if \(project\.isActive && project\.clientEmailPrimary\) \{\s*setArchiveSurveyProject\(project\);\s*return;\s*\}/
  );
  assert.match(
    openHandler,
    /await applyProjectArchiveChange\(project, false\)/
  );
  const dialogOpeningBranch = sectionBetween(
    openHandler,
    'if (project.isActive && project.clientEmailPrimary)',
    'await applyProjectArchiveChange(project, false)'
  );
  assert.doesNotMatch(
    dialogOpeningBranch,
    /mutate(?:Async)?|fetch\(|axios|apiClient/
  );

  assert.match(
    applyHandler,
    /await projectMutations\.updateProject\.mutateAsync\(\{\s*id: project\.id,\s*payload: \{ isActive: !project\.isActive \}\s*\}\)/
  );
  assert.match(
    applyHandler,
    /if \(sendSurvey\) \{\s*await surveyMutations\.sendProjectSurvey\.mutateAsync\(project\.id\)/
  );
  for (const message of [
    'Projeto arquivado e pesquisa enviada ao cliente.',
    'Projeto arquivado. Cadastre o e-mail principal do cliente para enviar pesquisa.',
    'Projeto arquivado.',
    'Projeto desarquivado.',
    'Não foi possível atualizar o projeto.'
  ]) {
    assert.match(applyHandler, new RegExp(message.replace(/[.]/g, '\\$&')));
  }

  assert.match(choiceHandler, /const project = archiveSurveyProject/);
  assert.match(choiceHandler, /if \(!project\) return/);
  assert.match(choiceHandler, /setArchiveSurveyProject\(null\)/);
  assert.match(
    choiceHandler,
    /await applyProjectArchiveChange\(project, sendSurvey\)/
  );
});

test('B.10 preserva conteúdo, ARIA, fechamento, handlers e pending', () => {
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const dialog = archiveDialogSource(manager);
  const normalizedDialog = dialog.replace(/\s+/g, ' ');
  const pending =
    /disabled=\{\s*projectMutations\.updateProject\.isPending \|\|\s*surveyMutations\.sendProjectSurvey\.isPending\s*\}/g;

  assert.match(dialog, /open=\{Boolean\(archiveSurveyProject\)\}/);
  assert.match(dialog, /onClose=\{\(\) => setArchiveSurveyProject\(null\)\}/);
  assert.match(dialog, /ariaLabelledBy="archive-survey-title"/);
  assert.match(dialog, /ariaDescribedBy="archive-survey-description"/);
  assert.match(dialog, /archive-survey-title/);
  assert.match(dialog, /archive-survey-description/);
  for (const text of [
    'Arquivar projeto',
    'Deseja arquivar o projeto e enviar a pesquisa de satisfação ao cliente?',
    'Cancelar',
    'Arquivar sem enviar',
    'Enviar pesquisa'
  ]) {
    assert.match(normalizedDialog, new RegExp(text.replace(/[?]/g, '\\$&')));
  }

  assert.match(
    dialog,
    /onClick=\{\(\) => setArchiveSurveyProject\(null\)\}[\s\S]*?Cancelar/
  );
  assert.match(
    dialog,
    /onClick=\{\(\) => void handleArchiveSurveyChoice\(false\)\}[\s\S]*?Arquivar sem enviar/
  );
  assert.match(
    dialog,
    /onClick=\{\(\) => void handleArchiveSurveyChoice\(true\)\}[\s\S]*?Enviar pesquisa/
  );
  assert.equal(
    dialog.match(pending)?.length,
    3,
    'os três botões devem compartilhar exatamente o pending existente'
  );
  assert.doesNotMatch(dialog, /mutate(?:Async)?|fetch\(|axios|apiClient/);
});

test('B.10 restringe o Modal DS a esta instância e preserva defaults globais', () => {
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const dialog = archiveDialogSource(manager);
  const modal = source('src/components/ui/Modal.tsx');
  const coordinator = source('src/pages/coordinator/CoordinatorPage.tsx');

  assert.match(
    modal,
    /export type ModalAppearance = 'legacy' \| 'design-system'/
  );
  assert.match(modal, /appearance = 'legacy'/);
  assert.doesNotMatch(coordinator, /archive-survey|archiveSurveyProject/);

  if (expectedAppearance === 'legacy') {
    assert.doesNotMatch(dialog, /appearance="design-system"/);
    assert.match(dialog, /className="section-title"/);
    assert.match(dialog, /className="admin-form-actions"/);
    return;
  }

  assert.match(dialog, /appearance="design-system"/);
  assert.match(dialog, /size="sm"/);
  assert.match(
    dialog,
    /backdropClassName="rdo-manager-archive-project-dialog-backdrop"/
  );
  assert.match(
    dialog,
    /panelClassName="rdo-manager-archive-project-dialog rdo-ds-actions"/
  );
  assert.match(dialog, /fullscreenOnMobile=\{false\}/);
  assert.match(
    dialog,
    /title=\{[\s\S]*?<h2[\s\S]*?Arquivar projeto[\s\S]*?<\/h2>[\s\S]*?\}/
  );
  assert.match(dialog, /initialFocusRef=\{archiveSurveyCancelRef\}/);
  assert.doesNotMatch(dialog, /section-title|admin-form-actions|mini-btn/);

  const optedInArchiveDialogs = [
    ...manager.matchAll(
      /<Modal\n\s*open=\{Boolean\(archiveSurveyProject\)\}[\s\S]*?<\/Modal>/g
    )
  ].filter((match) => /appearance="design-system"/.test(match[0]));
  assert.equal(optedInArchiveDialogs.length, 1);
});

test('B.10 mantém a hierarquia de botões e o CSS local tokenizado', () => {
  if (expectedAppearance === 'legacy') return;

  const manager = source('src/pages/gestor/GestorPage.tsx');
  const dialog = archiveDialogSource(manager);
  const css = source('src/pages/gestor/GestorPage.ds.css');
  const cssStart = css.indexOf('RDO B.10');

  assert.match(
    dialog,
    /<Button[\s\S]{0,220}?variant="secondary"[\s\S]{0,220}?size="sm"[\s\S]{0,420}?>\s*Cancelar/
  );
  assert.match(
    dialog,
    /<Button[\s\S]{0,220}?variant="danger"[\s\S]{0,220}?size="sm"[\s\S]{0,420}?>\s*Arquivar sem enviar/
  );
  assert.match(
    dialog,
    /<Button[\s\S]{0,220}?variant="primary"[\s\S]{0,220}?size="sm"[\s\S]{0,420}?>\s*Enviar pesquisa/
  );
  assert.doesNotMatch(dialog, /size="lg"/);

  assert.ok(cssStart >= 0, 'bloco CSS B.10 ausente');
  const block = css.slice(cssStart);
  assert.match(block, /\.rdo-manager-archive-project-dialog/);
  assert.match(block, /:where\(\.fv-ds, \[data-fv-ds\]\)/);
  assert.match(block, /var\(--/);
  assert.doesNotMatch(block, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(block, /\brgba?\(/i);
  assert.doesNotMatch(block, /!important/);
  assert.match(block, /flex-wrap:\s*nowrap/);
  assert.match(
    block,
    /@media \(max-width: 768px\)[\s\S]*?\.rdo-manager-archive-project-dialog-backdrop\s*\{[\s\S]*?align-items:\s*center[\s\S]*?padding:\s*var\(--space-4\)/
  );
  assert.match(
    block,
    /\.rdo-manager-archive-project-dialog\s*\{[\s\S]*?height:\s*auto[\s\S]*?max-height:\s*calc\(100dvh - var\(--space-8\)\)[\s\S]*?border-radius:\s*var\(--radius-lg\)/
  );
});

test('B.10 não altera primitives, API nem infraestrutura compartilhada', () => {
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const dialog = archiveDialogSource(manager);
  const projectMutations = source('src/hooks/useProjects.ts');
  const surveyMutations = source('src/hooks/useSurveys.ts');

  assert.doesNotMatch(dialog, /https?:\/\/|\/api\/|rdoApiPath/);
  assert.doesNotMatch(dialog, /download|upload|FileReader|Blob/);
  assert.match(manager, /from '\.\.\/\.\.\/components\/ui\/ds'/);
  assert.match(manager, /from '\.\.\/\.\.\/components\/ui\/Modal'/);
  assert.match(manager, /styles\/rdo-ds-actions\.css/);

  assert.match(
    projectMutations,
    /mutationFn: \(\{ id, payload \}: \{ id: string; payload: Partial<ProjectPayload> \}\) => updateProject\(id, payload\)/
  );
  for (const queryKey of [
    "['projects']",
    "['bootstrap']",
    "['reports']",
    "['statsOverview']",
    "['projectStats']"
  ]) {
    assert.match(
      projectMutations,
      new RegExp(`invalidateQueries\\(\\{ queryKey: \\${queryKey} \\}\\)`)
    );
  }
  assert.match(
    surveyMutations,
    /mutationFn: \(projectId: string\) => sendProjectSurvey\(projectId\)/
  );
  assert.match(surveyMutations, /onSuccess: invalidateSurveys/);
  assert.match(
    surveyMutations,
    /invalidateQueries\(\{ queryKey: \['bootstrap'\] \}\)/
  );
});
