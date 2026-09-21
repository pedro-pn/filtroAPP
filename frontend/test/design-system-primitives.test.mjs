import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('design system barrel exposes every Phase 2 primitive', () => {
  const barrel = source('src/components/ui/ds/index.ts');
  const exports = [
    'Alert',
    'Badge',
    'StatusPill',
    'Button',
    'IconButton',
    'Card',
    'EmptyState',
    'Field',
    'Input',
    'MetricCard',
    'Select',
    'Skeleton',
    'Spinner',
    'Textarea',
    'statusToTone'
  ];

  for (const component of exports) {
    assert.match(barrel, new RegExp(`\\b${component}\\b`));
  }
});

test('primitive CSS stays scoped and consumes tokens instead of literal colors', () => {
  const primitiveCss = source('src/components/ui/ds/styles.css');
  const modalCss = source('src/components/ui/ds/modal.css');
  const css = `${primitiveCss}\n${modalCss}`;

  assert.match(css, /:where\(\.fv-ds, \[data-fv-ds\]\)/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(css, /\brgba?\(/i);
  assert.doesNotMatch(css, /!important/);
  assert.doesNotMatch(css, /@(media|container)[^{]*(430|560|640|860)px/);
});

test('compound fields expose one rounded focus ring owned by the control shell', () => {
  const css = source('src/components/ui/ds/styles.css');

  assert.match(
    css,
    /\.fv-control-shell:focus-within\s*\{[\s\S]*outline:\s*var\(--focus-ring-width\) solid var\(--focus-ring\)/
  );
  assert.match(
    css,
    /\.fv-control-shell\s+:where\(\.fv-input, \.fv-select\):focus-visible\s*\{[\s\S]*outline:\s*0/
  );
  assert.match(
    css,
    /\.fv-control-shell\[data-readonly='true'\]\s*\{\s*background:\s*var\(--surface\);\s*\}/
  );
});

test('card action rows stay on one line without localized horizontal scroll', () => {
  const primitiveCss = source('src/components/ui/ds/styles.css');
  const listingCss = source('src/components/ui/ds/listings/listings.css');
  const cardActions = primitiveCss.match(/\.fv-card__actions\s*\{[\s\S]*?\}/)?.[0] || '';
  const cardFooter = primitiveCss.match(/\.fv-card__footer\s*\{[\s\S]*?\}/)?.[0] || '';
  const mobileActions = listingCss.match(/\.fv-mobile-list__actions\s*\{[\s\S]*?\}/)?.[0] || '';

  assert.match(cardActions, /flex-wrap:\s*nowrap/);
  assert.match(cardFooter, /flex-wrap:\s*nowrap/);
  assert.match(mobileActions, /flex-wrap:\s*nowrap/);
  assert.doesNotMatch(cardActions, /overflow-x:\s*auto/);
  assert.doesNotMatch(cardFooter, /overflow-x:\s*auto/);
  assert.doesNotMatch(mobileActions, /overflow-x:\s*auto/);
});

test('status map covers canonical Portuguese workflow states', () => {
  const statusSource = source('src/components/ui/ds/status.ts');
  const expectedStatuses = [
    'aprovado',
    'pendente',
    'rejeitado',
    'revisao',
    'assinado',
    'expirado',
    'em andamento',
    'cancelado'
  ];

  for (const status of expectedStatuses) {
    assert.match(statusSource, new RegExp(`['"]?${status}['"]?\\s*:`));
  }
});

test('Modal keeps legacy appearance by default while providing DS behavior', () => {
  const modal = source('src/components/ui/Modal.tsx');

  assert.match(modal, /appearance = 'legacy'/);
  assert.match(modal, /appearance === 'design-system'/);
  assert.match(modal, /createPortal\(/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /lockBodyScroll\(\)/);
  assert.match(modal, /previousFocus\.focus\(\)/);
  assert.ok(modal.includes(`event.target.closest('[role="dialog"], [role="alertdialog"]') !== event.currentTarget`),
    'A parent dialog must ignore keyboard events from nested portals');
});

test('visual catalog is a separate Vite entry and does not add an app route', () => {
  const html = source('design-system.html');
  const entry = source('src/dev/design-system-main.tsx');

  assert.match(html, /src="\/src\/dev\/design-system-main\.tsx"/);
  assert.match(html, /noindex,nofollow/);
  assert.match(entry, /<DesignSystemPage \/>/);
  assert.doesNotMatch(entry, /BrowserRouter|Routes|Route/);
});
