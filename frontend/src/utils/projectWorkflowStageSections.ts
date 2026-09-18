import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

// Índice das seções da etapa. Cada ProjectWorkflowCategory renderizada dentro do provider se
// registra aqui com o próprio nó do DOM; a ordem do índice é lida do documento, então acompanha
// automaticamente a ordem em que as seções aparecem na etapa.
export type StageSectionTone = 'ok' | 'warn' | 'crit' | 'idle';

export type StageSectionMeta = {
  id: string;
  label: string;
  tone: StageSectionTone;
  count: string;
  /** Fração concluída (0–1), desenhada como anel no índice. */
  ratio: number;
  /** Grupo do índice em que a seção aparece. */
  group: string;
};

export type StageSectionEntry = StageSectionMeta & { node: HTMLElement; open: () => void };

type StageSectionRegistry = {
  register: (entry: StageSectionEntry) => void;
  unregister: (id: string) => void;
};

const StageSectionRegistryContext = createContext<StageSectionRegistry | null>(null);

function sameSections(current: StageSectionEntry[], next: StageSectionEntry[]) {
  return current.length === next.length && current.every((item, index) => {
    const other = next[index];
    return item.id === other.id && item.label === other.label && item.tone === other.tone && item.count === other.count
      && item.ratio === other.ratio && item.group === other.group && item.node === other.node;
  });
}

export function useStageSectionRegistry() {
  const entries = useRef(new Map<string, StageSectionEntry>());
  const frame = useRef<number | null>(null);
  const [sections, setSections] = useState<StageSectionEntry[]>([]);

  const schedule = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const ordered = [...entries.current.values()].sort((a, b) => (
        a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      ));
      setSections(current => sameSections(current, ordered) ? current : ordered);
    });
  }, []);

  // Zerar a referência ao cancelar é essencial: no StrictMode o React desmonta e remonta em
  // seguida, e uma referência órfã faria o schedule() achar que já existe atualização pendente.
  useEffect(() => {
    if (entries.current.size) schedule();
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [schedule]);

  const registry = useMemo<StageSectionRegistry>(() => ({
    register: entry => {
      entries.current.set(entry.id, entry);
      schedule();
    },
    unregister: id => {
      entries.current.delete(id);
      schedule();
    }
  }), [schedule]);

  const Provider = useCallback(({ children }: { children: ReactNode }) => (
    createElement(StageSectionRegistryContext.Provider, { value: registry }, children)
  ), [registry]);

  return { sections, Provider };
}

// Usado pela ProjectWorkflowCategory: publica a seção no índice enquanto ela estiver montada.
export function useStageSectionEntry(meta: StageSectionMeta, open: () => void) {
  const registry = useContext(StageSectionRegistryContext);
  const nodeRef = useRef<HTMLDetailsElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const { id, label, tone, count, ratio, group } = meta;

  useEffect(() => {
    const node = nodeRef.current;
    if (!registry || !node) return;
    registry.register({ id, label, tone, count, ratio, group, node, open: () => openRef.current() });
    return () => registry.unregister(id);
  }, [registry, id, label, tone, count, ratio, group]);

  return nodeRef;
}
