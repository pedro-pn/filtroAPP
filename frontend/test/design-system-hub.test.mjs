import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Hub content composes the approved Design System primitives', () => {
  const hub = source('src/pages/HubPage.tsx');
  const moduleCard = source('src/components/hub/HubModuleCard.tsx');

  assert.match(hub, /<PageHeader/);
  assert.match(hub, /<HubModuleCard/);
  assert.match(moduleCard, /<Card/);
  assert.match(moduleCard, /<Badge/);
  assert.match(moduleCard, /<AppIcon/);
  assert.match(moduleCard, /MODULE_NAVIGATION_ICONS/);
  assert.doesNotMatch(hub, /<svg|#[\da-f]{3,8}\b|rgba?\(/i);
});

test('Hub migration preserves navigation and campaign integration', () => {
  const hub = source('src/pages/HubPage.tsx');
  const moduleCard = source('src/components/hub/HubModuleCard.tsx');

  for (const preservedFeature of [
    'hubModulesForUser',
    'availableHubModulesForUser',
    'roleHomePath',
    'HubTutorial',
    'AcompanhamentoHubNovelty',
    'QualidadeHubNovelty',
    'markAcompanhamentoNoveltySeen',
    'markQualidadeNoveltySeen'
  ]) {
    assert.match(hub, new RegExp(`\\b${preservedFeature}\\b`));
  }

  assert.match(moduleCard, /data-hub-module-id/);
  assert.match(hub, /navigate\(path\)/);
});

test('Hub styles are scoped, tokenized and use the approved density breakpoints', () => {
  const css = source('src/pages/HubPage.css');

  assert.match(css, /\.hub-dashboard/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(css, /\brgba?\(/i);
  assert.doesNotMatch(css, /!important/);
  assert.doesNotMatch(css, /@(media|container)[^{]*(430|560|860)px/);
  for (const breakpoint of ['640px', '1024px', '1600px']) {
    assert.match(css, new RegExp(breakpoint));
  }
});

test('exclusive legacy Hub presentation rules were removed from base.css', () => {
  const legacyCss = source('src/styles/base.css');

  for (const removedSelector of [
    'hub-hero',
    'hub-avatar',
    'hub-divider',
    'hub-card-accent',
    'hub-module-card--wide'
  ]) {
    assert.doesNotMatch(legacyCss, new RegExp(`\\.${removedSelector}\\b`));
  }
});
