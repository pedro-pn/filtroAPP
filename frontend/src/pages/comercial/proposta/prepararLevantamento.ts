import {
  atualizarLevantamento,
  obterLevantamento,
  type ComercialIssue,
  type LevantamentoSalvo
} from '../../../api/comercial';
import { primeiraSecaoPendente } from '../custos/secaoDoCaminho';

/**
 * Rascunho é um estado de salvamento, não uma indicação de campos faltantes.
 * Confere a versão atual e deixa a API validar e concluir o levantamento antes
 * de vinculá-lo à proposta. Só uma pendência real deve abrir a tela de custos.
 */
export async function prepararLevantamentoParaProposta(id: string) {
  const atual = await obterLevantamento(id);
  if (atual.status === 'SALVO') return atual;
  if (!atual.payload || !atual.updatedAt) {
    throw new Error('Não foi possível carregar os dados completos do levantamento.');
  }

  const salvo = await atualizarLevantamento(
    id,
    {
      proposalCode: atual.proposalCode,
      revisionNumber: atual.revisionNumber,
      mode: atual.mode ?? (atual.revisionNumber > 0 ? 'REVISAO' : 'NOVA'),
      title: atual.title,
      payload: atual.payload,
      status: 'SALVO'
    },
    { expectedUpdatedAt: atual.updatedAt }
  );

  return { ...atual, ...salvo };
}

/** Estado de navegação: transporta as mensagens da API até os campos de custo. */
export interface PendenciasDoLevantamento {
  levantamentoId: string;
  issues: ComercialIssue[];
}

export function parametrosDasPendenciasDoLevantamento(
  levantamento: LevantamentoSalvo,
  issues: ComercialIssue[]
) {
  return new URLSearchParams({
    modo: levantamento.mode === 'REVISAO' || levantamento.revisionNumber > 0
      ? 'revision' : 'new',
    base: levantamento.proposalCode,
    revisao: String(levantamento.revisionNumber || 0),
    id: levantamento.id,
    secao: primeiraSecaoPendente(issues
      .filter(item => item.severity !== 'warning')
      .map(item => item.path || '')) ?? 'summary'
  });
}
