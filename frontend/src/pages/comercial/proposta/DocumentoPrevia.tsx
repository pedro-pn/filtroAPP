import type {
  ScopeBlock,
  ScopeServiceItem
} from '../../../../../shared/comercial/dist/scope-content.js';
import { scopeDescriptionParagraphs } from '../../../../../shared/comercial/dist/scope-descriptions.js';
import type { TechnicalServiceSelection } from '../../../../../shared/comercial/dist/technical-services.js';
import {
  INDICE_COMERCIAL,
  INDICE_TECNICO,
  NOTA_ATENDIMENTO_MONTADORA,
  NOTA_ATENDIMENTO_REVALIDACAO,
  NOTA_PRAZO_DESLOCAMENTO,
  TEXTO_PRAZOS_CRONOGRAMA,
  LINHAS_ASSINATURA,
  TEXTO_ACEITE,
  TEXTO_EXPLICACAO_STANDBY,
  TEXTO_IMPOSTOS,
  TEXTO_OBSERVACOES_GERAIS,
  TEXTO_PROPRIEDADE_INTELECTUAL,
  SERVICOS_EXTRA_ESCOPO,
  TITULO_BLOCO_STANDBY,
  fraseHoraExtra,
  observacoesTecnicasDoModelo,
  tabelasDePrecoDoModelo,
  tabelaStandby,
  textoJornada,
  type ModeloProposta
} from '../../../../../shared/comercial/dist/modelo-documento.js';
import {
  PROPOSAL_VISUAL_DEFINITIONS,
  type ProposalVisualDefinition
} from '../../../../../shared/comercial/dist/proposal-visuals.js';
import type { ItemDePreco, LinhaResponsabilidade } from './etapas';
import {
  folhasDaMatriz,
  paginasDoEscopo,
  paginasDasDescricoes,
  paginasTecnicas,
  tituloDoItemDeEscopo,
  type EntradaDaMatriz
} from './previaPaginacao';

/**
 * Prévia do documento, ao lado do formulário (`PROP-CTL-086..089`, `PROP-H-004..022`).
 *
 * Porte de `DocumentPreview` (`app/page.tsx`).
 *
 * **É metade da tela da referência, e a razão dela é essa mesma.** O orçamentista não
 * está preenchendo um cadastro: está montando um documento que vai ao cliente. Ver o
 * documento se formar enquanto se digita é o que faz alguém perceber que o título
 * ficou grande demais ou que o escopo saiu vazio — antes de gerar o PDF, não depois.
 *
 * As páginas têm proporção **1414/2000** e fundo de imagem: são o papel timbrado
 * oficial. A capa é só a imagem, sem texto por cima — o texto entra da página 2.
 */

type AnyRecord = Record<string, unknown>;

export type TipoDeDocumento = 'commercial' | 'technical';

const BASE = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const CAPA = {
  commercial: `${BASE}/assets/Comercial/proposta-capa-comercial.jpg`,
  technical: `${BASE}/assets/Comercial/proposta-capa-tecnica.jpg`
};
const PAGINA = `${BASE}/assets/Comercial/proposta-pagina.jpg`;

/**
 * Os índices vêm de `shared/comercial`, não daqui.
 *
 * Os que moravam neste arquivo eram inventados: prometiam "Know-how e
 * confidencialidade", "Segurança do trabalho" e "Contatos", que não existem em
 * documento nenhum, e omitiam Impostos, Observações e Aceite, que existem. Um
 * índice que não bate com o corpo é pior do que não ter índice — o cliente
 * procura a seção prometida e não acha.
 *
 * Os do módulo compartilhado batem palavra por palavra com o ÍNDICE dos `.docx`
 * e com o `COMMERCIAL_INDEX`/`TECHNICAL_INDEX` da referência, e há teste que
 * compara os três.
 */

/**
 * As imagens institucionais do documento.
 *
 * Elas nunca tinham sido copiadas da referência, e é por isso que esta prévia
 * vinha com texto inventado no lugar delas — "Desde 2005", "+700 projetos",
 * "20 estados". O documento diz outra coisa: 21 anos, +850 projetos, 22 estados.
 * Números errados numa proposta que vai ao cliente.
 *
 * A proporção de cada uma vem de `proposal-visuals.ts`, cópia byte a byte da
 * referência — é ela que impede a imagem de esticar quando a folha muda de
 * largura.
 */
const VISUAIS = PROPOSAL_VISUAL_DEFINITIONS;

function caminhoDoVisual(src: string) {
  return `${BASE}/assets/Comercial/${src.split('/').pop()}`;
}

function Visual({
  visual,
  largura
}: {
  visual: ProposalVisualDefinition;
  largura: string;
}) {
  return (
    <img
      className="com-doc-visual"
      src={caminhoDoVisual(visual.src)}
      alt=""
      aria-hidden="true"
      style={{ width: largura, aspectRatio: String(visual.aspectRatio) }}
    />
  );
}

function FaixaDeVisuais({
  visuais
}: {
  visuais: readonly ProposalVisualDefinition[];
}) {
  return (
    <div className="com-doc-faixa">
      {visuais.map((visual) => (
        <Visual key={visual.src} visual={visual} largura="100%" />
      ))}
    </div>
  );
}

/** Os sete serviços do quadro 1.1, na ordem em que o documento os dispõe. */
const SERVICOS_INSTITUCIONAIS = [
  'Limpeza química de tubulações e reservatórios (decapagem e passivação)',
  'Flushing secundário',
  'Filtragem absoluta',
  'Centrifugação e desidratação de óleo',
  'Flushing primário',
  'Passagem de PIG de espuma',
  'Teste de pressão (teste hidrostático)'
];

/**
 * A data por extenso do cabeçalho — "7 de janeiro de 2026", como no `.docx`.
 *
 * O meio-dia em UTC é o que a referência usa, e não é capricho: `new Date("2026-01-07")`
 * é meia-noite UTC, que em Brasília ainda é dia 6. A data do documento voltaria
 * um dia para todo mundo a oeste de Greenwich.
 */
function formatarData(iso: string): string {
  if (!iso) return '—';
  const quando = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(quando.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long',
    timeZone: 'UTC'
  }).format(quando);
}

function Pagina({
  numero,
  data,
  children
}: {
  numero: number;
  data: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="com-pagina"
      style={{ backgroundImage: `url(${PAGINA})` }}
      aria-label={`Página ${numero}`}
    >
      {/* Data no topo à direita e número no pé à direita — as duas posições do
          gerador, e as do cabeçalho/rodapé do .docx. Estavam juntas num rodapé
          só, com a data à esquerda. */}
      <span className="com-pagina-data">{formatarData(data)}</span>
      <div className="com-pagina-corpo">{children}</div>
      <span className="com-pagina-numero">{numero}</span>
    </section>
  );
}

export function DocumentoPrevia({
  tipo,
  form,
  codigo,
  itensEscopo,
  blocos,
  responsabilidades,
  precos,
  incluirUnitario,
  servicosTecnicos,
  complementoRelatorios,
  modelo = 'padrao'
}: {
  tipo: TipoDeDocumento;
  form: AnyRecord;
  codigo: string;
  itensEscopo: ScopeServiceItem[];
  blocos: ScopeBlock[];
  responsabilidades: LinhaResponsabilidade[];
  precos: ItemDePreco[];
  incluirUnitario: boolean;
  servicosTecnicos: TechnicalServiceSelection[];
  complementoRelatorios: string;
  modelo?: ModeloProposta;
}) {
  const tecnico = tipo === 'technical';
  const indice = tecnico ? INDICE_TECNICO : INDICE_COMERCIAL;
  const texto = (campo: string, padrao: string) =>
    String(form[campo] ?? '').trim() || padrao;

  const data = String(form.date ?? '');
  const responsabilidadesPreenchidas = responsabilidades.filter((linha) =>
    linha.item.trim()
  );

  /* A numeração das folhas é CALCULADA, não fixa: cada tabela ou foto do escopo
     empurra tudo o que vem depois. É o mesmo cálculo que o PDF fará. */
  const folhasDoEscopo = paginasDoEscopo(blocos);
  const folhasDasDescricoes = paginasDasDescricoes(
    scopeDescriptionParagraphs(itensEscopo, !tecnico)
  );
  const folhasDaResponsabilidade = folhasDaMatriz(responsabilidadesPreenchidas);
  const folhasTecnicas = tecnico
    ? paginasTecnicas(servicosTecnicos, complementoRelatorios)
    : [];

  /* A folha 3 é a institucional e a 4 abre com 1.3 e a seção 2 — o escopo
     começa na 5. Este número era 4 quando a institucional cabia numa folha só. */
  const PRIMEIRA_FOLHA_DE_ESCOPO = 4 + folhasDasDescricoes.length;
  const numeroDasResponsabilidades =
    PRIMEIRA_FOLHA_DE_ESCOPO + folhasDoEscopo.length;
  const numeroDosPrazos =
    numeroDasResponsabilidades + Math.max(1, folhasDaResponsabilidade.length);
  // A descrição de valores e o pagamento ocupam uma folha própria. Mantê-los
  // junto da jornada fazia o fim da página ser cortado na prévia fixa.
  const numeroDosValores = numeroDosPrazos + 1;
  const numeroDoFechamentoComercial = numeroDosValores + 1;
  const locaisDePreco = tabelasDePrecoDoModelo(modelo);
  const numeroDoFechamentoTecnico = numeroDosPrazos + folhasTecnicas.length + 1;

  return (
    <div className="com-documento">
      {/* A capa é só a imagem — o texto do documento começa na página 2. */}
      <section
        className="com-pagina com-pagina-capa"
        style={{ backgroundImage: `url(${CAPA[tipo]})` }}
        aria-label={`Capa da proposta ${tecnico ? 'técnica' : 'comercial'}`}
      />

      <Pagina numero={2} data={data}>
        <h2 className="com-doc-tipo">
          {tecnico ? 'Proposta Técnica' : 'Proposta Comercial'}
        </h2>

        <div className="com-doc-meta">
          <p>
            <b>Consultor de Vendas:</b> {texto('sellerName', 'Selecione')}
            <br />
            <b>Orçamentista:</b> {texto('estimator', 'Selecione')}
          </p>
          <h3>PROPOSTA Nº: {codigo}</h3>
          <p>
            <b>CLIENTE:</b> {texto('client', 'Nome do cliente')}
            <br />
            <b>A/C:</b> {texto('contact', 'Contato')}
            <br />
            <b>E-mail do solicitante:</b> {texto('email', 'email@cliente.com')}
            <br />
            <b>Departamento:</b> {texto('department', '-')}
            <br />
            <br />
            <b>Local da obra:</b> {texto('site', 'Local')}
            <br />
            <br />
            <b>CNPJ:</b> {texto('cnpj', '00.000.000/0000-00')}
          </p>
        </div>

        <h2 className="com-doc-indice-titulo">ÍNDICE</h2>
        <ol className="com-doc-indice">
          {indice.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </Pagina>

      {/* A página institucional do documento: texto, faixa de métricas, o quadro
          de sete serviços em duas colunas e as duas galerias. Estava reduzida a
          dois parágrafos escritos à mão, com números que não são os da empresa. */}
      <Pagina numero={3} data={data}>
        <h3>1. Filtrovali é a escolha certa para a sua obra</h3>
        <p>
          São 21 anos de história e entregas de soluções industriais, com
          excelência, segurança, qualidade e eficiência.
        </p>

        <Visual visual={VISUAIS.metrics} largura="100%" />

        <h3>1.1 Tradição, excelência e referência em serviços industriais</h3>
        {/* Duas colunas, como no documento: quatro serviços à esquerda e três à
            direita. Uma coluna só viraria uma lista corrida. */}
        <div className="com-doc-servicos-duas-colunas">
          <ul>
            {SERVICOS_INSTITUCIONAIS.slice(0, 4).map((servico) => (
              <li key={servico}>{servico}</li>
            ))}
          </ul>
          <ul>
            {SERVICOS_INSTITUCIONAIS.slice(4).map((servico) => (
              <li key={servico}>{servico}</li>
            ))}
          </ul>
        </div>

        <FaixaDeVisuais visuais={VISUAIS.serviceGallery} />

        <h3>1.2 Equipamentos modernos, revisados e de alto desempenho</h3>
        <FaixaDeVisuais visuais={VISUAIS.equipmentGallery} />
      </Pagina>

      {folhasDasDescricoes.map((folha, pagina) => (
        <Pagina numero={4 + pagina} data={data} key={`descricoes-${pagina}`}>
          {pagina === 0 && (
            <>
              <h3>
                1.3 Clientes que confiam e atestam a excelência da Filtrovali
              </h3>
              <Visual visual={VISUAIS.clients} largura="86%" />
            </>
          )}

          <h3>
            2. Descrição dos serviços que serão executados
            {pagina > 0 ? ' (continuação)' : ''}
          </h3>
          {folha.map((item) => (
            <p
              className={`com-doc-paragrafo${item.level === 2 ? ' is-subitem' : ''}`}
              key={item.key}
            >
              {!item.continuacao && (
                <>
                  <b>{item.number}</b>{' '}
                </>
              )}
              {item.text}
            </p>
          ))}
          {pagina === 0 &&
            folhasDasDescricoes.length === 1 &&
            folha.length === 0 && <p>Descreva os serviços na etapa Escopo.</p>}
        </Pagina>
      ))}

      {folhasDoEscopo.map((folha, i) => (
        <Pagina
          numero={PRIMEIRA_FOLHA_DE_ESCOPO + i}
          data={data}
          key={folha.chave}
        >
          <h3>{tituloDoItemDeEscopo(itensEscopo, folha.scopeItemId)}</h3>

          {folha.tipo === 'table' ? (
            <>
              <h4>
                {folha.rotulo}
                {folha.totalDePartes > 1
                  ? ` — parte ${folha.parte}/${folha.totalDePartes}`
                  : ''}
              </h4>
              <table className="com-doc-tabela">
                <thead>
                  <tr>
                    {folha.colunas.map((coluna, c) => (
                      <th key={`${folha.chave}-h-${c}`}>
                        {coluna || `Coluna ${c + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {folha.linhas.map((linha, l) => (
                    <tr key={`${folha.chave}-l-${l}`}>
                      {folha.colunas.map((_, c) => (
                        <td key={`${folha.chave}-c-${l}-${c}`}>
                          {linha[c] || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <figure className="com-doc-foto">
              <img
                src={folha.bloco.src}
                alt={folha.bloco.caption || folha.bloco.fileName}
              />
              <figcaption>
                {folha.rotulo}
                {folha.bloco.caption ? ` — ${folha.bloco.caption}` : ''}
              </figcaption>
            </figure>
          )}
        </Pagina>
      ))}

      {folhasDaResponsabilidade.length ? (
        folhasDaResponsabilidade.map((folha, i) => (
          <Pagina
            key={folha.chave}
            numero={numeroDasResponsabilidades + i}
            data={data}
          >
            {i === 0 && <h3>3. Matriz geral de responsabilidade</h3>}
            <BlocoDeResponsabilidade
              titulo={folha.titulo}
              entradas={folha.entradas}
            />
          </Pagina>
        ))
      ) : (
        <Pagina numero={numeroDasResponsabilidades} data={data}>
          <h3>3. Matriz geral de responsabilidade</h3>
          <BlocoDeResponsabilidade
            titulo="Responsabilidade da Filtrovali"
            entradas={[]}
          />
        </Pagina>
      )}

      <Pagina numero={numeroDosPrazos} data={data}>
        <h3>4. Previsão de atendimento</h3>
        <p>
          {texto('attendance', 'A definir')} após o recebimento do pedido de
          compras ou assinatura do contrato.
        </p>
        <p>{NOTA_ATENDIMENTO_MONTADORA}</p>
        <p>{NOTA_ATENDIMENTO_REVALIDACAO}</p>

        <h3>5. Prazo para execução dos serviços</h3>
        <p>{TEXTO_PRAZOS_CRONOGRAMA}</p>
        {/* As quatro linhas do documento, na ordem impressa. A de integração
            (`dias_treinamento`) saía aqui sem ter campo de origem — T071c. */}
        <ul className="com-doc-prazos">
          <li>
            Prazo previsto de permanência em obra (dias corridos) –{' '}
            {texto('permanence', 'a definir')};
          </li>
          <li>
            Prazo previsto para integração – {texto('integration', 'a definir')}
            ;
          </li>
          <li>
            Prazo previsto de execução dos serviços (dias trabalhados/úteis) –{' '}
            {texto('execution', 'a definir')};
          </li>
          <li>
            Prazo de deslocamento (Mob/desmob) –{' '}
            {texto('mobilization', 'a definir')}.
          </li>
        </ul>
        <p className="com-doc-nota">{NOTA_PRAZO_DESLOCAMENTO}</p>

        <h3>6. Jornada de trabalho</h3>
        <p className="com-doc-tecnico">
          {texto('workday', textoJornada(modelo))}
        </p>
      </Pagina>

      {!tecnico && (
        <Pagina numero={numeroDosValores} data={data}>
          <h3>7. Descrição dos valores</h3>
          {/* Hidrojateamento traz DUAS tabelas, cada uma com o seu TOTAL
                GERAL — são cenários alternativos de execução, não parcelas do
                mesmo serviço. Somá-las apresentaria um total que o cliente não
                vai pagar (T071f). */}
          {(locaisDePreco ?? [undefined]).map((local) => {
            const daTabela = local
              ? precos.filter((item) => item.local === local)
              : precos;
            return (
              <div key={local ?? 'unica'}>
                {local && <h4 className="com-doc-local">{local}:</h4>}
                <table className="com-doc-tabela">
                  <thead>
                    <tr>
                      <th>ITEM</th>
                      <th>DESCRIÇÃO</th>
                      {incluirUnitario && <th>VALOR UNIT.</th>}
                      <th>QTD.</th>
                      <th>VALOR TOTAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daTabela.map((item, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td>{item.description || 'Item'}</td>
                        {incluirUnitario && <td>{item.unitValue || 'R$ -'}</td>}
                        <td>{item.quantity || '1'}</td>
                        <td>{item.value || 'R$ -'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="com-doc-total">
                  <b>Total geral:</b> {somaDosPrecos(daTabela)}
                </p>
              </div>
            );
          })}

          {SERVICOS_EXTRA_ESCOPO.map((observacao) => (
            <p className="com-doc-nota" key={observacao}>
              {observacao}
            </p>
          ))}

          <h3>8. Condições de pagamento</h3>
          <p>{texto('payment', 'A definir')}</p>
        </Pagina>
      )}

      {folhasTecnicas.map((folha, i) => (
        <Pagina numero={numeroDosPrazos + i + 1} data={data} key={folha.chave}>
          <h3>
            {folha.titulo}
            {folha.totalDePartes > 1
              ? ` — ${folha.parte}/${folha.totalDePartes}`
              : ''}
          </h3>
          {/* `pre-wrap`: o texto técnico vem com quebras próprias, e colapsá-las
              transformaria a lista de etapas num parágrafo só. */}
          <p className="com-doc-tecnico">{folha.texto}</p>
        </Pagina>
      ))}

      {tecnico ? (
        <Pagina numero={numeroDoFechamentoTecnico} data={data}>
          <h3>9. Validade da proposta</h3>
          <p>{texto('validity', '10')} dias após a emissão.</p>

          <h3>10. Observações</h3>
          <p className="com-doc-tecnico">
            {observacoesTecnicasDoModelo(modelo)}
          </p>
          {String(form.technicalObservations ?? '').trim() && (
            <p className="com-doc-tecnico">
              {String(form.technicalObservations)}
            </p>
          )}
        </Pagina>
      ) : (
        /* O índice promete treze itens e a prévia parava no oitavo. Estes cinco
           fecham o documento comercial — e é onde a tabela de stand-by entra,
           no meio da prosa do item 9, como no Word. */
        <>
          <Pagina numero={numeroDoFechamentoComercial} data={data}>
            <h3>9. Observações</h3>
            <p>{fraseHoraExtra(dinheiro(form.overtimeRate))}</p>
            <p>
              <b>{TITULO_BLOCO_STANDBY}</b>
            </p>
            <table className="com-doc-tabela">
              <thead>
                <tr>
                  <th>ITEM</th>
                  <th>VALOR</th>
                </tr>
              </thead>
              <tbody>
                {tabelaStandby({
                  horaExtra: dinheiro(form.overtimeRate),
                  standbyEquipe: dinheiro(form.standbyTeam),
                  standbyEquipamento: dinheiro(form.standbyEquipment),
                  mobilizacaoExtra: dinheiro(form.extraMobilization)
                }).map(([rotulo, valor]) => (
                  <tr key={rotulo}>
                    <td>{rotulo}</td>
                    <td>{valor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="com-doc-tecnico">{TEXTO_EXPLICACAO_STANDBY}</p>
          </Pagina>

          <Pagina numero={numeroDoFechamentoComercial + 1} data={data}>
            <p className="com-doc-tecnico">
              {texto('observations', TEXTO_OBSERVACOES_GERAIS)}
            </p>

            <h3>10. Impostos</h3>
            <p className="com-doc-tecnico">{texto('taxes', TEXTO_IMPOSTOS)}</p>
          </Pagina>

          <Pagina numero={numeroDoFechamentoComercial + 2} data={data}>
            <h3>11. Validade da proposta</h3>
            <p>{texto('validity', '10')} dias após a emissão.</p>

            <h3>12. Proteção à propriedade intelectual e know-how</h3>
            <p className="com-doc-tecnico">{TEXTO_PROPRIEDADE_INTELECTUAL}</p>

            <h3>13. Aceite e assinatura da proposta</h3>
            <p className="com-doc-tecnico">{TEXTO_ACEITE}</p>
            <div className="com-doc-assinatura">
              {LINHAS_ASSINATURA.map((linha) => (
                <p key={linha}>{linha}</p>
              ))}
            </div>
          </Pagina>
        </>
      )}
    </div>
  );
}

function BlocoDeResponsabilidade({
  titulo,
  entradas
}: {
  titulo: string;
  entradas: EntradaDaMatriz[];
}) {
  return (
    <div className="com-doc-responsabilidade">
      <h4>{titulo}</h4>
      <table className="com-doc-tabela">
        <thead>
          <tr>
            <th>ITEM</th>
            <th>ESCOPO</th>
            <th>NOTA</th>
          </tr>
        </thead>
        <tbody>
          {entradas.length > 0 ? (
            entradas.map((entrada, i) =>
              entrada.tipo === 'categoria' ? (
                /* O subtítulo ocupa a largura da tabela, como no documento. */
                <tr key={`c-${i}`} className="com-doc-categoria">
                  <td colSpan={3}>{entrada.texto}</td>
                </tr>
              ) : (
                <tr key={`l-${i}`}>
                  <td>{entrada.numero}</td>
                  <td>
                    {entrada.item}
                    {entrada.subitens.length > 0 && (
                      <ul className="com-doc-subitens">
                        {entrada.subitens.map((subitem, s) => (
                          <li key={s}>{subitem}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>{entrada.nota}</td>
                </tr>
              )
            )
          ) : (
            <tr>
              <td colSpan={3}>—</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Desfaz a máscara de moeda para número.
 *
 * Mesma armadilha da soma dos preços: o ponto é separador de milhar e a vírgula
 * é o decimal, ao contrário do que `Number()` espera. Ler "R$ 11.250,00" com
 * `Number` daria `NaN`, e `NaN` formatado vira "R$ NaN" no documento.
 */
function dinheiro(valor: unknown): number {
  const limpo = String(valor ?? '').replace(/[^\d,.-]/g, '');
  const numero = Number(limpo.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(numero) ? numero : 0;
}

/**
 * Soma dos valores digitados.
 *
 * Os valores são texto com máscara ("R$ 38.000,00"), então a soma desfaz a
 * máscara antes: o ponto é separador de milhar e a vírgula é o decimal, ao
 * contrário do que `Number()` espera.
 */
function somaDosPrecos(precos: ItemDePreco[]): string {
  const total = precos.reduce((soma, item) => {
    const limpo = String(item.value || '').replace(/[^\d,.-]/g, '');
    const numero = Number(limpo.replace(/\./g, '').replace(',', '.'));
    return soma + (Number.isFinite(numero) ? numero : 0);
  }, 0);

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(total);
}
