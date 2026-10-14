import type { DatabookFdsCandidata, DatabookItemEstoqueFds, DatabookRevisaoPreparada } from '../../api/databook';
import { Alert, Badge, Field, Input, Select, Textarea } from '../ui/ds';
import { AdequarAnotacaoButton } from '../anotacoes/AdequarAnotacaoButton';
import { marcacaoDeTextoPuro, textoSemMarcacao } from '../../utils/textoFormatado';
import { DatabookOrtografiaSecao } from './DatabookOrtografiaSecao';
import { TextoFormatadoEditor } from './TextoFormatadoEditor';
import { fdsResolvidas, itemVinculadoFds, type DatabookFormulario, type ErrosFormularioDatabook } from '../../utils/databook';

interface DatabookRevisaoFormProps {
  preparada: DatabookRevisaoPreparada;
  form: DatabookFormulario;
  erros: ErrosFormularioDatabook;
  disabled?: boolean;
  onChange: (patch: Partial<DatabookFormulario>) => void;
}

// A IA devolve etapas com "*"/"-" e ";": nos destaques o PDF já põe o marcador de cada linha.
function destaquesDoTextoAdequado(texto: string) {
  return texto.split('\n').map(l => l.trim().replace(/^[*•●■-]+\s*/, '').replace(/;$/, '.')).filter(Boolean).join('\n');
}

const ROTULO_VINCULO: Record<string, { texto: string; tom: 'success' | 'warning' | 'danger' | 'info' }> = {
  exato: { texto: 'Cadastrado', tom: 'success' },
  aproximado: { texto: 'Por semelhança – confira', tom: 'warning' },
  duvida: { texto: 'Escolha o item', tom: 'danger' },
  nenhum: { texto: 'Sem correspondência', tom: 'danger' },
  manual: { texto: 'Escolhido aqui', tom: 'info' }
};

/** Sugestões por semelhança primeiro; depois os demais produtos químicos do Estoque. */
function opcoesDoVinculo(candidata: DatabookFdsCandidata, estoque: DatabookItemEstoqueFds[]) {
  const rotulo = (i: DatabookItemEstoqueFds) => `${i.nome}${i.documentoId ? '' : ' (sem FDS anexada)'}${i.confirmadoRomaneio ? ' · no romaneio' : ''}`;
  const sugeridos = (candidata.opcoes || []).map(o => estoque.find(i => i.stockItemId === o.stockItemId)).filter((i): i is DatabookItemEstoqueFds => Boolean(i));
  const ids = new Set(sugeridos.map(i => i.stockItemId));
  return [
    { value: '', label: 'Não vincular' },
    ...sugeridos.map(i => ({ value: i.stockItemId, label: `★ ${rotulo(i)}` })),
    ...estoque.filter(i => !ids.has(i.stockItemId)).map(i => ({ value: i.stockItemId, label: rotulo(i) }))
  ];
}

function alternar(lista: string[], valor: string, marcado: boolean) {
  return marcado ? [...new Set([...lista, valor])] : lista.filter(item => item !== valor);
}

export function DatabookRevisaoForm({ preparada, form, erros, disabled, onChange }: DatabookRevisaoFormProps) {
  const { dados, sugestoes, avisos, resumo, responsaveis } = preparada;
  const opcoesResponsaveis = responsaveis.map(r => ({ value: r.id, label: r.cargo ? `${r.nome} – ${r.cargo}` : r.nome }));
  const estoqueFds = sugestoes.estoqueFds || [];
  const fdsAnexo = fdsResolvidas(sugestoes.fds, estoqueFds, form.vinculosFds);
  const semFds = sugestoes.fds.filter(c => {
    const item = estoqueFds.find(i => i.stockItemId === itemVinculadoFds(c, form.vinculosFds));
    return !item?.documentoId;
  });

  function vincular(produto: string, stockItemId: string) {
    const documentoId = estoqueFds.find(i => i.stockItemId === stockItemId)?.documentoId;
    // A FDS do item recém-vinculado já entra marcada no Anexo B.
    onChange({
      vinculosFds: { ...form.vinculosFds, [produto]: stockItemId },
      ...(documentoId ? { fds: [...new Set([...form.fds, `stockdoc:${documentoId}`])] } : {})
    });
  }

  return (
    <div className="databook-revisao">
      <section className="databook-revisao__secao" aria-labelledby="databook-avisos-titulo">
        <h3 id="databook-avisos-titulo">Pré-validação</h3>
        {avisos.length ? (
          <Alert tone="warning" title={`${avisos.length} aviso${avisos.length === 1 ? '' : 's'} para conferir antes de gerar`}>
            <ul className="databook-revisao__avisos">
              {avisos.map((aviso, i) => <li key={`${i}-${aviso}`}>{aviso}</li>)}
            </ul>
          </Alert>
        ) : (
          <Alert tone="success" title="Nenhum aviso de consistência." />
        )}
      </section>

      <DatabookOrtografiaSecao preparada={preparada} correcoes={form.correcoes} disabled={disabled}
        onChange={correcoes => onChange({ correcoes })} />

      <section className="databook-revisao__secao" aria-labelledby="databook-textos-titulo">
        <h3 id="databook-textos-titulo">Textos</h3>
        <p className="databook-revisao__ajuda">Rascunho automático a partir dos relatórios. Edite à vontade; tags, horários e medições vêm dos relatórios e não mudam aqui.</p>
        <Field label="Título do serviço (capa e cabeçalho)" required errorText={erros.servico}>
          <Input value={form.servico} disabled={disabled} maxLength={200} onChange={e => onChange({ servico: e.target.value })} />
        </Field>
        <Field label="Escopo" optionalText="">
          <TextoFormatadoEditor ariaLabel="Escopo" minLinhas={3} value={form.escopo} disabled={disabled} onChange={escopo => onChange({ escopo })} />
          <AdequarAnotacaoButton campo="Escopo" valor={textoSemMarcacao(form.escopo)} disabled={disabled}
            onAplicar={texto => onChange({ escopo: marcacaoDeTextoPuro(texto) })} />
        </Field>
        <Field label="Resumo executivo" optionalText="">
          <TextoFormatadoEditor ariaLabel="Resumo executivo" minLinhas={5} value={form.resumoExecutivo} disabled={disabled} onChange={resumoExecutivo => onChange({ resumoExecutivo })} />
          <AdequarAnotacaoButton campo="Resumo executivo" valor={textoSemMarcacao(form.resumoExecutivo)} disabled={disabled}
            onAplicar={texto => onChange({ resumoExecutivo: marcacaoDeTextoPuro(texto) })} />
        </Field>
        <Field label="Destaques de SMS" optionalText="" helperText="Um destaque por linha.">
          <Textarea rows={5} value={form.destaques} disabled={disabled} onChange={e => onChange({ destaques: e.target.value })} />
          <AdequarAnotacaoButton campo="Destaques de SMS" valor={form.destaques} disabled={disabled}
            onAplicar={texto => onChange({ destaques: destaquesDoTextoAdequado(texto) })} />
        </Field>
        <Field label="Considerações finais" optionalText="">
          <TextoFormatadoEditor ariaLabel="Considerações finais" minLinhas={4} value={form.consideracoes} disabled={disabled} onChange={consideracoes => onChange({ consideracoes })} />
          <AdequarAnotacaoButton campo="Considerações finais" valor={textoSemMarcacao(form.consideracoes)} disabled={disabled}
            onAplicar={texto => onChange({ consideracoes: marcacaoDeTextoPuro(texto) })} />
        </Field>
        <div className="databook-revisao__grade">
          <Field label="Ocorrências de SMS" required errorText={erros.ocorrenciasSms}>
            <Input inputMode="numeric" value={form.ocorrenciasSms} disabled={disabled} onChange={e => onChange({ ocorrenciasSms: e.target.value })} />
          </Field>
          <Field label="Descrição da revisão" required errorText={erros.descricao}>
            <Input value={form.descricao} disabled={disabled} maxLength={200} onChange={e => onChange({ descricao: e.target.value })} />
          </Field>
        </div>
      </section>

      <section className="databook-revisao__secao" aria-labelledby="databook-resp-titulo">
        <h3 id="databook-resp-titulo">Responsáveis</h3>
        <div className="databook-revisao__grade">
          <Field label="Elaborado por (Filtrovali)" optionalText="">
            <Select value={form.elaborado} disabled={disabled} placeholder="Selecionar…" options={opcoesResponsaveis} onChange={e => onChange({ elaborado: e.target.value })} />
          </Field>
          <Field label="Verificado por (Filtrovali)" optionalText="">
            <Select value={form.verificado} disabled={disabled} placeholder="Selecionar…" options={opcoesResponsaveis} onChange={e => onChange({ verificado: e.target.value })} />
          </Field>
          <Field label="Aprovado por (cliente) – nome">
            <Input value={form.aprovadoNome} disabled={disabled} maxLength={160} onChange={e => onChange({ aprovadoNome: e.target.value })} />
          </Field>
          <Field label="Cargo (cliente)">
            <Input value={form.aprovadoCargo} disabled={disabled} maxLength={120} onChange={e => onChange({ aprovadoCargo: e.target.value })} />
          </Field>
        </div>
      </section>

      {resumo.rcpu ? (
        <section className="databook-revisao__secao" aria-labelledby="databook-limites-titulo">
          <h3 id="databook-limites-titulo">Limites aceitos nas contagens (RCPU)</h3>
          <p className="databook-revisao__ajuda">Opcional. Com limite, o Data Book mostra Conforme/Acima do limite e avisa medições fora dele.</p>
          <div className="databook-revisao__grade databook-revisao__grade--tres">
            <Field label="Classe ISO 4406" helperText="Ex.: 16/14/11" errorText={erros.limiteIso}>
              <Input value={form.limiteIso} disabled={disabled} onChange={e => onChange({ limiteIso: e.target.value })} />
            </Field>
            <Field label="Classe NAS 1638" errorText={erros.limiteNas}>
              <Input inputMode="decimal" value={form.limiteNas} disabled={disabled} onChange={e => onChange({ limiteNas: e.target.value })} />
            </Field>
            <Field label="Umidade máxima (ppm)" errorText={erros.limiteUmidade}>
              <Input inputMode="decimal" value={form.limiteUmidade} disabled={disabled} onChange={e => onChange({ limiteUmidade: e.target.value })} />
            </Field>
          </div>
        </section>
      ) : null}

      <section className="databook-revisao__secao" aria-labelledby="databook-fds-titulo">
        <h3 id="databook-fds-titulo">FDS anexadas (Anexo B)</h3>
        {sugestoes.fds.length ? (
          <>
            <p className="databook-revisao__ajuda">
              Produto químico de cada etapa do RLQ e o item do Estoque com a FDS. Quando o nome difere, o mais parecido é sugerido;
              o vínculo escolhido aqui fica salvo no Estoque como sinônimo e vale para os próximos Data Books.
            </p>
            <ul className="databook-revisao__ortografia">
              {sugestoes.fds.map(c => {
                const vinculo = Object.hasOwn(form.vinculosFds, c.produto) ? 'manual' : c.vinculo || (c.stockItemId ? 'exato' : 'nenhum');
                const rotulo = ROTULO_VINCULO[vinculo] || ROTULO_VINCULO.nenhum;
                return (
                  <li key={c.produto}>
                    <div className="databook-revisao__ortografia-palavra">
                      <strong>{c.produto}</strong>
                      <span><Badge tone={rotulo.tom}>{rotulo.texto}</Badge></span>
                    </div>
                    <Select
                      aria-label={`Item do Estoque para ${c.produto}`}
                      value={itemVinculadoFds(c, form.vinculosFds)}
                      disabled={disabled}
                      options={opcoesDoVinculo(c, estoqueFds)}
                      onChange={e => vincular(c.produto, e.target.value)}
                    />
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
        {fdsAnexo.length ? (
          <ul className="databook-revisao__anexos">
            {fdsAnexo.map(f => {
              const etapa = dados.fds.find(x => x.arquivo === f.arquivo)?.etapa;
              return (
                <li key={f.arquivo}>
                  <label>
                    <input type="checkbox" checked={form.fds.includes(f.arquivo)} disabled={disabled}
                      onChange={e => onChange({ fds: alternar(form.fds, f.arquivo, e.target.checked) })} />
                    <span><strong>{f.nome}</strong> · {f.produtos.join(' / ')}{etapa ? ` · ${etapa}` : ''}</span>
                    {f.confirmadoRomaneio ? <Badge tone="success">No romaneio</Badge> : <Badge tone="warning">Fora do romaneio</Badge>}
                  </label>
                </li>
              );
            })}
          </ul>
        ) : <p className="databook-revisao__ajuda">Nenhum produto químico com FDS vinculada nos RLQs do intervalo.</p>}
        {semFds.length ? (
          <p className="databook-revisao__ajuda">
            Sem FDS: {semFds.map(c => c.produto).join(', ')}. Vincule acima a um item do Estoque com a ficha anexada, ou anexe a FDS no Estoque e prepare de novo.
          </p>
        ) : null}
      </section>

      {sugestoes.certificados.length ? (
        <section className="databook-revisao__secao" aria-labelledby="databook-cert-titulo">
          <h3 id="databook-cert-titulo">Certificados de calibração (Anexo C)</h3>
          <ul className="databook-revisao__anexos">
            {sugestoes.certificados.map(c => (
              <li key={c.arquivo}>
                <label>
                  <input type="checkbox" checked={form.certificados.includes(c.arquivo)} disabled={disabled}
                    onChange={e => onChange({ certificados: alternar(form.certificados, c.arquivo, e.target.checked) })} />
                  <span><strong>{c.equipamento} {c.codigo}</strong>{c.certificado ? ` · ${c.certificado}` : ''}{c.validade ? ` · validade ${c.validade}` : ''}</span>
                  <Badge tone="info">{c.aplicacao}</Badge>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
