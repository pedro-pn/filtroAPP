import { addRealizedService, buildProgress, isServiceFinalized } from '../acompanhamento/avanco.js';
import { withNativeMeasurementLinks } from '../acompanhamento/native-measurement-links.js';
import { realizedFromExtraData } from '../acompanhamento/realized-measurements.js';

// Mesmas métricas do quadro "Progresso" do RDO (lib/reports/rdo-progress-table.js).
const METRICAS = [
  ['tubulacaoM', 'm', 'TUBULACAO'],
  ['oleoL', 'L', 'OLEO'],
  ['sistemasUn', 'un', 'SISTEMA']
];

const UNIDADE_POR_SISTEMA = { TUBULACAO: 'm', OLEO: 'L', SISTEMA: 'un' };
const NOME_SERVICO = {
  LIMPEZA_QUIMICA: 'Limpeza química',
  TESTE_PRESSAO: 'Teste de pressão',
  FLUSHING: 'Flushing',
  FILTRAGEM: 'Filtragem'
};
const NOME_SISTEMA = { TUBULACAO: 'tubulação', OLEO: 'óleo', SISTEMA: 'sistemas' };

function dayKey(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function arredondar(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function compararRelatorios(a, b) {
  const porDia = dayKey(a.reportDate).localeCompare(dayKey(b.reportDate));
  if (porDia) return porDia;
  const porNumero = (a.sequenceNumber ?? Number.MAX_SAFE_INTEGER) - (b.sequenceNumber ?? Number.MAX_SAFE_INTEGER);
  if (porNumero) return porNumero;
  return String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id || '').localeCompare(String(b.id || ''));
}

function servicosFinalizadosComMedicao(rdo) {
  return withNativeMeasurementLinks((rdo.services || []).map(service => ({
    ...service,
    report: { id: rdo.id, measurementLinks: rdo.measurementLinks || [] }
  }))).filter(isServiceFinalized);
}

// Base do avanço: uma única métrica prevista no contrato vira a unidade do Data Book (m, L ou un);
// escopo com métricas mistas segue o % ponderado do Acompanhamento; sem escopo, a métrica mais
// executada vira a unidade e o total fica a cargo do gerador (acumulado + concluídas).
export function definirEscopo(plannedServices = [], rdos = []) {
  const previsto = Object.fromEntries(METRICAS.map(([chave]) => [chave, 0]));
  for (const service of plannedServices) {
    for (const system of service.systems || []) {
      const metrica = METRICAS.find(([, , tipo]) => tipo === system.systemType);
      if (metrica && Number(system.quantity) > 0) previsto[metrica[0]] += Number(system.quantity);
    }
  }
  const comPrevisto = METRICAS.filter(([chave]) => previsto[chave] > 0);
  if (comPrevisto.length === 1) {
    const [chave, unidade] = comPrevisto[0];
    return { modo: 'unidade', chave, unidade, total: arredondar(previsto[chave]) };
  }
  if (comPrevisto.length > 1) return { modo: 'percentual', chave: null, unidade: '%', total: 100 };

  const realizado = Object.fromEntries(METRICAS.map(([chave]) => [chave, 0]));
  for (const rdo of rdos) {
    for (const service of servicosFinalizadosComMedicao(rdo)) {
      const q = realizedFromExtraData(service.extraData, service.serviceType);
      for (const [chave] of METRICAS) realizado[chave] += q[chave] || 0;
    }
  }
  const [chave, unidade] = METRICAS.reduce((melhor, atual) => (realizado[atual[0]] > realizado[melhor[0]] ? atual : melhor));
  return { modo: 'livre', chave, unidade, total: null };
}

// Percorre todos os RDOs do projeto até o fim do intervalo, na ordem do quadro de progresso,
// e devolve quanto cada serviço finalizado acrescentou ao avanço e o acumulado antes do início.
export function calcularAvanco(rdos = [], plannedServices = [], { dataInicio, dataFim } = {}) {
  const inicio = dayKey(dataInicio);
  const fim = dayKey(dataFim);
  const ordenados = rdos.filter(rdo => rdo.reportType === undefined || rdo.reportType === 'RDO')
    .filter(rdo => !fim || dayKey(rdo.reportDate) <= fim)
    .sort(compararRelatorios);
  const escopo = definirEscopo(plannedServices, ordenados);
  const realizadoPorTipo = new Map();
  const porServico = new Map();
  let acumuladoInicial = 0;

  for (const rdo of ordenados) {
    const antesDoIntervalo = inicio && dayKey(rdo.reportDate) < inicio;
    for (const service of servicosFinalizadosComMedicao(rdo)) {
      let contribuicao;
      if (escopo.modo === 'percentual') {
        const antes = buildProgress(plannedServices, realizadoPorTipo).progressPct ?? 0;
        addRealizedService(realizadoPorTipo, service);
        contribuicao = (buildProgress(plannedServices, realizadoPorTipo).progressPct ?? 0) - antes;
      } else {
        contribuicao = realizedFromExtraData(service.extraData, service.serviceType)[escopo.chave] || 0;
      }
      if (antesDoIntervalo) acumuladoInicial += contribuicao;
      else porServico.set(service.id, arredondar(contribuicao));
    }
  }
  const escopos = escopo.modo === 'percentual' ? avancoPorEscopo(buildProgress(plannedServices, realizadoPorTipo)) : [];
  return { escopo, acumuladoInicial: arredondar(acumuladoInicial), porServico, escopos };
}

/**
 * Escopo com métricas mistas: uma linha por serviço previsto × métrica (m, L, un), com o realizado
 * acumulado até o fim do intervalo — complementa o % geral ponderado do Acompanhamento.
 */
export function avancoPorEscopo(progresso) {
  const grupos = progresso?.scopeGroups?.length
    ? progresso.scopeGroups.map(g => ({ nome: g.scopeName, services: g.services }))
    : [{ nome: '', services: progresso?.services || [] }];
  const linhas = [];
  for (const grupo of grupos) {
    for (const service of grupo.services) {
      for (const sys of service.systems || []) {
        if (!(sys.plannedQty > 0)) continue;
        const servico = NOME_SERVICO[service.serviceType] || String(service.serviceType || '');
        const sistema = NOME_SISTEMA[sys.systemType] || '';
        linhas.push({
          escopo: [grupo.nome, `${servico}${sistema ? ` (${sistema})` : ''}`].filter(Boolean).join(' – '),
          unidade: UNIDADE_POR_SISTEMA[sys.systemType] || '',
          previsto: arredondar(sys.plannedQty),
          realizado: arredondar(sys.realizedQty),
          percentual: sys.pct == null ? null : arredondar(sys.pct)
        });
      }
    }
  }
  return linhas;
}

// Quantidade exibida no bloco do serviço ("(48 m)"), na métrica que o próprio serviço mediu.
export function quantidadeDoServico(service) {
  const q = realizedFromExtraData(service.extraData, service.serviceType);
  if (q.tubulacaoM > 0) return { quantidade: arredondar(q.tubulacaoM), unidade: 'm' };
  if (q.oleoL > 0) return { quantidade: arredondar(q.oleoL), unidade: 'L' };
  if (q.sistemasUn > 0) return { quantidade: arredondar(q.sistemasUn), unidade: 'un.' };
  return { quantidade: 0, unidade: 'un.' };
}
