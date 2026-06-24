import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  contractToProposalCode,
  deriveSale,
  mapProposalRow,
  toCnpj,
  toDate,
  toInt,
  toNumber,
  toStr
} from '../src/lib/acompanhamento-access-import.js';

test('contractToProposalCode extrai a primeira parte numérica do contrato', () => {
  assert.equal(contractToProposalCode('4096 - Rev. 1'), 4096);
  assert.equal(contractToProposalCode('4096'), 4096);
  assert.equal(contractToProposalCode(' 4096 '), 4096);
  assert.equal(contractToProposalCode('4096 rev2'), 4096);
  assert.equal(contractToProposalCode(''), null);
  assert.equal(contractToProposalCode(null), null);
  assert.equal(contractToProposalCode('sem numero'), null);
});

test('toNumber lida com number, bigint, texto sujo e nulo', () => {
  assert.equal(toNumber(185000), 185000);
  assert.equal(toNumber(7500n), 7500);
  assert.equal(toNumber('185000'), 185000);
  assert.equal(toNumber('R$ 1.234,56'), 1234.56);
  assert.equal(toNumber('1.000'), 1000);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber(null), null);
  assert.equal(toNumber(undefined), null);
  assert.equal(toNumber('abc'), null);
});

test('toInt trunca e tolera texto', () => {
  assert.equal(toInt('25'), 25);
  assert.equal(toInt('13,9'), 13);
  assert.equal(toInt(null), null);
});

test('toStr normaliza vazio para null', () => {
  assert.equal(toStr('  Ruan  '), 'Ruan');
  assert.equal(toStr(''), null);
  assert.equal(toStr('   '), null);
  assert.equal(toStr(null), null);
});

test('toCnpj mantém apenas dígitos', () => {
  assert.equal(toCnpj('17.164.435/0040-80'), '17164435004080');
  assert.equal(toCnpj(17164435004080n), '17164435004080');
  assert.equal(toCnpj(null), null);
});

test('toDate aceita Date e ISO, rejeita inválido', () => {
  assert.ok(toDate('2026-01-07T00:00:00.000Z') instanceof Date);
  assert.ok(toDate(new Date()) instanceof Date);
  assert.equal(toDate(null), null);
  assert.equal(toDate('xx'), null);
});

test('deriveSale prioriza valor_inloco e cai para pop_sede', () => {
  assert.deepEqual(deriveSale({ valor_inloco: '185000', margem_inloco: 39 }), {
    serviceModality: 'INLOCO',
    salePrice: 185000,
    expectedMargin: 39
  });
  assert.deepEqual(deriveSale({ valor_inloco: '0', valor_pop_sede: '7500', margem_pop_sede: 12 }), {
    serviceModality: 'POP_SEDE',
    salePrice: 7500,
    expectedMargin: 12
  });
  assert.deepEqual(deriveSale({ valor_inloco: 0, valor_pop_sede: 0 }), {
    serviceModality: null,
    salePrice: null,
    expectedMargin: null
  });
});

test('mapProposalRow monta o staging e serializa bigint no rawRow', () => {
  const row = {
    cod_bd: 14,
    cod_prop: 4069n,
    n_rev: 0,
    cod_nectar: 27939674,
    data_proposta: '2026-01-07T00:00:00.000Z',
    nome_cliente: 'EMPRESA CONSTRUTORA BRASIL SA',
    n_cnpj: 17164435004080n,
    valor_inloco: '185000',
    valor_custos: '0',
    n_operadores: '0',
    n_dias: '25'
  };
  const mapped = mapProposalRow(row);
  assert.equal(mapped.codBd, 14);
  assert.equal(mapped.codProp, 4069);
  assert.equal(mapped.clientCnpj, '17164435004080');
  assert.equal(mapped.serviceModality, 'INLOCO');
  assert.equal(mapped.salePrice, 185000);
  assert.equal(mapped.isComplete, true);
  assert.equal(mapped.plannedDays, 25);
  // rawRow deve ser JSON-serializável (bigint vira string)
  assert.equal(mapped.rawRow.cod_prop, '4069');
  assert.doesNotThrow(() => JSON.stringify(mapped.rawRow));
});

test('mapProposalRow marca isComplete=false quando sem valor de venda', () => {
  const mapped = mapProposalRow({ cod_bd: 1, cod_prop: 1, n_rev: 0 });
  assert.equal(mapped.isComplete, false);
  assert.equal(mapped.salePrice, null);
  assert.equal(mapped.serviceModality, null);
});
