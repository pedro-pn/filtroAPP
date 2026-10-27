import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('formulário de estoque valida todos os itens e converte a máscara de reais', async t => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const model = await server.ssrLoadModule('/src/pages/estoque/stockMovementForm.ts');
    const values = { reason: 'COMPRA', movementType: 'ENTRADA', projectId: '', date: '2026-10-27', nfNumber: '123', supplier: 'Fornecedor', requestedBy: '', notes: '' };
    const items = [{ id: 'chemical', type: 'PRODUTO_QUIMICO' }, { id: 'filter', type: 'FILTRO' }];
    const chemical = { ...model.createMovementLine(), itemId: 'chemical', quantity: '1.25', lotNumber: 'LOTE-Q', expiryDate: '2099-01-01', unitCost: 'R$ 1.234,56' };
    const filter = { ...model.createMovementLine(), itemId: 'filter', quantity: '2' };
    await t.test('custo opcional, centavos, zero, separador de milhar e colagem', () => {
      for (const [input, formatted, parsed] of [['', '', undefined], ['1', 'R$ 0,01', 0.01], ['0', 'R$ 0,00', 0],
        ['123456', 'R$ 1.234,56', 1234.56], ['R$ 9.876,54', 'R$ 9.876,54', 9876.54]]) {
        assert.equal(model.formatUnitCost(input), formatted);
        assert.equal(model.parseUnitCost(formatted), parsed);
      }
    });
    await t.test('compra de vários produtos mantém campos de lote e custo por item', () => {
      const result = model.validateMovementLines(values, [chemical, filter], items);
      assert.deepEqual(result.lineErrors, {});
      assert.deepEqual(result.fieldErrors, {});
      assert.equal(result.payloads[0].unitCost, 1234.56);
      assert.equal(result.payloads[1].unitCost, undefined);
      assert.equal(result.payloads[0].lotNumber, 'LOTE-Q');
      assert.ok(result.payloads.every(row => row.nfNumber === '123' && row.supplier === 'Fornecedor'));
    });
    await t.test('informa erro na linha do filtro fracionado e do químico sem validade', () => {
      const result = model.validateMovementLines(values, [{ ...chemical, expiryDate: '' }, { ...filter, quantity: '1.5' }], items);
      assert.match(result.lineErrors[chemical.id], /validade/);
      assert.match(result.lineErrors[filter.id], /inteiras/);
      assert.deepEqual(result.fieldErrors, {});
      assert.ok(model.validateMovementLines({ ...values, nfNumber: '' }, [filter], items).fieldErrors.nfNumber);
    });
    await t.test('saída usa o lote de cada item e descarta campos de compra ocultos', () => {
      const result = model.validateMovementLines({ ...values, reason: 'USO_EM_PROJETO', projectId: 'project' },
        [{ ...chemical, batchId: 'batch-q' }, { ...filter, batchId: 'batch-f' }], items);
      assert.deepEqual(result.lineErrors, {});
      assert.deepEqual(result.payloads.map(row => row.batchId), ['batch-q', 'batch-f']);
      assert.ok(result.payloads.every(row => row.type === 'SAIDA' && row.unitCost === undefined && row.nfNumber === undefined));
    });
    await t.test('devolução mantém controle de produto e lote duplicados', () => {
      const result = model.validateMovementLines({ ...values, reason: 'DEVOLUCAO_OBRA', projectId: 'project' },
        [{ ...filter, batchId: 'batch-f' }, { ...filter, id: 999, batchId: 'batch-f' }], items);
      assert.match(result.lineErrors[999], /já foram adicionados/);
    });
    await t.test('ajuste, perda e descarte exigem justificativa e mantêm a direção correta', () => {
      for (const reason of ['INVENTARIO', 'PERDA', 'DESCARTE_VALIDADE']) {
        const input = { ...values, reason };
        const line = { ...filter, batchId: 'batch-f' };
        assert.ok(model.validateMovementLines(input, [line], items).fieldErrors.notes);
        const valid = model.validateMovementLines({ ...input, notes: 'Ajuste', movementType: 'ENTRADA' }, [line], items);
        assert.deepEqual(valid.fieldErrors, {});
        assert.equal(valid.payloads[0].type, reason === 'INVENTARIO' ? 'ENTRADA' : 'SAIDA');
      }
    });
  } finally { await server.close(); }
});
