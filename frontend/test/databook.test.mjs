import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

import {
  deveMostrarNovidadeDatabook,
  edicoesDoFormulario,
  erroIntervaloDatabook,
  formatarResumoDatabook,
  formularioInicialDatabook,
  marcarNovidadeDatabookVista,
  validarFormularioDatabook
} from '../src/utils/databook.ts';

const preparada = {
  dados: {
    projeto: { servico: 'Limpeza Química de APVs Verticais', doc: 'DB-5815-01', rev: '0', periodo: '16/09/2026 a 08/10/2026' },
    unidade_escopo: 'APVs',
    ocorrencias_sms: 0,
    textos: { escopo: 'Escopo', resumo_executivo: 'Resumo', destaques_sms: ['Um', 'Dois'], consideracoes_finais: 'Fim' },
    fds: [{ produto: 'Ácido cítrico', nome_comercial: 'Ácido Cítrico Fino Granulado', etapa: 'Fase ácida', arquivo: 'stockdoc:a' }],
    certificados: [{ equipamento: 'Manômetro', codigo: 'MAN-012', aplicacao: 'RTP', validade: '12/03/2027', arquivo: 'cert:m' }]
  },
  avisos: ['24/09/2026: DDS termina (06:05) antes de começar (06:20).'],
  resumo: { inicio: '2026-09-16', fim: '2026-10-08', dias: 23, rdos: 23, rlq: 19, rcpu: 0, rtp: 2, rlm: 0, fds: 6 },
  sugestoes: {
    fds: [
      { produto: 'Ácido cítrico', stockItemId: 'i1', confirmadoRomaneio: true, selecionado: true, motivo: 'confirmado no romaneio' },
      { produto: 'Nitrito de sódio', stockItemId: null, selecionado: false, motivo: 'sem cadastro' }
    ],
    certificados: [{ equipamento: 'Manômetro', codigo: 'MAN-012', aplicacao: 'RTP', validade: '12/03/2027', arquivo: 'cert:m' }]
  },
  documento: { doc: 'DB-5815-01', rev: 0 },
  responsaveis: [{ id: 'u1', nome: 'Paula Costa', cargo: 'Coordenadora' }],
  ortografia: { disponivel: true, palavras: [{ palavra: 'equipamnetos', sugestoes: ['equipamentos'],
    ocorrencias: [{ data: '05/10/2026', campo: 'Atividades', trecho: 'Montagem dos equipamnetos' }] }] }
};

test('resumo do intervalo no formato do diálogo', () => {
  assert.equal(formatarResumoDatabook(preparada.resumo), '23 dias · 23 RDOs · 19 RLQs · 2 RTPs · 6 FDS');
  assert.equal(formatarResumoDatabook({ dias: 1, rdos: 1, rlq: 0, rcpu: 1, rtp: 0, rlm: 0 }), '1 dia · 1 RDO · 1 RCPU');
});

test('intervalo: padrão é primeiro/último RDO e datas inválidas são bloqueadas', () => {
  const padrao = { inicio: '2026-09-16', fim: '2026-10-08' };
  assert.equal(erroIntervaloDatabook(padrao, padrao), null);
  assert.match(erroIntervaloDatabook({ inicio: '2026-10-01', fim: '2026-09-20' }, padrao), /anterior ou igual/);
  assert.match(erroIntervaloDatabook({ inicio: '2026-09-01', fim: '2026-09-20' }, padrao), /16\/09\/2026 e 08\/10\/2026/);
  assert.match(erroIntervaloDatabook({ inicio: '', fim: '2026-09-20' }, padrao), /Informe/);
  assert.match(erroIntervaloDatabook(padrao, null), /não tem RDO/);
});

test('formulário da revisão: valores iniciais, validação e edições enviadas', () => {
  const form = formularioInicialDatabook(preparada, 'u1');
  assert.equal(form.elaborado, 'u1');
  assert.equal(form.destaques, 'Um\nDois');
  assert.deepEqual(form.fds, ['stockdoc:a']);
  assert.equal(form.descricao, 'Emissão inicial');
  assert.deepEqual(validarFormularioDatabook(form), {});
  const invalido = { ...form, servico: ' ', ocorrenciasSms: '-1', limiteIso: '16-14', limiteNas: 'x' };
  assert.deepEqual(Object.keys(validarFormularioDatabook(invalido)).sort(), ['limiteIso', 'limiteNas', 'ocorrenciasSms', 'servico']);
  const edicoes = edicoesDoFormulario({ ...form, destaques: 'Um\n\n Três ', aprovadoNome: 'Fiscal', aprovadoCargo: 'Cliente', certificados: [] });
  assert.deepEqual(edicoes.textos.destaques_sms, ['Um', 'Três']);
  assert.deepEqual(edicoes.aprovacoes, { elaborado: { userId: 'u1' }, aprovado: { nome: 'Fiscal', cargo: 'Cliente' } });
  assert.deepEqual(edicoes.certificados, []);
  const comCorrecao = edicoesDoFormulario({ ...form, correcoes: { equipamnetos: 'equipamentos', liberasão: '' } });
  assert.deepEqual(comCorrecao.correcoes, [{ palavra: 'equipamnetos', por: 'equipamentos' }]);
});

test('novidade do Data Book: uma vez por usuário e só até 10 dias após a implementação', () => {
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const dentro = new Date('2026-10-12T12:00:00-03:00').getTime();
  assert.equal(deveMostrarNovidadeDatabook('u1', dentro, storage), true);
  marcarNovidadeDatabookVista('u1', storage);
  assert.equal(deveMostrarNovidadeDatabook('u1', dentro, storage), false);
  assert.equal(deveMostrarNovidadeDatabook('u2', new Date('2026-10-20T00:00:01-03:00').getTime(), storage), false);
});

test('tela de revisão mostra avisos, anexos sugeridos e omite limites sem RCPU', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { DatabookRevisaoForm } = await server.ssrLoadModule('/src/components/databook/DatabookRevisaoForm.tsx');
    const form = formularioInicialDatabook(preparada, 'u1');
    const html = renderToStaticMarkup(createElement(DatabookRevisaoForm, { preparada, form, erros: { servico: 'Informe o título do serviço.' }, onChange: () => {} }));
    assert.match(html, /DDS termina \(06:05\)/);
    assert.match(html, /Ácido Cítrico Fino Granulado/);
    assert.match(html, /No romaneio/);
    assert.match(html, /Sem FDS no Estoque: Nitrito de sódio/);
    assert.match(html, /Manômetro MAN-012/);
    assert.match(html, /Informe o título do serviço\./);
    assert.match(html, /aria-invalid="true"/);
    assert.doesNotMatch(html, /Limites aceitos/);
    assert.match(html, /equipamnetos/);
    assert.match(html, /Trocar por “equipamentos”/);
    const comRcpu = renderToStaticMarkup(createElement(DatabookRevisaoForm, {
      preparada: { ...preparada, resumo: { ...preparada.resumo, rcpu: 2 } }, form, erros: {}, onChange: () => {}
    }));
    assert.match(comRcpu, /Limites aceitos nas contagens \(RCPU\)/);
  } finally {
    await server.close();
  }
});
