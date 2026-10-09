import type { DatabookRevisaoPreparada } from '../../api/databook';
import { Alert, Badge, Field, Input, Select, Textarea } from '../ui/ds';
import { DatabookOrtografiaSecao } from './DatabookOrtografiaSecao';
import type { DatabookFormulario, ErrosFormularioDatabook } from '../../utils/databook';

interface DatabookRevisaoFormProps {
  preparada: DatabookRevisaoPreparada;
  form: DatabookFormulario;
  erros: ErrosFormularioDatabook;
  disabled?: boolean;
  onChange: (patch: Partial<DatabookFormulario>) => void;
}

function alternar(lista: string[], valor: string, marcado: boolean) {
  return marcado ? [...new Set([...lista, valor])] : lista.filter(item => item !== valor);
}

export function DatabookRevisaoForm({ preparada, form, erros, disabled, onChange }: DatabookRevisaoFormProps) {
  const { dados, sugestoes, avisos, resumo, responsaveis } = preparada;
  const opcoesResponsaveis = responsaveis.map(r => ({ value: r.id, label: r.cargo ? `${r.nome} – ${r.cargo}` : r.nome }));
  const candidataPorProduto = new Map(sugestoes.fds.map(c => [c.produto, c]));
  const fdsSemCadastro = sugestoes.fds.filter(c => !c.stockItemId || c.motivo === 'sem arquivo de FDS');

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
        <Field label="Escopo">
          <Textarea rows={3} value={form.escopo} disabled={disabled} onChange={e => onChange({ escopo: e.target.value })} />
        </Field>
        <Field label="Resumo executivo">
          <Textarea rows={5} value={form.resumoExecutivo} disabled={disabled} onChange={e => onChange({ resumoExecutivo: e.target.value })} />
        </Field>
        <Field label="Destaques de SMS" helperText="Um destaque por linha.">
          <Textarea rows={5} value={form.destaques} disabled={disabled} onChange={e => onChange({ destaques: e.target.value })} />
        </Field>
        <Field label="Considerações finais">
          <Textarea rows={4} value={form.consideracoes} disabled={disabled} onChange={e => onChange({ consideracoes: e.target.value })} />
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
            <Field label="Classe ISO 4406" errorText={erros.limiteIso}>
              <Input placeholder="16/14/11" value={form.limiteIso} disabled={disabled} onChange={e => onChange({ limiteIso: e.target.value })} />
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
        {dados.fds.length ? (
          <ul className="databook-revisao__anexos">
            {dados.fds.map(f => {
              const candidata = candidataPorProduto.get(f.produto.split(' / ')[0]);
              return (
                <li key={f.arquivo}>
                  <label>
                    <input type="checkbox" checked={form.fds.includes(f.arquivo)} disabled={disabled}
                      onChange={e => onChange({ fds: alternar(form.fds, f.arquivo, e.target.checked) })} />
                    <span><strong>{f.nome_comercial}</strong> · {f.produto}{f.etapa ? ` · ${f.etapa}` : ''}</span>
                    {candidata?.confirmadoRomaneio ? <Badge tone="success">No romaneio</Badge> : <Badge tone="warning">Fora do romaneio</Badge>}
                  </label>
                </li>
              );
            })}
          </ul>
        ) : <p className="databook-revisao__ajuda">Nenhum produto químico com FDS cadastrada nos RLQs do intervalo.</p>}
        {fdsSemCadastro.length ? (
          <p className="databook-revisao__ajuda">
            Sem FDS no Estoque: {fdsSemCadastro.map(c => c.produto).join(', ')}. Cadastre a ficha no produto químico do Estoque (com o nome do RLQ como sinônimo) e prepare de novo.
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
