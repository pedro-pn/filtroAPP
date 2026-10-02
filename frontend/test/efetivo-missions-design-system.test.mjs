import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = name => readFileSync(new URL(`../src/pages/efetivo/${name}`, import.meta.url), 'utf8');

test('programação usa o contrato compacto de formulário DS', () => {
  for (const [file,id] of [['MissionFormModal.tsx','mission-programming-form']]) {
    const source = read(`components/${file}`);
    assert.match(source, /appearance="design-system"/);
    assert.match(source, /fullscreenOnMobile=\{false\}/);
    assert.match(source, /closeOnEscape=\{!saving\}/);
    assert.ok(source.includes(`form="${id}"`));
    assert.ok(source.includes(`id="${id}"`));
    assert.match(source, /<Field/);
    assert.match(source, /<Input size="sm"/);
    assert.doesNotMatch(source, /components\/ui\/Button|className="efetivo-modal-layout"/);
  }
  const form = read('components/MissionFormModal.tsx');
  for (const contract of ['confirmedMissionOverlapCollaboratorIds','allocationPeriods','headquartersResponsibleUserId','returnDate: values.returnDate || null','<MissionTeamSelector']) assert.ok(form.includes(contract));
  const css = read('EfetivoMissions.ds.css');
  assert.match(css, /efetivo-mission-programming-dialog/);
});
