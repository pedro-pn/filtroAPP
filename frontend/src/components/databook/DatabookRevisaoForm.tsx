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
  edicaoDocumento?: boolean;
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

export function DatabookRevisaoForm({ preparada, form, erros, disabled, edicaoDocumento, onChange }: DatabookRevisaoFormProps) {
  const { dados, sugestoes, avisos, resumo, responsaveis } = preparada;
  const opcoesResponsaveis = responsaveis.map(r => ({ value: r.id, label: r.cargo ? `${r.nome} – ${r.cargo}` : r.nome }));
  const estoqueFds = sugestoes.estoqueFds || [];
  const fdsAnexo = preparada.origem
    ? dados.fds.map(f => ({ arquivo: f.arquivo, nome: f.nome_comercial, produtos: [f.produto], confirmadoRomaneio: false }))
    : fdsResolvidas(sugestoes.fds, estoqueFds, form.vinculosFds);
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
        <p className="databook-revisao__ajuda">Edite os textos do documento e confira o resultado na prévia do PDF.</p>
        <Field label="Título do serviço (capa e cabeçalho)" data-databook-field="servico" required errorText={erros.servico}>
          <Input value={form.servico} disabled={disabled} maxLength={200} onChange={e => onChange({ servico: e.target.value })} />
        </Field>
        <Field label="Escopo" data-databook-field="escopo" optionalText="">
          <TextoFormatadoEditor ariaLabel="Escopo" minLinhas={3} value={form.escopo} disabled={disabled} onChange={escopo => onChange({ escopo })} />
          <AdequarAnotacaoButton campo="Escopo" valor={textoSemMarcacao(form.escopo)} disabled={disabled}
            onAplicar={texto => onChange({ escopo: marcacaoDeTextoPuro(texto) })} />
        </Field>
        <Field label="Resumo executivo" data-databook-field="resumoExecutivo" optionalText="">
          <TextoFormatadoEditor ariaLabel="Resumo executivo" minLinhas={5} value={form.resumoExecutivo} disabled={disabled} onChange={resumoExecutivo => onChange({ resumoExecutivo })} />
          <AdequarAnotacaoButton campo="Resumo executivo" valor={textoSemMarcacao(form.resumoExecutivo)} disabled={disabled}
            onAplicar={texto => onChange({ resumoExecutivo: marcacaoDeTextoPuro(texto) })} />
        </Field>
        <Field label="Destaques de SMS" data-databook-field="destaques" optionalText="" helperText="Um destaque por linha.">
          <Textarea rows={5} value={form.destaques} disabled={disabled} onChange={e => onChange({ destaques: e.target.value })} />
          <AdequarAnotacaoButton campo="Destaques de SMS" valor={form.destaques} disabled={disabled}
            onAplicar={texto => onChange({ destaques: destaquesDoTextoAdequado(texto) })} />
        </Field>
        <Field label="Considerações finais" data-databook-field="consideracoes" optionalText="">
          <TextoFormatadoEditor ariaLabel="Considerações finais" minLinhas={4} value={form.consideracoes} disabled={disabled} onChange={consideracoes => onChange({ consideracoes })} />
          <AdequarAnotacaoButton campo="Considerações finais" valor={textoSemMarcacao(form.consideracoes)} disabled={disabled}
            onAplicar={texto => onChange({ consideracoes: marcacaoDeTextoPuro(texto) })} />
        </Field>
        <div className="databook-revisao__grade">
          <Field label="Ocorrências de SMS" data-databook-field="ocorrenciasSms" required errorText={erros.ocorrenciasSms}>
            <Input inputMode="numeric" value={form.ocorrenciasSms} disabled={disabled} onChange={e => onChange({ ocorrenciasSms: e.target.value })} />
          </Field>
          <Field label="Descrição da revisão" data-databook-field="descricao" required errorText={erros.descricao}>
            <Input value={form.descricao} disabled={disabled} maxLength={200} onChange={e => onChange({ descricao: e.target.value })} />
          </Field>
        </div>
      </section>

      <section className="databook-revisao__secao" aria-labelledby="databook-resp-titulo">
        <h3 id="databook-resp-titulo">Responsáveis</h3>
        <div className="databook-revisao__grade">
          <Field label="Elaborado por (Filtrovali)" data-databook-field="elaborado" optionalText="">
            <Select value={form.elaborado} disabled={disabled} placeholder="Selecionar…" options={[
              ...(form.elaboradoSalvo?.nome ? [{ value: '__salvo', label: `${form.elaboradoSalvo.nome} · revisão original` }] : []), ...opcoesResponsaveis
            ]} onChange={e => onChange({ elaborado: e.target.value })} />
          </Field>
          <Field label="Verificado por (Filtrovali)" data-databook-field="verificado" optionalText="">
            <Select value={form.verificado} disabled={disabled} placeholder="Selecionar…" options={[
              ...(form.verificadoSalvo?.nome ? [{ value: '__salvo', label: `${form.verificadoSalvo.nome} · revisão original` }] : []), ...opcoesResponsaveis
            ]} onChange={e => onChange({ verificado: e.target.value })} />
          </Field>
          <Field label="Aprovado por (cliente) – nome" data-databook-field="aprovadoNome">
            <Input value={form.aprovadoNome} disabled={disabled} maxLength={160} onChange={e => onChange({ aprovadoNome: e.target.value })} />
          </Field>
          <Field label="Cargo (cliente)" data-databook-field="aprovadoCargo">
            <Input value={form.aprovadoCargo} disabled={disabled} maxLength={120} onChange={e => onChange({ aprovadoCargo: e.target.value })} />
          </Field>
        </div>
      </section>

      {resumo.rcpu ? (
        <section className="databook-revisao__secao" aria-labelledby="databook-limites-titulo">
          <h3 id="databook-limites-titulo">Limites aceitos nas contagens (RCPU)</h3>
          <p className="databook-revisao__ajuda">Opcional. Com limite, o Data Book mostra Conforme/Acima do limite e avisa medições fora dele.</p>
          <div className="databook-revisao__grade databook-revisao__grade--tres">
            <Field label="Classe ISO 4406" data-databook-field="limiteIso" helperText="Ex.: 16/14/11" errorText={erros.limiteIso}>
              <Input value={form.limiteIso} disabled={disabled} onChange={e => onChange({ limiteIso: e.target.value })} />
            </Field>
            <Field label="Classe NAS 1638" data-databook-field="limiteNas" errorText={erros.limiteNas}>
              <Input inputMode="decimal" value={form.limiteNas} disabled={disabled} onChange={e => onChange({ limiteNas: e.target.value })} />
            </Field>
            <Field label="Umidade máxima (ppm)" data-databook-field="limiteUmidade" errorText={erros.limiteUmidade}>
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
                    {preparada.origem ? <Badge tone="info">Da revisão original</Badge> : f.confirmadoRomaneio ? <Badge tone="success">No romaneio</Badge> : <Badge tone="warning">Fora do romaneio</Badge>}
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

      {edicaoDocumento ? (
        <section className="databook-revisao__secao" aria-labelledby="databook-complementos-titulo">
          <h3 id="databook-complementos-titulo">Textos complementares</h3>
          {([
            ['base_calculo', 'Base de cálculo'], ['intro_procedimento', 'Introdução ao procedimento'],
            ['intro_rcpu', 'Introdução às contagens (RCPU)'], ['intro_rtp', 'Introdução aos testes de pressão (RTP)'],
            ['nota_controle', 'Nota de controle']
          ] as const).map(([campo, label]) => (
            <Field key={campo} label={label} data-databook-field={`textosAdicionais.${campo}`}>
              <TextoFormatadoEditor ariaLabel={label} value={form.textosAdicionais?.[campo] || ''} disabled={disabled}
                onChange={valor => onChange({ textosAdicionais: { ...form.textosAdicionais, [campo]: valor } })} />
            </Field>
          ))}
        </section>
      ) : null}
      {edicaoDocumento && form.dias?.length ? (
        <section className="databook-revisao__secao" aria-labelledby="databook-dias-titulo">
          <h3 id="databook-dias-titulo">Registros diários e legendas</h3>
          {form.dias.map((dia, i) => {
            const alterarDia = (patch: Partial<typeof dia>) => onChange({ dias: form.dias?.map((d, j) => j === i ? { ...d, ...patch } : d) });
            return (
              <details key={dia.data} className="databook-revisao__dia">
                <summary>{dia.data} · {dia.resumo || 'Registro diário'}</summary>
                <Field label={`Resumo de ${dia.data}`} data-databook-field={`dias.${i}.resumo`}>
                  <Input value={dia.resumo || ''} disabled={disabled} maxLength={4000} onChange={e => alterarDia({ resumo: e.target.value })} />
                </Field>
                <Field label={`Comentário de ${dia.data}`} data-databook-field={`dias.${i}.comentario`}>
                  <TextoFormatadoEditor ariaLabel={`Comentário de ${dia.data}`} value={dia.comentario || ''} disabled={disabled} onChange={comentario => alterarDia({ comentario })} />
                </Field>
                {dia.atividades?.map((a, j) => (
                  <Field key={j} label={`Atividade ${j + 1} de ${dia.data}`} data-databook-field={`dias.${i}.atividades.${j}.texto`}>
                    <TextoFormatadoEditor ariaLabel={`Atividade ${j + 1} de ${dia.data}`} value={a.texto} disabled={disabled}
                      onChange={texto => alterarDia({ atividades: dia.atividades?.map((at, k) => k === j ? { texto } : at) })} />
                  </Field>
                ))}
                {dia.servicos?.map((s, j) => (
                  <div key={j} className="databook-revisao__secao">
                    {(['titulo', 'obs', 'laudo_observacao'] as const).map(campo => {
                      const label = `${{ titulo: 'Título', obs: 'Observações', laudo_observacao: 'Observação do laudo' }[campo]} do serviço ${j + 1} de ${dia.data}`;
                      return <Field key={campo} label={label} data-databook-field={`dias.${i}.servicos.${j}.${campo}`}>
                        <TextoFormatadoEditor ariaLabel={label} value={s[campo] || ''} disabled={disabled}
                          onChange={valor => alterarDia({ servicos: dia.servicos?.map((item, k) => k === j ? { ...item, [campo]: valor } : item) })} />
                      </Field>;
                    })}
                  </div>
                ))}
                {dia.fotos?.map((f, j) => (
                  <Field key={j} label={`Legenda da foto ${j + 1} de ${dia.data}`} data-databook-field={`dias.${i}.fotos.${j}.legenda`}>
                    <Input value={f.legenda || ''} disabled={disabled} maxLength={4000}
                      onChange={e => alterarDia({ fotos: dia.fotos?.map((foto, k) => k === j ? { legenda: e.target.value } : foto) })} />
                  </Field>
                ))}
              </details>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}
