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

test('B.11 preserva abertura, limpeza e fechamento do formulário de segmento', () => {
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const openHandler = sectionBetween(
    manager,
    'function openSegmentForm',
    'function closeSegmentForm'
  );
  const closeHandler = sectionBetween(
    manager,
    'function closeSegmentForm',
    'function resetCollaboratorForm'
  );

  assert.match(openHandler, /setSegmentLabel\(''\)/);
  assert.match(openHandler, /setShowSegmentForm\(true\)/);
  assert.match(closeHandler, /setShowSegmentForm\(false\)/);
  assert.match(closeHandler, /setSegmentLabel\(''\)/);

  const launchers = [
    ...manager.matchAll(
      /<Button[\s\S]{0,180}?variant="secondary"[\s\S]{0,180}?size="sm"[\s\S]{0,180}?onClick=\{openSegmentForm\}[\s\S]{0,80}?>\s*\+ Adicionar segmento\s*<\/Button>/g
    )
  ];
  assert.equal(launchers.length, 2);
});

test('B.11 preserva slug, payload, ordem, seleção automática e toasts', () => {
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const slugHelper = sectionBetween(
    manager,
    'function segmentSlugFromLabel',
    'function projectToForm'
  );
  const submitHandler = sectionBetween(
    manager,
    'async function handleSegmentSubmit',
    'async function applyProjectArchiveChange'
  );

  assert.match(slugHelper, /\.trim\(\)/);
  assert.match(slugHelper, /\.toLowerCase\(\)/);
  assert.match(slugHelper, /\.normalize\('NFD'\)/);
  assert.match(slugHelper, /replace\(\/\[\\u0300-\\u036f\]\/g, ''\)/);
  assert.match(slugHelper, /replace\(\/\[\^a-z0-9\]\+\/g, '_'\)/);
  assert.match(slugHelper, /replace\(\/\^_\+\|_\+\$\/g, ''\)/);

  assert.match(submitHandler, /event\.preventDefault\(\)/);
  assert.match(submitHandler, /const label = segmentLabel\.trim\(\)/);
  assert.match(submitHandler, /const slug = segmentSlugFromLabel\(label\)/);
  assert.match(submitHandler, /if \(!label \|\| !slug\) return/);
  assert.match(
    submitHandler,
    /projectSegmentMutations\.createSegment\.mutateAsync\(\{\s*label,\s*slug,\s*isActive: true,\s*order: \(projectSegmentsQuery\.data \|\| \[\]\)\.length \+ 1\s*\}\)/
  );
  assert.match(
    submitHandler,
    /setProjectForm\(\(current\) => \(\{ \.\.\.current, clientSegment: created\.slug \}\)\)/
  );
  assert.match(
    submitHandler,
    /mutateAsync[\s\S]*?closeSegmentForm\(\);\s*showToast\('Segmento criado\.', 'success'\)/
  );
  assert.match(
    submitHandler,
    /showToast\(error instanceof Error \? error\.message : 'Não foi possível criar o segmento\.', 'error'\)/
  );
});

test('B.11 usa Modal, Field, Input e Button do DS sem botão Fechar', () => {
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const dialog = sectionBetween(
    manager,
    '<Modal\n        open={showSegmentForm}',
    '<Modal\n        open={Boolean(archiveSurveyProject)}'
  );

  assert.match(dialog, /appearance="design-system"/);
  assert.match(dialog, /size="sm"/);
  assert.match(
    dialog,
    /panelClassName="rdo-manager-segment-dialog rdo-ds-actions"/
  );
  assert.match(dialog, /ariaLabelledBy="client-segment-title"/);
  assert.match(dialog, /initialFocusRef=\{segmentLabelInputRef\}/);
  assert.match(dialog, /showCloseButton=\{false\}/);
  assert.match(dialog, /<h2[\s\S]*?>\s*Adicionar segmento\s*<\/h2>/);
  assert.doesNotMatch(dialog, />\s*Fechar\s*</);

  assert.match(dialog, /id="client-segment-form"/);
  assert.match(dialog, /onSubmit=\{handleSegmentSubmit\}/);
  assert.match(
    dialog,
    /<Field id="client-segment-label" label="Nome" required>/
  );
  assert.match(dialog, /<Input[\s\S]*?ref=\{segmentLabelInputRef\}/);
  assert.match(dialog, /value=\{segmentLabel\}/);
  assert.match(
    dialog,
    /onChange=\{\(event\) => setSegmentLabel\(event\.target\.value\)\}/
  );
  assert.match(dialog, /autoComplete="off"/);
  assert.match(dialog, /<Input[\s\S]*?required/);
  assert.doesNotMatch(dialog, /section-title|field-group|admin-form-actions/);
  assert.doesNotMatch(dialog, /primary-button|secondary-button|mini-btn/);

  assert.match(
    dialog,
    /<Button[\s\S]{0,220}?variant="secondary"[\s\S]{0,220}?size="sm"[\s\S]{0,420}?onClick=\{closeSegmentForm\}[\s\S]{0,80}?>\s*Cancelar/
  );
  assert.match(
    dialog,
    /<Button[\s\S]{0,220}?variant="primary"[\s\S]{0,220}?size="md"[\s\S]{0,220}?type="submit"[\s\S]{0,220}?form="client-segment-form"/
  );
  assert.match(
    dialog,
    /loading=\{projectSegmentMutations\.createSegment\.isPending\}/
  );
});

test('B.11 mantém query keys, invalidações e fronteira visual local', () => {
  const hook = source('src/hooks/useProjectStats.ts');
  const css = source('src/pages/gestor/GestorPage.ds.css');
  const cssStart = css.indexOf('RDO B.11');

  assert.match(hook, /queryKey: \['projectSegments'\]/);
  assert.match(
    hook,
    /mutationFn: \(payload: ClientSegmentPayload\) => createProjectSegment\(payload\)/
  );
  assert.match(
    hook,
    /invalidateQueries\(\{ queryKey: \['projectSegments'\] \}\)/
  );
  assert.match(hook, /invalidateQueries\(\{ queryKey: \['bootstrap'\] \}\)/);

  assert.ok(cssStart >= 0, 'bloco CSS B.11 ausente');
  const block = css.slice(cssStart);
  assert.match(block, /\.rdo-manager-segment-dialog/);
  assert.match(
    block,
    /\.rdo-manager-segment-dialog\s+\.fv-input:focus-visible\s*\{\s*outline: 0;/
  );
  assert.match(block, /:where\(\.fv-ds, \[data-fv-ds\]\)/);
  assert.match(block, /var\(--/);
  assert.doesNotMatch(block, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(block, /\brgba?\(/i);
  assert.doesNotMatch(block, /!important/);
});
