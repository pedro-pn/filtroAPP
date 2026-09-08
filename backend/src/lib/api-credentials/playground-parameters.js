import { QUALITY_RECORD_TYPES, QUALITY_STATUSES } from '../../../../shared/schemas/qualidade.js';

const queryDefinitions = {
  limit: { label: 'Itens para visualizar', type: 'integer', min: 1, max: 20, help: 'Até 20 itens por teste, respeitando o limite do token.' },
  cursor: { label: 'Cursor da próxima página', type: 'text', maxLength: 4096, help: 'Copie page.nextCursor da resposta anterior e mantenha os mesmos filtros.', advanced: true },
  snapshotAt: { label: 'Teto da consulta (horário local)', type: 'datetime', help: 'Use page.snapshotAt para repetir o teto anterior.', advanced: true },
  updatedSince: { label: 'Atualizados desde (horário local)', type: 'datetime' },
  updatedUntil: { label: 'Atualizados até (horário local)', type: 'datetime' },
  createdSince: { label: 'Criados desde (horário local)', type: 'datetime', help: 'Detecta criações, não alterações. Faça reconciliações completas periodicamente.' },
  projectId: { label: 'Projeto', type: 'text', maxLength: 100, help: 'ID interno do projeto; opcional, dentro do recorte do token.' },
  reportId: { label: 'ID do relatório', type: 'text', maxLength: 100, help: 'Opcional. Copie id da listagem de relatórios.' },
  maintenanceId: { label: 'ID da manutenção', type: 'text', maxLength: 100, help: 'Opcional. Copie id da listagem de manutenções.' },
  itemId: { label: 'ID do item de estoque', type: 'text', maxLength: 100, help: 'Opcional. Copie id da listagem de itens.' },
  natureId: { label: 'ID da natureza', type: 'text', maxLength: 100, help: 'Opcional. Copie id da listagem de naturezas de Qualidade.' },
  eventDateFrom: { label: 'Data do evento — início', type: 'date' },
  eventDateTo: { label: 'Data do evento — fim', type: 'date' },
  status: { label: 'Status', type: 'enum-list', options: QUALITY_STATUSES, help: 'Opcional. Um ou mais códigos separados por vírgula.' },
  type: { label: 'Tipo de registro', type: 'enum-list', options: QUALITY_RECORD_TYPES, help: 'Opcional. Um ou mais códigos separados por vírgula.' },
  active: { label: 'Situação', type: 'boolean', help: 'Sim: ativos; não: inativos. Vazio inclui ambos.' },
  includeDeleted: { label: 'Incluir excluídos', type: 'boolean', requiredScope: 'qualidade.excluidos.read', help: 'Sim exige a permissão de leitura de excluídos.' }
};

export function describePlaygroundParameters(operation) {
  const identity = operation.operationId === 'quality.records.get'
    ? { label: 'ID do registro de Qualidade', help: 'Copie o campo id de um item retornado em Listar registros de Qualidade. Não é o número do registro nem o ID do token.' }
    : operation.operationId === 'quality.evidence.download'
      ? { label: 'ID da evidência', help: 'Copie id de uma evidência ATTACHMENT no array evidences de um registro de Qualidade.' }
      : operation.path.startsWith('/estoque/')
        ? { label: 'ID do documento de estoque', help: 'Copie id de um item retornado em Documentos técnicos de estoque — metadados globais.' }
        : { label: operation.path.startsWith('/manutencao/') ? 'ID do anexo de manutenção' : 'ID do anexo do relatório', help: 'Copie id de um item retornado na listagem de metadados de anexos do mesmo módulo.' };
  return [
    ...(operation.pathParams || []).map(name => {
      if (name !== 'id') throw new Error(`Parâmetro de caminho sem descritor: ${name}`);
      return { name, in: 'path', type: 'text', required: true, maxLength: 100, ...identity };
    }),
    ...operation.queryParams.map(name => {
      if (!queryDefinitions[name]) throw new Error(`Parâmetro sem descritor: ${name}`);
      return { name, in: 'query', required: false, ...queryDefinitions[name] };
    })
  ];
}
