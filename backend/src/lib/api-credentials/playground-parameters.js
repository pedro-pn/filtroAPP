import { QUALITY_RECORD_TYPES, QUALITY_STATUSES } from '../../../../shared/schemas/qualidade.js';
import { INTEGRATION_REPORT_TYPES } from '../../../../shared/schemas/integration-api.js';

const queryDefinitions = {
  limit: { label: 'Itens para visualizar', type: 'integer', min: 1, max: 20, help: 'Na URI: limit=20. Define o tamanho da página; o teste exibe até 20 itens e respeita o limite do token.' },
  cursor: { label: 'Cursor da próxima página', type: 'text', maxLength: 4096, help: 'Na URI: cursor=VALOR. Copie page.nextCursor, codifique-o na URL e mantenha os mesmos filtros.', advanced: true },
  snapshotAt: { label: 'Teto da consulta (horário local)', type: 'datetime', help: 'Na URI: snapshotAt=DATA_HORA_ISO. Use page.snapshotAt para manter o mesmo teto entre páginas.', advanced: true },
  updatedSince: { label: 'Atualizados desde (horário local)', type: 'datetime', help: 'Na URI: updatedSince=DATA_HORA_ISO. Retorna registros cuja última alteração ocorreu desde esse instante.' },
  updatedUntil: { label: 'Atualizados até (horário local)', type: 'datetime', help: 'Na URI: updatedUntil=DATA_HORA_ISO. Limita a última alteração até esse instante.' },
  createdSince: { label: 'Criados desde (horário local)', type: 'datetime', help: 'Na URI: createdSince=DATA_HORA_ISO. Detecta criações, não alterações; faça reconciliações completas periodicamente.' },
  projectCode: { label: 'Código do projeto', type: 'text', maxLength: 100, help: 'Na URI: projectCode=05776. Use o código cadastrado, preservando zeros à esquerda; deve estar no recorte do token.' },
  projectId: { label: 'ID interno do projeto', type: 'text', maxLength: 100, help: 'Na URI: projectId=ID. Compatibilidade para integrações existentes; prefira projectCode e não envie os dois juntos.', advanced: true },
  reportId: { label: 'ID do relatório', type: 'text', maxLength: 100, help: 'Na URI: reportId=ID. Copie id da listagem de relatórios.' },
  reportType: { label: 'Tipo de relatório', type: 'enum-list', options: INTEGRATION_REPORT_TYPES, help: 'Na URI: reportType=RCPU. Para mais de um tipo, separe os códigos por vírgula.' },
  maintenanceId: { label: 'ID da manutenção', type: 'text', maxLength: 100, help: 'Na URI: maintenanceId=ID. Copie id da listagem de manutenções.' },
  itemId: { label: 'ID do item de estoque', type: 'text', maxLength: 100, help: 'Na URI: itemId=ID. Copie id da listagem de itens.' },
  natureId: { label: 'ID da natureza', type: 'text', maxLength: 100, help: 'Na URI: natureId=ID. Copie id da listagem de naturezas de Qualidade.' },
  eventDateFrom: { label: 'Data do evento — início', type: 'date', help: 'Na URI: eventDateFrom=AAAA-MM-DD. Inclui eventos a partir da data informada.' },
  eventDateTo: { label: 'Data do evento — fim', type: 'date', help: 'Na URI: eventDateTo=AAAA-MM-DD. Inclui eventos até a data informada.' },
  status: { label: 'Status', type: 'enum-list', options: QUALITY_STATUSES, help: 'Na URI: status=CODIGO1,CODIGO2. Separe múltiplos códigos por vírgula.' },
  type: { label: 'Tipo de registro', type: 'enum-list', options: QUALITY_RECORD_TYPES, help: 'Na URI: type=CODIGO1,CODIGO2. Separe múltiplos códigos por vírgula.' },
  active: { label: 'Situação', type: 'boolean', help: 'Na URI: active=true ou active=false. Vazio inclui registros ativos e inativos.' },
  includeDeleted: { label: 'Incluir excluídos', type: 'boolean', requiredScope: 'qualidade.excluidos.read', help: 'Na URI: includeDeleted=true. Exige a permissão de leitura de excluídos.' }
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
