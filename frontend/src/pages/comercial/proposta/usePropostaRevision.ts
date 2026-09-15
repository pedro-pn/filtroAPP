import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react';

import {
  normalizeTechnicalServiceSelections,
  type TechnicalServiceSelection
} from '../../../../../shared/comercial/dist/technical-services.js';
import type {
  ScopeBlock,
  ScopeServiceItem
} from '../../../../../shared/comercial/dist/scope-content.js';
import type { ModeloProposta } from '../../../../../shared/comercial/dist/modelo-documento.js';
import {
  mensagemDeErro,
  prepararRevisaoDaProposta,
  type ProximaRevisaoDaProposta,
  type VinculoCrmDaProposta
} from '../../../api/comercial';
import {
  recalcularItensDePreco,
  type ItemDePreco,
  type LinhaResponsabilidade
} from './etapas';

type AnyRecord = Record<string, unknown>;
type SetParams = (params: URLSearchParams, options?: { replace?: boolean }) => void;

/**
 * Toda a hidratação de revisão num só lugar.
 *
 * A mesma leitura atende a entrada pelo diálogo, a passagem da tela de custos e
 * o F5. Separar esses caminhos foi justamente o que fazia fotos/tabelas
 * sobreviverem num deles e sumirem no outro.
 */
export function usePropostaRevision({
  modo,
  codigo,
  revisionNumber,
  propostaId,
  params,
  setParams,
  formularioInicial,
  setForm,
  setItensEscopo,
  setBlocos,
  setResponsabilidades,
  setCategorias,
  setServicosTecnicos,
  setComplementoRelatorios,
  setPrecos,
  setIncluirUnitario,
  setMaiorVisitada,
  setTentouAvancar,
  setRecado
}: {
  modo: 'new' | 'revision' | null;
  codigo: string;
  revisionNumber: number;
  propostaId: string;
  params: URLSearchParams;
  setParams: SetParams;
  formularioInicial: (modelo?: ModeloProposta) => AnyRecord;
  setForm: Dispatch<SetStateAction<AnyRecord>>;
  setItensEscopo: Dispatch<SetStateAction<ScopeServiceItem[]>>;
  setBlocos: Dispatch<SetStateAction<ScopeBlock[]>>;
  setResponsabilidades: Dispatch<SetStateAction<LinhaResponsabilidade[]>>;
  setCategorias: Dispatch<SetStateAction<string[]>>;
  setServicosTecnicos: Dispatch<SetStateAction<TechnicalServiceSelection[]>>;
  setComplementoRelatorios: Dispatch<SetStateAction<string>>;
  setPrecos: Dispatch<SetStateAction<ItemDePreco[]>>;
  setIncluirUnitario: Dispatch<SetStateAction<boolean>>;
  setMaiorVisitada: Dispatch<SetStateAction<number>>;
  setTentouAvancar: Dispatch<SetStateAction<boolean>>;
  setRecado: Dispatch<SetStateAction<string>>;
}) {
  const [vinculoCrm, setVinculoCrm] = useState<VinculoCrmDaProposta | null>(null);
  const [chaveDaRevisaoPronta, setChaveDaRevisaoPronta] = useState('');
  const revisaoCarregada = useRef('');

  const aplicarSnapshot = useCallback(
    (dados: AnyRecord, sellerUserId = '') => {
      const modeloDoSnapshot: ModeloProposta =
        dados.modelo === 'hidrojateamento' ? 'hidrojateamento' : 'padrao';
      setForm({
        ...formularioInicial(modeloDoSnapshot),
        ...dados,
        seller: String(dados.seller || sellerUserId || '')
      });
      if (Array.isArray(dados.scopeItems) && dados.scopeItems.length) {
        setItensEscopo(dados.scopeItems as ScopeServiceItem[]);
      }
      if (Array.isArray(dados.scopeBlocks)) setBlocos(dados.scopeBlocks as ScopeBlock[]);
      if (Array.isArray(dados.rows) && dados.rows.length) {
        setResponsabilidades(dados.rows as LinhaResponsabilidade[]);
      }
      if (Array.isArray(dados.categorias) && dados.categorias.length) {
        setCategorias(dados.categorias as string[]);
      }
      if (dados.technicalServices) {
        setServicosTecnicos(normalizeTechnicalServiceSelections(dados.technicalServices));
      }
      if (typeof dados.technicalReports === 'string') {
        setComplementoRelatorios(dados.technicalReports);
      }
      if (Array.isArray(dados.prices) && dados.prices.length) {
        setPrecos(recalcularItensDePreco(dados.prices as ItemDePreco[]));
      }
      if (typeof dados.includeUnitValue === 'boolean') {
        setIncluirUnitario(dados.includeUnitValue);
      }
    },
    [
      formularioInicial,
      setBlocos,
      setCategorias,
      setComplementoRelatorios,
      setForm,
      setIncluirUnitario,
      setItensEscopo,
      setPrecos,
      setResponsabilidades,
      setServicosTecnicos
    ]
  );

  const aplicarResposta = useCallback(
    (revisao: ProximaRevisaoDaProposta) => {
      const snapshot = revisao.snapshot ?? {};
      aplicarSnapshot(snapshot, revisao.sellerUserId);
      setVinculoCrm(revisao.crm);
      setMaiorVisitada(0);
      setTentouAvancar(false);
      const chave = `${revisao.base_number}:${revisao.nextRevision}`;
      revisaoCarregada.current = chave;
      setChaveDaRevisaoPronta(chave);

      const proximos = new URLSearchParams(params);
      proximos.set('modo', 'revision');
      proximos.set('proposta', String(revisao.base_number));
      proximos.set('revisao', String(revisao.nextRevision));
      proximos.set('etapa', 'cliente');
      proximos.delete('id');

      // Chegando de custos, `levantamento` já é a NOVA revisão e vence.
      if (!proximos.get('levantamento') && revisao.costEstimateId) {
        proximos.set('levantamento', revisao.costEstimateId);
      }

      const modeloSalvo = snapshot.modelo;
      if (modeloSalvo === 'padrao' || modeloSalvo === 'hidrojateamento') {
        proximos.set('modelo', modeloSalvo);
      } else {
        proximos.delete('modelo');
      }
      setParams(proximos, { replace: true });

      setRecado(
        revisao.message +
          (revisao.crm
            ? ` O card ${revisao.crm.opportunityId} do funil ${
                revisao.crm.pipelineName || revisao.crm.pipelineId
              } será reutilizado.`
            : ' Funil e card serão definidos na última etapa.')
      );
    },
    [aplicarSnapshot, params, setMaiorVisitada, setParams, setRecado, setTentouAvancar]
  );

  useEffect(() => {
    if (modo !== 'revision' || propostaId || !codigo || codigo === '—') return;
    const chave = `${codigo}:${revisionNumber}`;
    if (revisaoCarregada.current === chave) return;

    let vivo = true;
    prepararRevisaoDaProposta(codigo)
      .then(revisao => {
        if (vivo) aplicarResposta(revisao);
      })
      .catch(error => {
        if (!vivo) return;
        revisaoCarregada.current = '';
        setRecado(mensagemDeErro(error, 'Não foi possível recarregar a revisão.'));
      });

    return () => {
      vivo = false;
    };
  }, [aplicarResposta, codigo, modo, propostaId, revisionNumber, setRecado]);

  const carregarRevisao = useCallback(
    async (procurado: string): Promise<boolean> => {
      setRecado('Carregando a proposta anterior...');
      try {
        aplicarResposta(await prepararRevisaoDaProposta(procurado));
        return true;
      } catch (error) {
        setRecado(mensagemDeErro(error, 'Não foi possível carregar a revisão.'));
        return false;
      }
    },
    [aplicarResposta, setRecado]
  );

  const revisaoPronta =
    modo !== 'revision' ||
    Boolean(propostaId) ||
    chaveDaRevisaoPronta === `${codigo}:${revisionNumber}`;

  return {
    aplicarSnapshot,
    carregarRevisao,
    revisaoPronta,
    setVinculoCrm,
    vinculoCrm
  };
}
