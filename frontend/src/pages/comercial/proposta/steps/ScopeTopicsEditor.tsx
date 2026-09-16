import { useEffect, useRef } from 'react';
import {
  MAX_SCOPE_TOPICS,
  MAX_SCOPE_TOPIC_DEPTH,
  MAX_SCOPE_SERVICE_DESCRIPTION_CHARACTERS,
  type ScopeTopic
} from '../../../../../../shared/comercial/dist/scope-content.js';
import {
  SCOPE_DESCRIPTION_TEMPLATES,
  createScopeTopic,
  splitScopeParagraphs
} from '../../../../../../shared/comercial/dist/scope-descriptions.js';
import { Area } from '../../components/Field';

function novoId() {
  return `topico-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function contar(topicos: ScopeTopic[]): number {
  return topicos.reduce((total, topico) => total + 1 + contar(topico.children ?? []), 0);
}

export function ScopeTopicsEditor({ topicos, numeros, onChange }: {
  topicos: ScopeTopic[];
  numeros: Map<string, string>;
  onChange: (topicos: ScopeTopic[]) => void;
}) {
  const restantes = MAX_SCOPE_TOPICS - contar(topicos);
  const editorRef = useRef<HTMLElement>(null);
  const topicoParaFocar = useRef('');
  useEffect(() => {
    if (!topicoParaFocar.current) return;
    const campo = editorRef.current?.querySelector<HTMLSelectElement>(
      `[data-scope-topic-id="${topicoParaFocar.current}"] select`
    );
    campo?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    campo?.focus({ preventScroll: true });
    topicoParaFocar.current = '';
  }, [topicos]);

  function novoTopico() {
    const topico = createScopeTopic(novoId());
    topicoParaFocar.current = topico.id;
    return topico;
  }

  function lista(itens: ScopeTopic[], atualizar: (itens: ScopeTopic[]) => void, nivel = 1) {
    return itens.map((topico, indice) => {
      const numero = numeros.get(topico.id) ?? 'novo';
      const editar = (alteracoes: Partial<ScopeTopic>) => atualizar(
        itens.map(item => item.id === topico.id ? { ...item, ...alteracoes } : item)
      );
      const mover = (direcao: -1 | 1) => {
        const proximos = [...itens];
        [proximos[indice], proximos[indice + direcao]] = [proximos[indice + direcao], proximos[indice]];
        atualizar(proximos);
      };
      const separarParagrafos = () => {
        const textos = splitScopeParagraphs(topico.text);
        if (textos.length < 2 || textos.length - 1 > restantes) return;
        atualizar(itens.flatMap(item => item.id !== topico.id ? [item] : textos.map((text, i) => ({
          ...item, id: i === 0 ? item.id : novoId(), text,
          children: i === textos.length - 1 ? item.children : undefined
        }))));
      };
      return (
        <div className="com-escopo-topico" key={topico.id} data-scope-topic-id={topico.id}>
          <div className="com-escopo-topico-cabecalho">
            <strong>{nivel === 1 ? 'Tópico' : 'Subitem'} {numero}</strong>
            <div className="com-fase-acoes">
              <button type="button" className="com-btn com-btn-fantasma" disabled={indice === 0}
                aria-label={`Mover tópico ${numero} para cima`} onClick={() => mover(-1)}>↑</button>
              <button type="button" className="com-btn com-btn-fantasma" disabled={indice === itens.length - 1}
                aria-label={`Mover tópico ${numero} para baixo`} onClick={() => mover(1)}>↓</button>
              <button type="button" className="com-remover" aria-label={`Remover tópico ${numero}`}
                onClick={() => atualizar(itens.filter(item => item.id !== topico.id))}>×</button>
            </div>
          </div>
          <div className="field-group">
            <label htmlFor={`modelo-${topico.id}`}>Texto padrão do tópico {numero}</label>
            <select id={`modelo-${topico.id}`} value={topico.templateId ?? ''}
              onChange={evento => {
                if (!evento.target.value) { editar({ templateId: undefined }); return; }
                const modelo = createScopeTopic(novoId(), evento.target.value);
                editar({
                  text: modelo.text, templateId: modelo.templateId,
                  // Trocar o texto do pai não apaga subitens já escritos.
                  children: topico.children?.length ? topico.children : modelo.children
                });
              }}>
              <option value="">Texto livre / personalizado</option>
              {SCOPE_DESCRIPTION_TEMPLATES.map(modelo => (
                <option key={modelo.id} value={modelo.id} title={modelo.description}
                  disabled={Boolean(modelo.subitems?.length && !topico.children?.length &&
                    (nivel >= MAX_SCOPE_TOPIC_DEPTH || restantes < modelo.subitems.length))}>
                  {modelo.title}
                </option>
              ))}
            </select>
          </div>
          <div onBlur={separarParagrafos}>
            <Area label={`Texto do tópico ${numero}`} value={topico.text}
              maxLength={MAX_SCOPE_SERVICE_DESCRIPTION_CHARACTERS}
              placeholder="Selecione um texto padrão acima ou escreva o seu texto."
              onChange={text => editar({ text })} />
          </div>
          <div className="com-escopo-topico-acoes">
            <button type="button" className="com-btn com-btn-fantasma" disabled={restantes <= 0}
              aria-label={`Adicionar tópico após ${numero}`}
              onClick={() => atualizar([...itens.slice(0, indice + 1), novoTopico(), ...itens.slice(indice + 1)])}>
              ＋ Tópico
            </button>
            <button type="button" className="com-btn com-btn-fantasma"
              disabled={restantes <= 0 || nivel >= MAX_SCOPE_TOPIC_DEPTH}
              aria-label={`Adicionar subitem de ${numero}`}
              onClick={() => editar({ children: [...(topico.children ?? []), novoTopico()] })}>
              ＋ Subitem
            </button>
          </div>
          {!!topico.children?.length && (
            <div className="com-escopo-topicos-filhos">
              {lista(topico.children, children => editar({ children }), nivel + 1)}
            </div>
          )}
        </div>
      );
    });
  }

  return (
    <section className="com-escopo-topicos" aria-label="Tópicos da descrição do serviço" ref={editorRef}>
      <p>Escolha um texto padrão em cada tópico e edite à vontade. Use “Subitem” para criar níveis como 2.2.1. A numeração é automática; não precisa digitá-la.</p>
      {lista(topicos, onChange)}
      <button type="button" className="com-btn-add" disabled={restantes <= 0}
        onClick={() => onChange([...topicos, novoTopico()])}>
        ＋ Adicionar tópico
      </button>
    </section>
  );
}
