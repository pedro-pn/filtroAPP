import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  baixarDatabookPdf,
  baixarPreviaDatabook,
  criarPreviaDatabook,
  fetchDatabookDialogo,
  fetchDatabookRevisao,
  fetchDatabooks,
  gerarDatabook,
  prepararDatabook,
  prepararEdicaoDatabook,
  type DatabookIntervalo,
  type DatabookPrevia,
  type DatabookRevisao,
  type DatabookRevisaoPreparada
} from '../../api/databook';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/ToastContext';
import { Alert, Badge, Button, Field, Input, Spinner } from '../ui/ds';
import {
  ROTULO_STATUS_DATABOOK,
  dataBr,
  edicoesDoFormulario,
  erroIntervaloDatabook,
  formularioVazio,
  formatarResumoDatabook,
  formularioInicialDatabook,
  statusDatabookConcluido,
  validarFormularioDatabook,
  type DatabookFormulario,
  type ErrosFormularioDatabook
} from '../../utils/databook';
import { DatabookRevisaoForm } from './DatabookRevisaoForm';
import { DatabookPreviaDocumento } from './DatabookPreviaDocumento';
import { criarFilaPreviaDatabook, type PedidoPreviaDatabook } from '../../utils/databookPrevia';
import './ProjectDatabookDialog.css';

export interface DatabookProject {
  id: string;
  code: string;
  name: string;
}

interface ProjectDatabookDialogProps {
  project: DatabookProject;
  userId?: string;
  onClose: () => void;
}

type Etapa = 'intervalo' | 'revisao' | 'previa' | 'status';

function mensagemErro(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

async function baixar(revisao: Pick<DatabookRevisao, 'id' | 'doc' | 'revisao'>, fallbackDoc: string) {
  const blob = await baixarDatabookPdf(revisao.id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${revisao.doc || fallbackDoc}_Rev${revisao.revisao}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ProjectDatabookDialog({ project, userId, onClose }: ProjectDatabookDialogProps) {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const fecharRef = useRef<HTMLButtonElement>(null);
  const [campoEmEdicao, setCampoEmEdicao] = useState<string | null>(null);
  const [etapa, setEtapa] = useState<Etapa>('intervalo');
  const [intervalo, setIntervalo] = useState<DatabookIntervalo | null>(null);
  const [preparada, setPreparada] = useState<DatabookRevisaoPreparada | null>(null);
  const [form, setForm] = useState<DatabookFormulario>(formularioVazio);
  const [erros, setErros] = useState<ErrosFormularioDatabook>({});
  const [revisaoId, setRevisaoId] = useState<string | null>(null);
  const [previa, setPrevia] = useState<(DatabookPrevia & { formulario: string }) | null>(null);
  const [pdfPrevia, setPdfPrevia] = useState<Blob | null>(null);

  const formularioAtual = useRef(form);
  const origemAtual = useRef(preparada?.origem?.id);
  useEffect(() => { formularioAtual.current = form; origemAtual.current = preparada?.origem?.id; }, [form, preparada]);
  const [filaPrevia] = useState(() => criarFilaPreviaDatabook(async pedido => {
    const info = await criarPreviaDatabook(pedido.projetoId, {
      ...pedido.periodo, edicoes: edicoesDoFormulario(pedido.formulario), descricao: pedido.formulario.descricao.trim(),
      origemRevisaoId: pedido.dados.origem?.id
    });
    const pdf = await baixarPreviaDatabook(info.id);
    return { info, pdf, formulario: JSON.stringify(pedido.formulario) };
  }));

  const padraoQuery = useQuery({
    queryKey: ['databook', 'dialogo', project.id],
    queryFn: () => fetchDatabookDialogo(project.id)
  });
  const padrao = padraoQuery.data?.padrao ?? null;
  useEffect(() => {
    if (padrao && !intervalo) setIntervalo({ inicio: padrao.inicio, fim: padrao.fim });
  }, [padrao, intervalo]);

  const erroIntervalo = intervalo ? erroIntervaloDatabook(intervalo, padrao) : null;
  const resumoQuery = useQuery({
    queryKey: ['databook', 'resumo', project.id, intervalo?.inicio, intervalo?.fim],
    queryFn: () => fetchDatabookDialogo(project.id, intervalo ?? undefined),
    enabled: Boolean(intervalo && padrao && !erroIntervalo)
  });
  const historicoQuery = useQuery({
    queryKey: ['databook', 'lista', project.id],
    queryFn: () => fetchDatabooks(project.id)
  });
  const revisaoQuery = useQuery({
    queryKey: ['databook', 'revisao', revisaoId],
    queryFn: () => fetchDatabookRevisao(revisaoId as string),
    enabled: Boolean(revisaoId),
    refetchInterval: query => (statusDatabookConcluido(query.state.data?.status) ? false : 2_000)
  });
  const statusAtual = revisaoQuery.data?.status;
  useEffect(() => {
    if (statusDatabookConcluido(statusAtual)) void queryClient.invalidateQueries({ queryKey: ['databook', 'lista', project.id] });
  }, [statusAtual, project.id, queryClient]);

  const preparar = useMutation({
    mutationFn: (i: DatabookIntervalo) => prepararDatabook(project.id, i),
    onSuccess: dados => {
      setPreparada(dados);
      filaPrevia.limparCache();
      setForm(formularioInicialDatabook(dados, userId));
      setErros({});
      setPrevia(null);
      setPdfPrevia(null);
      setEtapa('revisao');
    },
    onError: error => showToast(mensagemErro(error), 'error')
  });
  const visualizar = useMutation({
    mutationFn: (pedido: PedidoPreviaDatabook) => filaPrevia.obter(pedido),
    onSuccess: ({ info, pdf, formulario }, pedido) => {
      // Uma resposta antiga não substitui os textos que estão sendo editados agora.
      if (formulario !== JSON.stringify(formularioAtual.current) || pedido.dados.origem?.id !== origemAtual.current) return;
      setPrevia({ ...info, formulario });
      setPdfPrevia(pdf);
    }
  });
  const editar = useMutation({
    mutationFn: (id: string) => prepararEdicaoDatabook(id),
    onSuccess: dados => {
      const formulario = formularioInicialDatabook(dados, userId);
      filaPrevia.limparCache();
      const periodo = { inicio: dados.resumo.inicio, fim: dados.resumo.fim };
      setPreparada(dados);
      setForm(formulario);
      setIntervalo(periodo);
      setErros({});
      setPrevia(null);
      setPdfPrevia(null);
      setEtapa('previa');
      visualizar.mutate({ projetoId: project.id, formulario, dados, periodo });
    },
    onError: error => showToast(mensagemErro(error), 'error')
  });
  const gerar = useMutation({
    mutationFn: async (pedido: PedidoPreviaDatabook) => {
      // Inclui o último caractere mesmo ao salvar sem sair do campo ou durante uma atualização.
      const { info } = await filaPrevia.obter(pedido);
      return gerarDatabook(project.id, { previaId: info.id });
    },
    onSuccess: revisao => {
      setRevisaoId(revisao.id);
      setEtapa('status');
      void queryClient.invalidateQueries({ queryKey: ['databook', 'lista', project.id] });
    },
    onError: error => {
      filaPrevia.limparCache();
      setPrevia(null);
      showToast(mensagemErro(error), 'error');
    }
  });
  const baixarPdf = useMutation({
    mutationFn: ({ revisao, doc }: { revisao: DatabookRevisao; doc: string }) => baixar(revisao, doc),
    onError: error => showToast(mensagemErro(error), 'error')
  });
  const revisaoBaixandoId = baixarPdf.isPending ? baixarPdf.variables.revisao.id : null;

  const resumoTexto = useMemo(() => formatarResumoDatabook(resumoQuery.data?.resumo), [resumoQuery.data]);
  const documento = previa?.documento || preparada?.documento;
  const previaAtual = Boolean(previa && previa.formulario === JSON.stringify(form));
  const ocupada = visualizar.isPending || gerar.isPending;
  const formularioChave = JSON.stringify(form);
  const falhaAtual = visualizar.isError && JSON.stringify(visualizar.variables?.formulario) === formularioChave;
  const atualizarPrevia = visualizar.mutate;
  useEffect(() => {
    if (etapa !== 'previa' || !preparada || !intervalo || campoEmEdicao || gerar.isPending || visualizar.isPending || previaAtual || falhaAtual) return;
    const timer = window.setTimeout(() => atualizarPrevia({ projetoId: project.id, formulario: form, dados: preparada, periodo: intervalo }), 450);
    return () => window.clearTimeout(timer);
  }, [etapa, preparada, intervalo, campoEmEdicao, gerar.isPending, visualizar.isPending, previaAtual, falhaAtual, project.id, form, atualizarPrevia]);

  function visualizarDocumento() {
    const novos = validarFormularioDatabook(form);
    setErros(novos);
    if (Object.keys(novos).length) {
      showToast('Revise os campos destacados.', 'error');
      return;
    }
    if (preparada && intervalo) {
      setEtapa('previa');
      atualizarPrevia({ projetoId: project.id, formulario: form, dados: preparada, periodo: intervalo });
    }
  }

  function editarCampoDoDocumento(id: string, valor: string) {
    const campo = previa?.campos?.find(item => item.id === id);
    if (!campo) return;
    setForm(atual => {
      const camposDocumento = { ...atual.camposDocumento };
      if (valor === campo.original) delete camposDocumento[id];
      else camposDocumento[id] = valor;
      return { ...atual, camposDocumento };
    });
  }

  const titulo = `Data Book · ${project.code} - ${project.name}`;
  let corpo;
  let rodape;
  if (etapa === 'intervalo') {
    corpo = (
      <div className="databook-dialog__intervalo">
        {padraoQuery.isLoading ? <Spinner label="Carregando relatórios do projeto" /> : null}
        {padraoQuery.isError ? <Alert tone="danger" title="Não foi possível carregar o projeto.">{mensagemErro(padraoQuery.error)}</Alert> : null}
        {padraoQuery.isSuccess && !padrao ? <Alert tone="info" title="Este projeto ainda não tem RDO aprovado.">O Data Book usa os RDOs e relatórios técnicos aprovados.</Alert> : null}
        {padrao && intervalo ? (
          <>
            <p className="databook-dialog__ajuda">
              Escolha os dias do Data Book. O padrão vai do primeiro RDO ({dataBr(padrao.inicio)}) ao último ({dataBr(padrao.fim)}); um intervalo parcial mantém o avanço acumulado do projeto inteiro.
            </p>
            <div className="databook-dialog__datas">
              <Field label="Início" required errorText={erroIntervalo && intervalo.inicio > intervalo.fim ? erroIntervalo : undefined}>
                <Input type="date" value={intervalo.inicio} min={padrao.inicio} max={padrao.fim}
                  onChange={e => setIntervalo({ ...intervalo, inicio: e.target.value })} />
              </Field>
              <Field label="Fim" required>
                <Input type="date" value={intervalo.fim} min={padrao.inicio} max={padrao.fim}
                  onChange={e => setIntervalo({ ...intervalo, fim: e.target.value })} />
              </Field>
            </div>
            {erroIntervalo ? <Alert tone="danger" title={erroIntervalo} /> : null}
            {!erroIntervalo ? (
              <p className="databook-dialog__resumo" aria-live="polite">
                {resumoQuery.isFetching ? 'Calculando o que entra no intervalo…' : resumoTexto}
              </p>
            ) : null}
          </>
        ) : null}
        <DatabookHistorico
          documentos={historicoQuery.data}
          carregando={historicoQuery.isLoading}
          revisaoBaixandoId={revisaoBaixandoId}
          onBaixar={(revisao, doc) => baixarPdf.mutate({ revisao, doc })}
          revisaoEditandoId={editar.isPending ? editar.variables : null}
          onEditar={id => editar.mutate(id)}
        />
      </div>
    );
    rodape = (
      <>
        <Button ref={fecharRef} variant="secondary" size="sm" type="button" onClick={onClose}>Fechar</Button>
        <Button variant="primary" size="sm" type="button" loading={preparar.isPending}
          disabled={!intervalo || Boolean(erroIntervalo) || !padrao || preparar.isPending || editar.isPending || !resumoQuery.data?.resumo?.dias}
          onClick={() => intervalo && preparar.mutate(intervalo)}>
          Continuar
        </Button>
      </>
    );
  } else if (etapa === 'revisao' && preparada) {
    corpo = (
      <>
        <p className="databook-dialog__ajuda">
          <strong>{documento?.doc} · Rev. {documento?.rev}</strong> · {dataBr(intervalo?.inicio)} a {dataBr(intervalo?.fim)} · {formatarResumoDatabook(preparada.resumo)}
        </p>
        <DatabookRevisaoForm preparada={preparada} form={form} erros={erros} disabled={ocupada}
          onChange={patch => setForm(atual => ({ ...atual, ...patch }))} />
      </>
    );
    rodape = (
      <>
        <Button variant="secondary" size="sm" type="button" disabled={ocupada} onClick={() => setEtapa('intervalo')}>Voltar</Button>
        <Button variant="primary" size="sm" type="button" loading={visualizar.isPending} disabled={ocupada} onClick={visualizarDocumento}>
          Visualizar prévia
        </Button>
      </>
    );
  } else if (etapa === 'previa' && preparada) {
    corpo = <>
      <p className="databook-dialog__ajuda">
        <strong>{documento?.doc} · Rev. {documento?.rev}</strong> · {dataBr(intervalo?.inicio)} a {dataBr(intervalo?.fim)}
      </p>
      <Alert tone="info" title={preparada.origem ? `Editando a partir da Rev. ${preparada.origem.revisao}` : 'Confira e edite antes de gerar'}>
        Ao salvar, será criada {documento?.rev === 0 ? 'a revisão inicial' : `uma nova revisão (Rev. ${documento?.rev})`}. As revisões anteriores permanecem no histórico.
      </Alert>
      <div className="databook-previa">
        <DatabookPreviaDocumento pdf={pdfPrevia} carregando={visualizar.isPending} desatualizada={!previaAtual}
          campos={previa?.campos || []} edicoes={form.camposDocumento || {}} disabled={gerar.isPending}
          onEditarCampo={editarCampoDoDocumento} onEdicaoAtiva={setCampoEmEdicao}
          erro={falhaAtual ? mensagemErro(visualizar.error) : undefined} onTentarNovamente={visualizarDocumento} />
      </div>
      {previa?.avisos.length ? <details className="databook-dialog__avisos">
        <summary>{previa.avisos.length} aviso(s) da prévia</summary>
        <ul>{previa.avisos.map((aviso, i) => <li key={i}>{aviso}</li>)}</ul>
      </details> : null}
    </>;
    rodape = <>
      <Button variant="secondary" size="sm" type="button" disabled={ocupada}
        onClick={() => setEtapa('revisao')}>Voltar</Button>
      <Button variant="primary" size="sm" type="button" loading={gerar.isPending} disabled={gerar.isPending || !pdfPrevia || falhaAtual}
        onClick={() => intervalo && gerar.mutate({ projetoId: project.id, formulario: form, dados: preparada, periodo: intervalo })}>{preparada.origem ? 'Salvar como nova revisão' : 'Gerar Data Book'}</Button>
    </>;
  } else {
    const revisao = revisaoQuery.data;
    corpo = (
      <div className="databook-dialog__status" aria-live="polite">
        {!revisao || !statusDatabookConcluido(revisao.status) ? (
          <Spinner label={revisao?.status === 'RUNNING' ? 'Gerando o PDF (cerca de 15 s a cada 20 dias)…' : 'Na fila de geração…'} />
        ) : null}
        {revisao?.status === 'COMPLETED' ? (
          <Alert tone="success" title={`${revisao.doc} Rev. ${revisao.revisao} pronto: ${revisao.paginas} páginas.`}>
            O PDF foi salvo no projeto e fica disponível no histórico deste diálogo.
          </Alert>
        ) : null}
        {revisao?.status === 'FAILED' ? <Alert tone="danger" title="A geração falhou.">{revisao.erro}</Alert> : null}
        {revisao?.avisos.length ? (
          <details className="databook-dialog__avisos">
            <summary>{revisao.avisos.length} aviso(s) registrados</summary>
            <ul>{revisao.avisos.map((a, i) => <li key={`${i}-${a}`}>{a}</li>)}</ul>
          </details>
        ) : null}
      </div>
    );
    rodape = (
      <>
        <Button variant="secondary" size="sm" type="button" onClick={onClose}>Fechar</Button>
        {revisao?.status === 'COMPLETED' ? (
          <Button variant="primary" size="sm" type="button"
            loading={revisaoBaixandoId === revisao.id} loadingLabel="Preparando download"
            disabled={baixarPdf.isPending}
            onClick={() => baixarPdf.mutate({ revisao, doc: documento?.doc || 'DataBook' })}>
            {revisaoBaixandoId === revisao.id ? 'Preparando download…' : 'Baixar PDF'}
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      size={etapa === 'previa' ? 'full' : 'lg'}
      appearance="design-system"
      panelClassName="databook-dialog rdo-ds-actions"
      ariaLabelledBy="databook-dialog-title"
      initialFocusRef={fecharRef}
      closeOnBackdrop={etapa === 'intervalo' || etapa === 'status'}
      closeOnEscape={!ocupada && !editar.isPending}
      showCloseButton={!ocupada && !editar.isPending}
      title={<h2 id="databook-dialog-title" className="databook-dialog__titulo">{titulo}</h2>}
      footer={rodape}
    >
      {corpo}
    </Modal>
  );
}

function DatabookHistorico({ documentos, carregando, revisaoBaixandoId, revisaoEditandoId, onBaixar, onEditar }: {
  documentos?: Awaited<ReturnType<typeof fetchDatabooks>>;
  carregando: boolean;
  revisaoBaixandoId: string | null;
  revisaoEditandoId: string | null;
  onBaixar: (revisao: DatabookRevisao, doc: string) => void;
  onEditar: (id: string) => void;
}) {
  if (carregando) return null;
  if (!documentos?.length) return null;
  return (
    <section className="databook-dialog__historico" aria-labelledby="databook-historico-titulo">
      <h3 id="databook-historico-titulo">Data Books gerados</h3>
      <ul>
        {documentos.flatMap(doc => doc.revisoes.map(r => (
          <li key={r.id}>
            <span><strong>{doc.doc} Rev. {r.revisao}</strong> · {dataBr(doc.inicio)} a {dataBr(doc.fim)} · {r.descricao}</span>
            <Badge tone={r.status === 'COMPLETED' ? 'success' : r.status === 'FAILED' ? 'danger' : 'info'}>{ROTULO_STATUS_DATABOOK[r.status]}</Badge>
            {r.status === 'COMPLETED' ? (
              <div className="databook-dialog__acoes-revisao">
                <Button variant="secondary" size="sm" type="button"
                  loading={revisaoEditandoId === r.id} disabled={revisaoEditandoId !== null}
                  aria-label={`Editar ${doc.doc} revisão ${r.revisao}`} onClick={() => onEditar(r.id)}>Editar</Button>
                <Button variant="secondary" size="sm" type="button"
                  loading={revisaoBaixandoId === r.id} loadingLabel="Preparando download"
                  disabled={revisaoBaixandoId !== null} onClick={() => onBaixar(r, doc.doc)}>
                  {revisaoBaixandoId === r.id ? 'Preparando download…' : 'Baixar'}
                </Button>
              </div>
            ) : null}
          </li>
        )))}
      </ul>
    </section>
  );
}
