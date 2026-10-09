import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  baixarDatabookPdf,
  fetchDatabookDialogo,
  fetchDatabookRevisao,
  fetchDatabooks,
  gerarDatabook,
  prepararDatabook,
  type DatabookIntervalo,
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

type Etapa = 'intervalo' | 'revisao' | 'status';

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
  const [etapa, setEtapa] = useState<Etapa>('intervalo');
  const [intervalo, setIntervalo] = useState<DatabookIntervalo | null>(null);
  const [preparada, setPreparada] = useState<DatabookRevisaoPreparada | null>(null);
  const [form, setForm] = useState<DatabookFormulario>(formularioVazio);
  const [erros, setErros] = useState<ErrosFormularioDatabook>({});
  const [revisaoId, setRevisaoId] = useState<string | null>(null);

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
      setForm(formularioInicialDatabook(dados, userId));
      setErros({});
      setEtapa('revisao');
    },
    onError: error => showToast(mensagemErro(error), 'error')
  });
  const gerar = useMutation({
    mutationFn: () => gerarDatabook(project.id, { ...(intervalo as DatabookIntervalo), edicoes: edicoesDoFormulario(form), descricao: form.descricao.trim() }),
    onSuccess: revisao => {
      setRevisaoId(revisao.id);
      setEtapa('status');
      void queryClient.invalidateQueries({ queryKey: ['databook', 'lista', project.id] });
    },
    onError: error => showToast(mensagemErro(error), 'error')
  });

  const resumoTexto = useMemo(() => formatarResumoDatabook(resumoQuery.data?.resumo), [resumoQuery.data]);
  const documento = preparada?.documento;

  function confirmarGeracao() {
    const novos = validarFormularioDatabook(form);
    setErros(novos);
    if (Object.keys(novos).length) {
      showToast('Revise os campos destacados.', 'error');
      return;
    }
    gerar.mutate();
  }

  async function baixarRevisao(revisao: DatabookRevisao, doc: string) {
    try {
      await baixar(revisao, doc);
    } catch (error) {
      showToast(mensagemErro(error), 'error');
    }
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
          onBaixar={(revisao, doc) => void baixarRevisao(revisao, doc)}
        />
      </div>
    );
    rodape = (
      <>
        <Button ref={fecharRef} variant="secondary" size="sm" type="button" onClick={onClose}>Fechar</Button>
        <Button variant="primary" size="sm" type="button" loading={preparar.isPending}
          disabled={!intervalo || Boolean(erroIntervalo) || !padrao || preparar.isPending || !resumoQuery.data?.resumo?.dias}
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
        <DatabookRevisaoForm preparada={preparada} form={form} erros={erros} disabled={gerar.isPending}
          onChange={patch => setForm(atual => ({ ...atual, ...patch }))} />
      </>
    );
    rodape = (
      <>
        <Button variant="secondary" size="sm" type="button" disabled={gerar.isPending} onClick={() => setEtapa('intervalo')}>Voltar</Button>
        <Button variant="primary" size="sm" type="button" loading={gerar.isPending} disabled={gerar.isPending} onClick={confirmarGeracao}>
          Gerar Data Book
        </Button>
      </>
    );
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
          <Button variant="primary" size="sm" type="button" onClick={() => void baixarRevisao(revisao, documento?.doc || 'DataBook')}>Baixar PDF</Button>
        ) : null}
      </>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      appearance="design-system"
      panelClassName="databook-dialog rdo-ds-actions"
      ariaLabelledBy="databook-dialog-title"
      initialFocusRef={fecharRef}
      closeOnBackdrop={etapa !== 'revisao'}
      title={<h2 id="databook-dialog-title" className="databook-dialog__titulo">{titulo}</h2>}
      footer={rodape}
    >
      {corpo}
    </Modal>
  );
}

function DatabookHistorico({ documentos, carregando, onBaixar }: {
  documentos?: Awaited<ReturnType<typeof fetchDatabooks>>;
  carregando: boolean;
  onBaixar: (revisao: DatabookRevisao, doc: string) => void;
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
              <Button variant="ghost" size="sm" type="button" onClick={() => onBaixar(r, doc.doc)}>Baixar</Button>
            ) : null}
          </li>
        )))}
      </ul>
    </section>
  );
}
