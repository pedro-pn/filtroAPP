import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

import {
  ComercialValidationError,
  atualizarLevantamento,
  criarLevantamento,
  listarLevantamentos,
  mensagemDeErro,
  obterLevantamento,
  prepararRevisaoDaProposta,
  reservarProximoNumero,
  type LevantamentoSalvo
} from '../../../api/comercial';
import { moduleRoutePath } from '../../../modules/registry';
import { ComercialChrome } from '../components/ComercialChrome';
import { useAuth } from '../../../auth/AuthContext';
import { FaixaIndicadores } from './FaixaIndicadores';
import {
  deveRevelarErrosAoAcionar,
  footerAction,
  saveBlockedByContent,
  type CostSection
} from './footerChain';
import { numberValue } from './formato';
import { pendenciasDe } from './pendencias';
import { primeiraSecaoPendente } from './secaoDoCaminho';
import { InsumosSection } from './sections/InsumosSection';
import { LogisticaSection } from './sections/LogisticaSection';
import { MaoDeObraSection } from './sections/MaoDeObraSection';
import { PremissasSection } from './sections/PremissasSection';
import { ResumoSection } from './sections/ResumoSection';
import { useLevantamento } from './useLevantamento';
import { useRascunhoLocal } from '../useRascunhoLocal';
import { LOGO_URL } from '../components/marca';
import { TutorialDoModulo } from '../TutorialDoModulo';
import { ROTEIRO_DOS_CUSTOS } from '../roteiroDoTutorial';
import { BotaoFecharDialogo } from '../components/FecharDialogo';
import { MarcaDeOpcao } from '../components/MarcaDeOpcao';
import {
  focarPrimeiroCampoInvalido,
  parametrosDoLevantamentoAposAvanco,
  rolarParaInicioDoFormulario
} from '../navegacao';
import { parametrosDaPropostaComLevantamento } from '../proposta/levantamentoVinculado';
import { useAutosaveServidor } from '../useAutosaveServidor';
import { PendenciasDaSecao } from './PendenciasDaSecao';
import type { PendenciasDoLevantamento } from '../proposta/prepararLevantamento';

/**
 * Levantamento de custos — container das cinco seções.
 *
 * É a maior tela do porte: 465 controles. Este arquivo é só o esqueleto — a
 * tira de seções, o diálogo de modo, o rodapé-guia e o modal de confirmação.
 * Cada seção vem em componente próprio, porque o repositório reprova página
 * acima de 700-900 linhas e a referência tem 3.382 num arquivo só.
 *
 * L3 desde já: modo, base e seção ativa vivem no ENDEREÇO. Na referência o F5
 * reabre o diálogo de modo e apaga o levantamento inteiro — 465 controles de
 * trabalho, sem aviso e sem confirmação de saída.
 */

const SECOES: Array<{ value: CostSection; label: string }> = [
  { value: 'premises', label: 'Premissas' },
  { value: 'labor', label: 'Mão de obra' },
  { value: 'inputs', label: 'Materiais e insumos' },
  { value: 'logistics', label: 'Logística' },
  { value: 'summary', label: 'Resumo e QQP' }
];

type EstimateMode = 'new' | 'revision';

const dataHora = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short'
});

/**
 * Mensagem legível de um erro de rede.
 *
 * O `503` da numeração é traduzido em texto próprio: ele **não** é falha, é o
 * ambiente dizendo que a numeração ainda não foi semeada. Quem lê "erro do servidor"
 * abre chamado; quem lê o que falta chama o operador.
 */
export function CustosPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const modo = (params.get('modo') as EstimateMode | null) ?? null;
  const base = params.get('base') ?? '';
  const revisionNumber = Math.max(0, Number(params.get('revisao')) || 0);
  const levantamentoOrigemId = params.get('origem') ?? '';
  const levantamentoAtualId = params.get('id') ?? '';
  const secao = (params.get('secao') as CostSection | null) ?? 'premises';

  const [baseDigitada, setBaseDigitada] = useState('');
  const [mostrarRevisao, setMostrarRevisao] = useState(false);
  const [mostrarConfirmacao, setMostrarConfirmacao] = useState(false);
  const [reservando, setReservando] = useState(false);
  const [carregandoRevisao, setCarregandoRevisao] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [salvandoRascunho, setSalvandoRascunho] = useState(false);
  const [versaoDoRascunho, setVersaoDoRascunho] = useState('');
  const [recado, setRecado] = useState('');
  const [salvo, setSalvo] = useState<string | null>(null);
  const [focarPendencia, setFocarPendencia] = useState(false);
  const [levantamentosRecentes, setLevantamentosRecentes] = useState<LevantamentoSalvo[]>([]);
  const [carregandoRecentes, setCarregandoRecentes] = useState(false);
  const [erroDosRecentes, setErroDosRecentes] = useState('');

  const levantamento = useLevantamento(user?.name || '', secao);
  const {
    draft,
    setDraft,
    result,
    revelarErros,
    aplicarIssuesDoServidor,
    issuesDoServidor
  } = levantamento;
  const origemCarregada = useRef('');
  const atualCarregado = useRef('');
  const formularioRef = useRef<HTMLElement>(null);
  const pendenciasRecebidas = (location.state as {
    pendenciasDoLevantamento?: PendenciasDoLevantamento;
  } | null)?.pendenciasDoLevantamento;
  const pendenciasApresentadas = useRef<PendenciasDoLevantamento | null>(null);

  useEffect(() => {
    if (
      !pendenciasRecebidas ||
      pendenciasRecebidas === pendenciasApresentadas.current ||
      pendenciasRecebidas.levantamentoId !== levantamentoAtualId ||
      !versaoDoRascunho
    ) return;

    pendenciasApresentadas.current = pendenciasRecebidas;
    aplicarIssuesDoServidor(pendenciasRecebidas.issues, secao);
    setRecado('O levantamento tem pendências. Corrija os campos destacados para continuar a criação da proposta.');
    setFocarPendencia(true);
  }, [
    pendenciasRecebidas,
    levantamentoAtualId,
    versaoDoRascunho,
    aplicarIssuesDoServidor,
    secao
  ]);

  const carregarLevantamentosRecentes = useCallback(async () => {
    setCarregandoRecentes(true);
    setErroDosRecentes('');
    try {
      const resposta = await listarLevantamentos({ pageSize: 100 });
      setLevantamentosRecentes(
        [...resposta.items]
          .sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          )
          .slice(0, 8)
      );
    } catch (error) {
      setErroDosRecentes(
        mensagemDeErro(error, 'Não foi possível carregar os orçamentos salvos.')
      );
    } finally {
      setCarregandoRecentes(false);
    }
  }, []);

  useEffect(() => {
    if (modo === null) void carregarLevantamentosRecentes();
  }, [carregarLevantamentosRecentes, modo]);

  useEffect(() => {
    if (!focarPendencia) return;

    const quadro = window.requestAnimationFrame(() => {
      focarPrimeiroCampoInvalido(formularioRef.current?.parentElement ?? null);
      setFocarPendencia(false);
    });

    return () => window.cancelAnimationFrame(quadro);
  }, [focarPendencia, issuesDoServidor, secao]);

  /** Reabre o rascunho persistido pela conta quando o id está no endereço. */
  useEffect(() => {
    if (!levantamentoAtualId || atualCarregado.current === levantamentoAtualId)
      return;

    let vivo = true;
    obterLevantamento(levantamentoAtualId)
      .then((atual) => {
        if (!vivo || !atual.payload) return;
        // No StrictMode, o primeiro efeito é desmontado e executado de novo.
        // Marcar antes da resposta bloqueava a segunda leitura e descartava a
        // única resposta que ainda poderia hidratar a tela.
        atualCarregado.current = levantamentoAtualId;
        setDraft({
          ...atual.payload,
          estimatorName: user?.name || atual.payload.estimatorName || ''
        });
        setVersaoDoRascunho(atual.updatedAt || '');
      })
      .catch((error) => {
        if (vivo) {
          setRecado(
            mensagemDeErro(
              error,
              'Não foi possível recarregar o rascunho salvo.'
            )
          );
        }
      });

    return () => {
      vivo = false;
    };
  }, [levantamentoAtualId, setDraft, user?.name]);

  /** No F5, recompõe o levantamento que originou a revisão. */
  useEffect(() => {
    if (
      modo !== 'revision' ||
      levantamentoAtualId ||
      !levantamentoOrigemId ||
      origemCarregada.current === levantamentoOrigemId
    ) {
      return;
    }

    let vivo = true;
    obterLevantamento(levantamentoOrigemId)
      .then((anterior) => {
        if (!vivo || !anterior.payload) return;
        origemCarregada.current = levantamentoOrigemId;
        setDraft({
          ...anterior.payload,
          estimatorName: user?.name || anterior.payload.estimatorName || ''
        });
      })
      .catch((error) => {
        if (vivo) {
          origemCarregada.current = '';
          setRecado(
            mensagemDeErro(
              error,
              'Não foi possível recarregar o levantamento anterior.'
            )
          );
        }
      });

    return () => {
      vivo = false;
    };
  }, [levantamentoAtualId, levantamentoOrigemId, modo, setDraft, user?.name]);

  /**
   * L3 — o trabalho não se perde num F5.
   *
   * Na referência, recarregar volta ao diálogo de modo e apaga 465 controles de
   * trabalho. Modo, código e seção já vivem no endereço; o que faltava era o
   * conteúdo. A recuperação é **oferecida**, nunca aplicada em silêncio.
   */
  const trabalhoProntoParaSalvar =
    modo !== null &&
    (levantamentoAtualId
      ? Boolean(versaoDoRascunho)
      : modo !== 'revision' ||
        !levantamentoOrigemId ||
        origemCarregada.current === levantamentoOrigemId);

  const rascunho = useRascunhoLocal({
    conta: user?.id || '',
    tela: 'custos',
    modo,
    codigo: base,
    dados: draft,
    // Um registro com id ainda começa com o payload padrão enquanto o GET está
    // em voo. Ativar o rascunho antes da hidratação transformava a resposta do
    // servidor em falsa "alteração não salva".
    ativo: trabalhoProntoParaSalvar,
    rotulo: `Custos ${base || '—'}`
  });

  const autosave = useAutosaveServidor({
    dados: draft,
    identidade: `custos:${modo || 'inicio'}:${base}:${revisionNumber}:${levantamentoOrigemId}`,
    ativo: trabalhoProntoParaSalvar && salvo === null,
    ocupado: salvando || salvandoRascunho || mostrarConfirmacao,
    salvar: async () => Boolean(await persistirRascunho(true))
  });

  // A cadeia do rodapé está completa: as quatro seções sabem dizer se pendem.
  const pendencias = pendenciasDe(draft, result);
  const guardas = {
    saving: salvando || salvandoRascunho,
    title: String(draft.title || ''),
    validPricing: Boolean(result.validPricing),
    salePrice: numberValue(result.salePrice)
  };
  const acao = footerAction(pendencias, guardas, secao);

  const codigo = base || '—';

  function trocarSecao(
    destino: CostSection,
    rolar = false,
    idPersistido = levantamentoAtualId
  ) {
    const proximos = parametrosDoLevantamentoAposAvanco(
      params,
      destino,
      idPersistido
    );
    setParams(proximos, { replace: true });
    if (rolar) {
      window.requestAnimationFrame(() =>
        rolarParaInicioDoFormulario(formularioRef.current)
      );
    }
  }

  /**
   * Persiste o levantamento incompleto pela conta antes de trocar de seção.
   * É o equivalente do "Salvar e continuar" da proposta: a validação integral
   * fica para a promoção a SALVO, mas o trabalho já não depende do navegador.
   */
  async function persistirRascunho(automatico = false): Promise<string | null> {
    if (!modo || salvandoRascunho || salvando) return null;
    if (levantamentoAtualId && !versaoDoRascunho) {
      setRecado('Aguarde o rascunho terminar de carregar antes de continuar.');
      return null;
    }

    setSalvandoRascunho(true);
    if (!automatico) setRecado('Salvando rascunho na sua conta...');
    const snapshot = draft;
    const entrada = {
      proposalCode: base,
      revisionNumber: modo === 'revision' ? revisionNumber : 0,
      title: String(draft.title || 'Rascunho de levantamento'),
      mode: modo === 'revision' ? ('REVISAO' as const) : ('NOVA' as const),
      status: 'RASCUNHO' as const,
      payload: snapshot
    };

    try {
      const gravado = levantamentoAtualId
        ? await atualizarLevantamento(levantamentoAtualId, entrada, {
            expectedUpdatedAt: versaoDoRascunho
          })
        : await criarLevantamento(entrada);

      setVersaoDoRascunho(gravado.updatedAt || '');
      if (!levantamentoAtualId) {
        const proximos = new URLSearchParams(params);
        proximos.set('id', gravado.id);
        setParams(proximos, { replace: true });
        atualCarregado.current = gravado.id;
      }
      rascunho.limparAtual();
      if (!automatico) {
        autosave.marcarSalvo(snapshot);
        setRecado('Rascunho salvo na sua conta.');
      }
      return gravado.id;
    } catch (error) {
      setRecado(mensagemDeErro(error, 'Não foi possível salvar o rascunho.'));
      return null;
    } finally {
      setSalvandoRascunho(false);
    }
  }

  function iniciarModo(novoModo: EstimateMode, numero?: string) {
    const proximos = new URLSearchParams();
    proximos.set('modo', novoModo);
    if (numero) proximos.set('base', numero);
    proximos.set('secao', 'premises');
    setParams(proximos, { replace: true });
  }

  function continuarLevantamento(levantamento: LevantamentoSalvo) {
    const proximos = new URLSearchParams({
      modo: levantamento.mode === 'REVISAO' ? 'revision' : 'new',
      base: levantamento.proposalCode,
      revisao: String(levantamento.revisionNumber || 0),
      id: levantamento.id,
      secao: levantamento.status === 'SALVO' ? 'summary' : 'premises'
    });
    setParams(proximos, { replace: true });
  }

  /**
   * "Novo orçamento" **reserva o número antes de abrir a tela**, como na referência.
   *
   * Reservar depois pareceria mais econômico — só gasta número quem salva. Mas o
   * código aparece no título e no rodapé desde o primeiro instante, e o orçamentista
   * o dita ao cliente enquanto monta o levantamento. Um número que só existe no fim
   * é um número em que não se pode confiar no meio.
   *
   * O preço disso é buraco na sequência quando alguém desiste. É aceitável: buraco
   * não confunde ninguém, número repetido sim.
   */
  async function iniciarNova() {
    setReservando(true);
    setRecado('Reservando o próximo número...');
    try {
      const numero = await reservarProximoNumero();
      setRecado('');
      iniciarModo('new', String(numero));
    } catch (error) {
      setRecado(mensagemDeErro(error, 'Não foi possível obter a numeração.'));
    } finally {
      setReservando(false);
    }
  }

  async function iniciarRevisao() {
    const procurado = baseDigitada.trim();
    if (!procurado || carregandoRevisao) return;

    setCarregandoRevisao(true);
    setRecado('Carregando o levantamento anterior...');
    try {
      const revisao = await prepararRevisaoDaProposta(procurado);
      let anterior = null;
      if (revisao.costEstimateId) {
        anterior = await obterLevantamento(revisao.costEstimateId);
        if (anterior.payload) {
          setDraft({
            ...anterior.payload,
            estimatorName: user?.name || anterior.payload.estimatorName || ''
          });
        }
        origemCarregada.current = revisao.costEstimateId;
      }

      const proximos = new URLSearchParams();
      proximos.set('modo', 'revision');
      proximos.set('base', String(revisao.base_number));
      proximos.set('revisao', String(revisao.nextRevision));
      proximos.set('secao', 'premises');
      if (revisao.costEstimateId)
        proximos.set('origem', revisao.costEstimateId);
      setParams(proximos, { replace: true });

      setMostrarRevisao(false);
      setRecado(
        anterior
          ? 'Levantamento anterior carregado por completo.'
          : 'A proposta não tem levantamento anterior; a revisão foi iniciada em branco com o número calculado.'
      );
    } catch (error) {
      setRecado(mensagemDeErro(error, 'Não foi possível carregar a revisão.'));
    } finally {
      setCarregandoRevisao(false);
    }
  }

  /**
   * Salva o levantamento.
   *
   * Os totais **não** vão no corpo: o servidor recalcula com `calculateEstimate` e
   * grava os seus. É o que impede forjar margem, e é por isso que o contrato Zod
   * recusa `salePrice` vindo do cliente.
   *
   * No `422`, as pendências do servidor viram vermelho **no campo** e a tela salta
   * para a primeira seção atingida — na ordem da tela, não na ordem em que o servidor
   * validou. O app já sabe o caminho; o que faltava era dizer.
   */
  async function salvar(criarPropostaDepois: boolean) {
    if (salvando || salvandoRascunho) return;
    if (levantamentoAtualId && !versaoDoRascunho) {
      setRecado('Aguarde o rascunho terminar de carregar antes de salvar.');
      return;
    }
    setSalvando(true);
    setRecado('Validando e salvando o levantamento...');
    let rascunhoSalvoId = '';

    try {
      const persistir = (status: 'RASCUNHO' | 'SALVO') => {
        const entrada = {
          proposalCode: base,
          revisionNumber: modo === 'revision' ? revisionNumber : 0,
          title: String(draft.title || ''),
          mode: modo === 'revision' ? 'REVISAO' : 'NOVA',
          status,
          payload: draft
        } as const;
        return levantamentoAtualId
          ? atualizarLevantamento(levantamentoAtualId, entrada, {
              expectedUpdatedAt: versaoDoRascunho
            })
          : criarLevantamento(entrada);
      };

      let gravado: Awaited<ReturnType<typeof persistir>>;
      try {
        gravado = await persistir('SALVO');
      } catch (error) {
        if (
          !criarPropostaDepois ||
          !(error instanceof ComercialValidationError)
        ) {
          throw error;
        }

        // A tentativa de criar a proposta não perde o trabalho, mas também não
        // contorna a validação: persiste o rascunho e devolve o usuário ao campo.
        const rascunhoGravado = await persistir('RASCUNHO');
        rascunhoSalvoId = rascunhoGravado.id;
        rascunho.limparTudo();
        setVersaoDoRascunho(rascunhoGravado.updatedAt || '');
        if (!levantamentoAtualId) atualCarregado.current = rascunhoGravado.id;
        throw error;
      }

      // T091: gravado no servidor, o rascunho local não pode sobrar para
      // reaparecer depois como se fosse trabalho não salvo.
      rascunho.limparTudo();
      setMostrarConfirmacao(false);
      setSalvo(gravado.id);
      setVersaoDoRascunho(gravado.updatedAt || '');

      if (criarPropostaDepois) {
        setRecado('');
        const parametrosDaProposta =
          parametrosDaPropostaComLevantamento(gravado);
        navigate(
          `${moduleRoutePath('comercial', 'propostas')}?${parametrosDaProposta.toString()}`
        );
        return;
      }

      if (!levantamentoAtualId) {
        const proximos = new URLSearchParams(params);
        proximos.set('id', gravado.id);
        setParams(proximos, { replace: true });
        atualCarregado.current = gravado.id;
      }
      setRecado('Levantamento salvo e disponível no histórico comercial.');
    } catch (error) {
      setMostrarConfirmacao(false);

      if (error instanceof ComercialValidationError) {
        const issues = error.issues.filter(item => item.severity !== 'warning');
        const destino = primeiraSecaoPendente(
          issues.map((item) => item.path || '').filter(Boolean)
        );
        aplicarIssuesDoServidor(issues, destino || secao);
        setFocarPendencia(true);
        if (destino) {
          trocarSecao(destino, false, rascunhoSalvoId || levantamentoAtualId);
        } else if (rascunhoSalvoId && !levantamentoAtualId) {
          const proximos = new URLSearchParams(params);
          proximos.set('id', rascunhoSalvoId);
          setParams(proximos, { replace: true });
        }
        const prefixo = rascunhoSalvoId ? 'Rascunho salvo. ' : '';
        setRecado(
          prefixo +
            (issues.length === 1
              ? 'Há 1 pendência. Ela está marcada no campo.'
              : `Há ${issues.length} pendências. Elas estão marcadas nos campos.`)
        );
      } else {
        setRecado(mensagemDeErro(error, 'Falha ao salvar o levantamento.'));
        window.requestAnimationFrame(() =>
          formularioRef.current?.parentElement?.querySelector('[role="alert"]')?.scrollIntoView({
            block: 'center',
            behavior: 'smooth'
          })
        );
      }
    } finally {
      setSalvando(false);
    }
  }

  async function abrirPropostaDoLevantamentoSalvo(id: string) {
    if (salvando) return;
    setSalvando(true);
    setRecado('Abrindo a criação da proposta...');
    try {
      const levantamentoSalvo = await obterLevantamento(id);
      const parametrosDaProposta =
        parametrosDaPropostaComLevantamento(levantamentoSalvo);
      navigate(
        `${moduleRoutePath('comercial', 'propostas')}?${parametrosDaProposta.toString()}`
      );
    } catch (error) {
      setRecado(
        mensagemDeErro(error, 'Não foi possível abrir a criação da proposta.')
      );
    } finally {
      setSalvando(false);
    }
  }

  /** Valida a conclusão mantendo os rótulos finais estáveis no resumo. */
  function concluirLevantamento(criarPropostaDepois: boolean) {
    const corrigindoPendencias = deveRevelarErrosAoAcionar(acao, secao, criarPropostaDepois);
    if (corrigindoPendencias) {
      revelarErros(acao.kind === 'goto' ? acao.target : secao);
    }

    if (acao.kind === 'goto') {
      void persistirRascunho().then((idPersistido) => {
        if (!idPersistido) return;
        trocarSecao(acao.target, !corrigindoPendencias, idPersistido);
        if (corrigindoPendencias) {
          setRecado(
            'Rascunho salvo. Corrija as pendências indicadas para concluir o levantamento.'
          );
          setFocarPendencia(true);
        }
      });
      return;
    }

    if (saveBlockedByContent(guardas)) {
      const semTitulo = !String(draft.title || '').trim();
      const destino = semTitulo ? 'premises' : 'summary';
      revelarErros(destino);

      if (criarPropostaDepois) {
        void persistirRascunho().then((idPersistido) => {
          if (!idPersistido) return;
          trocarSecao(destino, false, idPersistido);
          setRecado(
            'Rascunho salvo. Corrija o primeiro campo destacado antes de criar a proposta.'
          );
          setFocarPendencia(true);
        });
        return;
      }

      setRecado(
        semTitulo
          ? 'Informe o nome do levantamento antes de concluir.'
          : 'Revise a formação do preço no resumo antes de concluir o levantamento.'
      );
      trocarSecao(destino, false);
      setFocarPendencia(true);
      return;
    }

    if (criarPropostaDepois) {
      setMostrarConfirmacao(true);
      return;
    }
    void salvar(false);
  }

  return (
    <ComercialChrome
      eyebrow="FILTROVALI / LEVANTAMENTO DE CUSTOS"
      titulo={`Custos ${codigo}`}
      descricao="Engenharia de custos Filtrovali: equipe, circuitos, materiais, logística e formação do preço em um só lugar."
      /* Não abre sozinho: quem chegou aqui já passou pela entrada. O botão
         replica o roteiro DESTA tela. */
      acoes={<TutorialDoModulo passos={ROTEIRO_DOS_CUSTOS} />}
      heroExtra={
        modo !== null ? (
          <FaixaIndicadores
            levantamento={levantamento}
            modoLabel={
              modo === 'revision' ? `Revisão de ${base}` : 'Levantamento novo'
            }
          />
        ) : undefined
      }
    >
      {/* O diálogo só aparece quando NÃO há modo no endereço (FR-044): ele
            serve para escolher o modo, não para confirmá-lo. Recarregar com
            `?modo=` já definido volta direto ao trabalho. */}
      {modo === null && (
        <div
          className="com-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="com-modo-titulo"
        >
          <section className="com-painel com-modo-card">
            <BotaoFecharDialogo
              fechar={() => navigate(moduleRoutePath('comercial', 'index'))}
            />
            <img className="com-modo-logo" src={LOGO_URL} alt="Filtrovali" />
            <span className="com-eyebrow">LEVANTAMENTO DE CUSTOS</span>
            <h1 id="com-modo-titulo">Como deseja começar?</h1>
            <p>
              O levantamento será vinculado à proposta técnica e comercial com a
              mesma numeração.
            </p>

            <div className="com-modo-opcoes">
              <button type="button" disabled={reservando} onClick={iniciarNova}>
                <MarcaDeOpcao tipo="nova" />
                <strong>Novo orçamento</strong>
                <span>
                  Reserva o próximo número e inicia um levantamento por fases.
                </span>
              </button>

              <button type="button" onClick={() => setMostrarRevisao(true)}>
                <MarcaDeOpcao tipo="revisao" />
                <strong>Revisar orçamento</strong>
                <span>
                  Carrega o último levantamento e preserva toda a composição.
                </span>
              </button>
            </div>

            <section className="com-levantamentos-entrada" aria-live="polite">
              <div className="com-levantamentos-cabecalho">
                <div>
                  <strong>Orçamentos salvos</strong>
                  <span>Abra um levantamento recente e continue de onde parou.</span>
                </div>
                {!carregandoRecentes && (
                  <button
                    type="button"
                    className="com-btn com-btn-fantasma"
                    onClick={() => void carregarLevantamentosRecentes()}
                  >
                    Atualizar
                  </button>
                )}
              </div>

              {carregandoRecentes ? (
                <p>Carregando orçamentos...</p>
              ) : erroDosRecentes ? (
                <p className="com-recado">{erroDosRecentes}</p>
              ) : levantamentosRecentes.length === 0 ? (
                <p>Nenhum orçamento salvo está disponível.</p>
              ) : (
                <div className="com-levantamentos-lista">
                  {levantamentosRecentes.map(levantamento => (
                    <button
                      key={levantamento.id}
                      type="button"
                      onClick={() => continuarLevantamento(levantamento)}
                    >
                      <span>
                        <strong>
                          Proposta {levantamento.proposalCode}
                          {levantamento.revisionNumber > 0
                            ? ` · Rev ${levantamento.revisionNumber}`
                            : ''}
                        </strong>
                        <small>
                          {levantamento.title || 'Orçamento sem título'} ·{' '}
                          {levantamento.status === 'SALVO' ? 'Concluído' : 'Rascunho'} ·{' '}
                          Atualizado em {dataHora.format(new Date(levantamento.updatedAt))}
                        </small>
                      </span>
                      <b>Continuar</b>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {recado && <p className="com-recado">{recado}</p>}

            {mostrarRevisao && (
              <div className="com-revisao-entrada">
                <div className="field-group">
                  <label htmlFor="com-base-proposta">
                    Número da proposta existente
                  </label>
                  <input
                    id="com-base-proposta"
                    autoFocus
                    value={baseDigitada}
                    placeholder="Ex.: 4418"
                    onChange={(event) =>
                      setBaseDigitada(event.target.value.replace(/\D/g, ''))
                    }
                  />
                </div>
                <button
                  type="button"
                  className="com-btn com-btn-fantasma"
                  disabled={carregandoRevisao || !baseDigitada}
                  onClick={iniciarRevisao}
                >
                  {carregandoRevisao ? 'Carregando...' : 'Carregar revisão'}
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {mostrarConfirmacao && (
        <div
          className="com-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="com-confirmar-titulo"
        >
          <section className="com-painel com-modo-card">
            {/* Aqui fechar volta ao levantamento, não ao menu: este diálogo
                  interrompe um trabalho em andamento, e o trabalho continua. */}
            <BotaoFecharDialogo
              fechar={() => setMostrarConfirmacao(false)}
              rotulo="Fechar e voltar ao levantamento"
            />
            <img className="com-modo-logo" src={LOGO_URL} alt="Filtrovali" />
            <span className="com-eyebrow">VINCULAR LEVANTAMENTO</span>
            <h1 id="com-confirmar-titulo">Confirme a proposta</h1>
            <p>
              O levantamento, a proposta técnica e a comercial usarão o código{' '}
              <strong>{codigo}</strong>.
            </p>

            <div className="com-modo-opcoes com-modo-tres">
              <button
                type="button"
                disabled={salvando || salvandoRascunho}
                onClick={() => void salvar(true)}
              >
                <MarcaDeOpcao tipo="ok" />
                <strong>
                  {salvando || salvandoRascunho ? 'Salvando...' : `Confirmar ${codigo}`}
                </strong>
                <span>Salvar e abrir a criação das propostas.</span>
              </button>

              <button
                type="button"
                disabled={salvando || reservando}
                onClick={() => {
                  setMostrarConfirmacao(false);
                  iniciarNova();
                }}
              >
                <MarcaDeOpcao tipo="nova" />
                <strong>Trocar para nova</strong>
                <span>Reservar outra numeração.</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMostrarConfirmacao(false);
                  setParams(new URLSearchParams(), { replace: true });
                  setMostrarRevisao(true);
                }}
              >
                <MarcaDeOpcao tipo="revisao" />
                <strong>Trocar para revisão</strong>
                <span>Selecionar uma proposta existente.</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {modo !== null && (
        <>
          {/* L3 — a recuperação é OFERECIDA, nunca aplicada em silêncio.
                Restaurar sem perguntar é pior do que perder: o usuário abre a
                tela achando que começou do zero e digita por cima. */}
          {rascunho.oferta && (
            <section
              className="com-painel com-oferta-rascunho"
              role="alertdialog"
            >
              <div>
                <strong>Recuperar rascunho não salvo?</strong>
                <p>
                  Há trabalho deste levantamento guardado neste navegador,{' '}
                  {rascunho.idadeDaOferta}. Ele não chegou a ser salvo no
                  servidor.
                </p>
              </div>
              <div className="com-oferta-acoes">
                <button
                  type="button"
                  className="com-btn com-btn-primario"
                  onClick={() => {
                    const dados = rascunho.recuperar();
                    if (dados) setDraft(dados as Record<string, unknown>);
                  }}
                >
                  Recuperar
                </button>
                <button
                  type="button"
                  className="com-btn com-btn-fantasma"
                  onClick={rascunho.descartarOferta}
                >
                  Começar do zero
                </button>
              </div>
            </section>
          )}

          {/* Tira de seções. As abas são LIVRES: dá para pular para qualquer
                uma a qualquer momento. A cadeia do rodapé guia, não prende. */}
          <nav
            ref={formularioRef}
            className="com-workflow-nav"
            aria-label="Etapas do levantamento"
          >
            {SECOES.map((item, indice) => (
              <button
                key={item.value}
                type="button"
                className={secao === item.value ? 'is-ativa' : undefined}
                aria-current={secao === item.value ? 'step' : undefined}
                onClick={() => trocarSecao(item.value)}
              >
                <b aria-hidden="true">{indice + 1}</b>
                <span className="com-quebrar">{item.label}</span>
              </button>
            ))}
          </nav>

          <PendenciasDaSecao levantamento={levantamento} secao={secao} />

          {secao === 'premises' ? (
            <PremissasSection levantamento={levantamento} />
          ) : secao === 'labor' ? (
            <MaoDeObraSection levantamento={levantamento} />
          ) : secao === 'inputs' ? (
            <InsumosSection levantamento={levantamento} />
          ) : secao === 'logistics' ? (
            <LogisticaSection levantamento={levantamento} />
          ) : (
            <ResumoSection levantamento={levantamento} />
          )}

          {recado && (
            <p className="com-recado com-recado-tela" role="alert">
              {recado}
            </p>
          )}

          <footer className="com-rodape">
            <button
              type="button"
              className="com-btn com-btn-fantasma"
              onClick={() => navigate(moduleRoutePath('comercial', 'index'))}
            >
              Cancelar e voltar
            </button>

            <div className="com-codigo-vinculado">
              <small>LEVANTAMENTO E PROPOSTA</small>
              <strong>{codigo}</strong>
              {autosave.rotulo && (
                <span className={`com-autosave is-${autosave.estado}`} role="status">
                  {autosave.rotulo}
                </span>
              )}
            </div>

            <div className="com-rodape-acoes">
              {secao === 'summary' ? (
                <>
                  <button
                    type="button"
                    className="com-btn com-btn-fantasma"
                    disabled={salvando || salvandoRascunho || salvo !== null}
                    onClick={() => concluirLevantamento(false)}
                  >
                    {salvando
                      ? 'Salvando...'
                      : salvo
                        ? 'Levantamento salvo'
                        : 'Salvar'}
                  </button>
                  <button
                    type="button"
                    className="com-btn com-btn-primario"
                    disabled={salvando || salvandoRascunho}
                    onClick={() =>
                      salvo
                        ? void abrirPropostaDoLevantamentoSalvo(salvo)
                        : concluirLevantamento(true)
                    }
                  >
                    {salvando
                      ? 'Salvando...'
                      : salvo
                        ? 'Criar proposta com este levantamento'
                        : 'Finalizar e criar proposta'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="com-btn com-btn-fantasma"
                    disabled={salvando || salvandoRascunho || salvo !== null}
                    onClick={() => void persistirRascunho()}
                  >
                    {salvandoRascunho
                      ? 'Salvando rascunho...'
                      : 'Salvar rascunho'}
                  </button>

                  <button
                    type="button"
                    className="com-btn com-btn-primario"
                    disabled={
                      acao.disabled || salvo !== null || salvandoRascunho
                    }
                    onClick={() => concluirLevantamento(true)}
                  >
                    {salvo ? 'Levantamento salvo' : acao.label}
                  </button>
                </>
              )}
            </div>
          </footer>
        </>
      )}
    </ComercialChrome>
  );
}
