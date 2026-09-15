import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type EstadoDoAutosave =
  'inativo' | 'pendente' | 'salvando' | 'salvo' | 'erro';

const ATRASO_DO_AUTOSAVE_MS = 1800;

function assinatura(dados: unknown): string {
  try {
    return JSON.stringify(dados);
  } catch {
    return '';
  }
}

export function rotuloDoAutosave(estado: EstadoDoAutosave): string {
  if (estado === 'pendente')
    return 'Alterações aguardando salvamento automático';
  if (estado === 'salvando') return 'Salvando rascunho automaticamente...';
  if (estado === 'salvo') return 'Rascunho salvo automaticamente';
  if (estado === 'erro') return 'Não foi possível salvar automaticamente';
  return '';
}

/**
 * Autossalvamento no servidor com debounce e fila de uma única gravação.
 *
 * `identidade` representa o trabalho aberto, não o id criado pelo primeiro POST.
 * Assim, acrescentar o id à URL não redefine a base enquanto uma edição mais nova
 * aguarda a gravação seguinte.
 */
export function useAutosaveServidor({
  dados,
  identidade,
  ativo,
  ocupado = false,
  salvar
}: {
  dados: unknown;
  identidade: string;
  ativo: boolean;
  ocupado?: boolean;
  salvar: () => Promise<boolean>;
}) {
  const [estado, setEstado] = useState<EstadoDoAutosave>('inativo');
  const assinaturaAtual = useRef('');
  const assinaturaSalva = useRef('');
  const identidadePreparada = useRef('');
  const identidadeAtual = useRef(identidade);
  const salvando = useRef(false);
  const ativoRef = useRef(ativo);
  const ocupadoRef = useRef(ocupado);
  const salvarRef = useRef(salvar);
  const timer = useRef<number | null>(null);
  const executarRef = useRef<() => void>(() => {});

  ativoRef.current = ativo;
  ocupadoRef.current = ocupado;
  salvarRef.current = salvar;
  identidadeAtual.current = identidade;
  const assinaturaDosDados = useMemo(() => assinatura(dados), [dados]);
  assinaturaAtual.current = assinaturaDosDados;

  const cancelarTimer = useCallback(() => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const agendar = useCallback(() => {
    cancelarTimer();
    if (!ativoRef.current) return;
    timer.current = window.setTimeout(
      () => executarRef.current(),
      ATRASO_DO_AUTOSAVE_MS
    );
  }, [cancelarTimer]);

  const executar = useCallback(async () => {
    timer.current = null;
    if (!ativoRef.current || ocupadoRef.current || salvando.current) return;

    const enviada = assinaturaAtual.current;
    const identidadeEnviada = identidadeAtual.current;
    if (!enviada || enviada === assinaturaSalva.current) return;

    salvando.current = true;
    setEstado('salvando');
    let gravou: boolean;
    try {
      gravou = await salvarRef.current();
    } catch {
      gravou = false;
    } finally {
      salvando.current = false;
    }

    if (!ativoRef.current || identidadeAtual.current !== identidadeEnviada)
      return;
    if (!gravou) {
      setEstado('erro');
      return;
    }

    assinaturaSalva.current = enviada;
    if (assinaturaAtual.current !== assinaturaSalva.current) {
      setEstado('pendente');
      agendar();
    } else {
      setEstado('salvo');
    }
  }, [agendar]);

  executarRef.current = () => void executar();

  useEffect(() => {
    const atual = assinaturaDosDados;
    assinaturaAtual.current = atual;

    if (!ativo) {
      cancelarTimer();
      identidadePreparada.current = '';
      assinaturaSalva.current = '';
      setEstado('inativo');
      return;
    }

    if (identidadePreparada.current !== identidade) {
      cancelarTimer();
      identidadePreparada.current = identidade;
      assinaturaSalva.current = atual;
      setEstado('inativo');
      return;
    }

    if (!atual || atual === assinaturaSalva.current) {
      cancelarTimer();
      return;
    }

    if (salvando.current) return;
    setEstado('pendente');
    if (!ocupado) agendar();
  }, [ativo, cancelarTimer, assinaturaDosDados, identidade, ocupado, agendar]);

  useEffect(() => cancelarTimer, [cancelarTimer]);

  /** Informa ao hook que um salvamento manual já gravou este snapshot. */
  const marcarSalvo = useCallback(
    (dadosSalvos: unknown) => {
      assinaturaSalva.current = assinatura(dadosSalvos);
      if (assinaturaAtual.current === assinaturaSalva.current) {
        cancelarTimer();
        setEstado('salvo');
      } else {
        setEstado('pendente');
        agendar();
      }
    },
    [agendar, cancelarTimer]
  );

  return { estado, rotulo: rotuloDoAutosave(estado), marcarSalvo };
}
