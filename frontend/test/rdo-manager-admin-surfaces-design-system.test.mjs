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

test('Equipe usa a hierarquia administrativa DS e preserva suas três subáreas', () => {
  const page = source('src/pages/gestor/GestorPage.tsx');
  const team = sectionBetween(
    page,
    'function renderEquipeTab',
    'function renderUsuariosTab'
  );

  assert.match(page, /title="Equipe"/);
  assert.match(
    page,
    /className="rdo-manager-metrics" aria-label="Resumo da equipe"/
  );
  assert.match(page, /label="Cargos cadastrados"/);
  assert.match(page, /label="Temas de DDS"/);
  assert.match(page, /label="Cadastros inativos"/);
  assert.match(team, /className="rdo-team-workspace"/);
  assert.match(team, /className="rdo-admin-tabs"/);
  assert.match(team, /aria-label="Seções da equipe"/);
  assert.match(team, /onKeyDown=\{handleHorizontalTabListKeyDown\}/);
  assert.match(team, />\s*Colaboradores\s*<\/button>/);
  assert.match(team, />\s*Cargos\s*<\/button>/);
  assert.match(team, />\s*Temas de DDS\s*<\/button>/);
  assert.match(team, /<JobRoleManager[\s\S]*?appearance="design-system"/);
  assert.match(team, /<DdsThemeManager[\s\S]*?appearance="design-system"/);
  assert.match(team, /searchValue=\{gestorSearch\}/);
  assert.match(team, /showCreateAction=\{false\}/);
  assert.match(team, /<DataTable\b/);
  assert.match(team, /className="rdo-team-collaborators__table"/);
  assert.match(
    team,
    /className="rdo-team-collaborators__table"[\s\S]*?mobileBreakpoint="xl"/
  );
  assert.match(team, /loading=\{collaboratorsQuery\.isLoading\}/);
  assert.match(team, /renderRowDetails=\{\(collaborator\) =>/);
  assert.match(team, /mobile=\{\{/);
  assert.match(team, /data-collaborator-form=\{mode\}/);
  assert.match(team, /aria-expanded=\{editing\}/);
  assert.match(team, /<EmptyState\b/);
  assert.doesNotMatch(team, /rdo-admin-person-card/);
  assert.doesNotMatch(team, /mini-btn|page-card|card admin-card/);
});

test('Usuários usa toolbar, listagem responsiva e formulários DS sem alterar contratos', () => {
  const page = source('src/pages/gestor/GestorPage.tsx');
  const toolbar = sectionBetween(
    page,
    'function renderUsersToolbar',
    'function renderUsuariosTab'
  );
  const users = sectionBetween(
    page,
    'function renderUsuariosTab',
    'function renderNpsTab'
  );

  assert.match(page, /title="Usuários"/);
  assert.match(page, /aria-label="Resumo dos usuários"/);
  assert.match(page, /label="Usuários ativos"/);
  assert.match(page, /label="Gestores"/);
  assert.match(page, /label="Contas inativas"/);
  assert.match(users, /className="rdo-admin-section rdo-users"/);
  assert.match(users, /aria-label="Tipo de usuário"/);
  assert.match(users, /<DataTable\b/);
  assert.match(users, /className="rdo-users__table"/);
  assert.match(
    users,
    /className="rdo-users__table"[\s\S]*?mobileBreakpoint="xl"/
  );
  assert.match(toolbar, /<FilterBar[\s\S]*?mobileBreakpoint="xl"/);
  assert.match(users, /rows=\{internalUsers\}/);
  assert.match(users, /renderRowDetails=\{\(item\) =>/);
  assert.doesNotMatch(page, /<Pagination\b/);
  assert.doesNotMatch(
    users,
    /userPage|userPageSize|visibleInternalUsers|currentInternalPage|internalTotalPages/
  );
  assert.match(users, /data-user-form=\{mode\}/);
  assert.match(users, /<Field\b/);
  assert.match(users, /<Input\b/);
  assert.match(users, /<Select\b/);
  assert.match(users, /<Card className="rdo-client-account-card"/);
  assert.match(users, /<StatusPill\b/);
  assert.match(users, /<Badge\b/);
  assert.match(users, /type="password"/);
  assert.match(users, /internalRoles\.map/);
  assert.match(users, /handleResendClientAccess/);
  assert.match(users, /handleUserDelete/);
  assert.match(users, /userMutations\.createUser\.isPending/);
  assert.match(users, /userMutations\.updateUser\.isPending/);
  assert.doesNotMatch(users, /rdo-admin-person-card/);
  assert.doesNotMatch(users, /mini-btn|page-card|card admin-card|status-pill/);
});

test('controles de colaboradores reutilizam Button e StatusPill do DS', () => {
  const controls = source(
    'src/components/projects/CollaboratorListControls.tsx'
  );

  assert.match(controls, /import \{ Button, StatusPill \} from '..\/ui\/ds'/);
  assert.match(controls, /<Button\s+variant="secondary"/);
  assert.match(controls, /<Button variant="primary"/);
  assert.match(controls, /<StatusPill/);
  assert.doesNotMatch(controls, /mini-btn|status-pill/);
});

test('CSS administrativo permanece escopado, tokenizado e responsivo', () => {
  const css = source('src/pages/gestor/GestorPage.ds.css');
  const start = css.indexOf('Equipe e usuários');
  const end = css.indexOf('RDO B.11', start);

  assert.ok(start >= 0);
  assert.ok(end > start);
  const block = css.slice(start, end);

  assert.match(block, /:where\(\.fv-ds, \[data-fv-ds\]\)/);
  assert.match(block, /\.rdo-manager-admin-page/);
  assert.match(block, /\.rdo-admin-tabs/);
  assert.match(block, /\.rdo-admin-person-card/);
  assert.match(block, /\.rdo-client-account-card/);
  assert.match(
    block,
    /\.rdo-admin-form[\s\S]*?\.fv-control-shell[\s\S]*?:where\(\.fv-input, \.fv-select\)\s*\{[\s\S]*?background:\s*transparent/
  );
  assert.match(block, /@media \(max-width: 480px\)/);
  assert.match(block, /var\(--/);
  assert.doesNotMatch(block, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(block, /\brgba?\(/i);
  assert.doesNotMatch(block, /!important/);
});
