import assert from 'node:assert/strict';
import test from 'node:test';
import { Children, createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

function findSelect(node, field) {
  if (!isValidElement(node)) return undefined;
  if (node.type === 'select' && node.props.id.endsWith(`-${field}`)) return node;
  return Children.toArray(node.props.children).map(child => findSelect(child, field)).find(Boolean);
}

test('inibição acompanha a embarcação nas opções, na troca de seleção e no relatório salvo', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    esbuild: { jsx: 'automatic' }, server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { ServiceFields } = await server.ssrLoadModule('/src/components/reports/ServiceFields.tsx');
    const { buildReportServicePayload } = await server.ssrLoadModule('/src/utils/reportServicePayload.ts');
    const { inhibitionSystemValue } = await server.ssrLoadModule('/src/api/inhibitionOptions.ts');
    const system = { id: 'freshwater', code: '53100', description: 'FRESHWATER GENERATION SYSTEM', diagram: '00051632-53100-K-0010' };
    const original = '53100;FRESHWATER GENERATION SYSTEM;00051632-53100-K-0010';
    let data = { equipmentId: '51632', system: original };
    const props = { serviceType: 'inibicao', units: [], manometers: [], groupKey: 'inhibition', hideUploads: true,
      inhibitionOptions: { vessels: ['51632', '51633', '51634'].map(code => ({ id: code, code })), systems: [system] },
      onChange: patch => { data = { ...data, ...patch }; } };
    const form = () => ServiceFields({ ...props, data });

    for (const vesselCode of ['51632', '51633', '51634']) {
      // Existing drafts may still contain the catalog's original diagram.
      data = { equipmentId: vesselCode, system: original };
      const expected = `53100;FRESHWATER GENERATION SYSTEM;000${vesselCode}-53100-K-0010`;
      const html = renderToStaticMarkup(createElement(ServiceFields, { ...props, data }));
      assert.ok(html.includes(`<option value="${expected}" selected="">${expected}</option>`));
      assert.equal(findSelect(form(), 'system').props.value, expected);
      assert.equal(inhibitionSystemValue(system, vesselCode), expected);
      const payload = buildReportServicePayload({ type: 'inibicao', data });
      assert.equal(payload.system, expected);
      assert.equal(payload.extraData.system, expected);
      assert.equal(payload.extraData.Sistema, expected);
      assert.equal(payload.extraData['ID da embarcação'], vesselCode);
      assert.equal(data.system, original);
    }

    for (const vesselCode of ['51633', '51634', '51632']) {
      findSelect(form(), 'equipmentId').props.onChange({ target: { value: vesselCode } });
      assert.equal(data.equipmentId, vesselCode);
      assert.equal(data.system, `53100;FRESHWATER GENERATION SYSTEM;000${vesselCode}-53100-K-0010`);
    }
    data = { equipmentId: '', system: '' };
    findSelect(form(), 'equipmentId').props.onChange({ target: { value: '51633' } });
    assert.equal(data.system, '');
    const selected = inhibitionSystemValue(system, '51633');
    findSelect(form(), 'system').props.onChange({ target: { value: selected } });
    assert.equal(buildReportServicePayload({ type: 'inibicao', data }).system, selected);
    assert.equal(inhibitionSystemValue(system), original);
    assert.equal(inhibitionSystemValue({ ...system, diagram: '0051632-53100-K-0010' }, '51633'),
      '53100;FRESHWATER GENERATION SYSTEM;0051633-53100-K-0010');
    assert.equal(inhibitionSystemValue({ ...system, diagram: 'SEM-DIAGRAMA' }, '51633'),
      '53100;FRESHWATER GENERATION SYSTEM;SEM-DIAGRAMA');
    assert.equal(system.diagram, '00051632-53100-K-0010');
    assert.equal(buildReportServicePayload({ type: 'limpeza', data: { equipmentId: '51633', system: original } }).system, original);

    for (const diagram of [
      '00051632-53100-K-0010 / 00051632-53100-K-0020',
      'P&ID: 0051632_53100 / TAG-51632-53100 (51632)',
      'REF-51632;00051632-53100-K-0010;00051632-53100-K-0020',
      '00051632-53100-K-0010\n51632-53100-K-0020\n51632'
    ]) {
      const compoundSystem = { ...system, diagram };
      const compoundOriginal = `53100;FRESHWATER GENERATION SYSTEM;${diagram}`;
      props.inhibitionOptions.systems = [compoundSystem];
      data = { equipmentId: '51632', system: compoundOriginal };

      for (const vesselCode of ['51633', '51634', '51632', '51633']) {
        const expected = `53100;FRESHWATER GENERATION SYSTEM;${diagram.replaceAll('51632', vesselCode)}`;
        findSelect(form(), 'equipmentId').props.onChange({ target: { value: vesselCode } });
        assert.equal(data.system, expected, `Troca de embarcação: ${diagram}`);
        assert.equal(inhibitionSystemValue(compoundSystem, vesselCode), expected);
        const options = Children.toArray(findSelect(form(), 'system').props.children);
        assert.ok(options.some(option => option.props.value === expected && option.props.children === expected));
        for (const draft of [
          data,
          { equipmentId: vesselCode, system: compoundOriginal },
          { equipmentId: vesselCode, system: compoundOriginal.replace('51632', vesselCode) }
        ]) {
          const payload = buildReportServicePayload({ type: 'inibicao', data: draft });
          assert.equal(payload.system, expected);
          assert.equal(payload.extraData.system, expected);
          assert.equal(payload.extraData.Sistema, expected);
        }
      }
    }
  } finally {
    await server.close();
  }
});
