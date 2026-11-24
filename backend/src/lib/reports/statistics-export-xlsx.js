import zlib from 'node:zlib';

import { XLSX_MIME_TYPE, buildXlsxWorkbook } from '../../../../shared/modules/xlsx-workbook.js';

export { XLSX_MIME_TYPE };

/**
 * Colunas tipadas da planilha de estatísticas, na mesma ordem das linhas do CSV.
 * Minutos viram duração ([h]:mm); quantidades e totais usam SUBTOTAL no rodapé.
 */
const SECTION_SHEETS = {
  summary: {
    name: 'Resumo',
    title: 'Estatísticas — resumo do período',
    columns: [
      { header: 'Período de', type: 'date' },
      { header: 'Período até', type: 'date' },
      { header: 'Relatórios', type: 'integer' },
      { header: 'Dias executados', type: 'integer' },
      { header: 'Horas diurnas', type: 'duration' },
      { header: 'Horas noturnas', type: 'duration' },
      { header: 'HE diurna', type: 'duration' },
      { header: 'HE noturna', type: 'duration' },
      { header: 'Standby (dias)', type: 'integer' },
      { header: 'Standby (horas)', type: 'duration' },
      { header: 'Colaboradores diurnos (média)', type: 'decimal', decimals: 1 },
      { header: 'Colaboradores noturnos (média)', type: 'decimal', decimals: 1 }
    ]
  },
  byProject: {
    name: 'Por projeto',
    title: 'Estatísticas por projeto',
    columns: [
      { header: 'Código' },
      { header: 'Projeto', width: 40 },
      { header: 'Relatórios', type: 'integer', total: 'sum' },
      { header: 'Dias', type: 'integer', total: 'sum' },
      { header: 'H. diurnas', type: 'duration', total: 'sum' },
      { header: 'H. noturnas', type: 'duration', total: 'sum' },
      { header: 'HE diurna', type: 'duration', total: 'sum' },
      { header: 'HE noturna', type: 'duration', total: 'sum' },
      { header: 'Standby (dias)', type: 'integer', total: 'sum' },
      { header: 'Standby (horas)', type: 'duration', total: 'sum' }
    ]
  },
  services: {
    name: 'Serviços',
    title: 'Estatísticas — serviços executados',
    columns: [
      { header: 'Data', type: 'date' },
      { header: 'Projeto' },
      { header: 'RDO #', type: 'integer', align: 'center' },
      { header: 'Tipo serviço' },
      { header: 'Sistema' },
      { header: 'Equipamento', width: 36 },
      { header: 'Volume óleo (L)', type: 'decimal', total: 'sum' },
      { header: 'Diâmetro', align: 'center' },
      { header: 'Comprimento (m)', type: 'decimal', total: 'sum' },
      { header: 'Mangueiras (un)', type: 'integer', total: 'sum' },
      { header: 'Sistemas (un)', type: 'integer', total: 'sum' },
      { header: 'Correção após assinatura', align: 'center', tone: value => (value === 'Sim' ? 'info' : null) },
      { header: 'Relatório da correção' },
      { header: 'Corrigido em', type: 'datetime' }
    ]
  }
};

const PROJECT_STATUS_LABELS = { active: 'Ativos', archived: 'Arquivados', all: 'Todos' };

function ptBrDate(value) {
  const [year, month, day] = String(value || '').slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : String(value || '');
}

function projectsLabel(projects, filtered) {
  if (!filtered) return 'Todos';
  if (projects.length === 1) return [projects[0].code, projects[0].name].filter(Boolean).join(' — ');
  return `${projects.length} selecionados`;
}

/**
 * @param {{ section: 'summary'|'byProject'|'services', rows: unknown[][], from: string, to: string,
 *   projectStatus: string, segment: string|null, projects: Array<{code:string,name:string}>, projectFiltered: boolean }} input
 */
export function buildStatisticsXlsx({ section, rows, from, to, projectStatus, segment, projects, projectFiltered }) {
  const sheet = SECTION_SHEETS[section];
  return Buffer.from(buildXlsxWorkbook({
    sheets: [{
      ...sheet,
      subtitle: 'Relatórios e Projetos  ·  Estatísticas',
      meta: [
        ['Período', `${ptBrDate(from)} a ${ptBrDate(to)}`],
        ['Projetos', projectsLabel(projects, projectFiltered)],
        ['Situação dos projetos', PROJECT_STATUS_LABELS[projectStatus] || projectStatus],
        ['Segmento', segment || 'Todos'],
        ['Base', 'RDOs aprovados e assinados']
      ],
      rows,
      emptyMessage: 'Nenhum RDO aprovado ou assinado para os filtros selecionados.'
    }]
  }, { deflateRaw: data => zlib.deflateRawSync(data) }));
}
