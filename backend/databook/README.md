# Gerador de Data Book – Filtrovali

Gera o PDF do Data Book (capa, controle do documento, sumário, dados gerais, resumo e curva de avanço,
procedimento, diário por dia com fotos, SMS e FDS anexadas) a partir de um JSON com os dados da missão.

## Conteúdo do pacote

| Caminho | O que é |
|---|---|
| `databook/generator.py` | Gerador (ReportLab + pypdf + Pillow). Função pública `gerar_databook(dados, saida, base_dir=None)` |
| `databook/schema.json` | JSON Schema da entrada – contrato entre o app e o gerador |
| `databook/__main__.py` | CLI: `python -m databook entrada.json saida.pdf` |
| `assets/logos/` | `logo_horizontal.png` (cabeçalho), `logo_horizontal_branco.png` (capa), `emblema_branco.png` (marca d'água) |
| `assets/fonts/` | Poppins (títulos) e Carlito (texto) – ambas SIL Open Font License 1.1 |
| `exemplo/missao_5815.json` | Entrada real (23 dias, 19 RLQs, 6 FDS) + `fotos/`. **Só local, fora do git** (dados de cliente e fotos verdadeiras) |
| `referencia/DataBook_exemplo_missao_5815.pdf` | Saída esperada do exemplo real (124 páginas). **Só local**; o teste pula quando ausente |
| `exemplo/projeto_completo.json` | Exemplo fictício com RDO + RLQ + RCPU + RTP + RLM, turno noturno, 2 RDOs no dia, dia sem RDO, Data Book parcial e certificados (fotos sintéticas em `exemplo/fotos_ficticias/`, FDS em `exemplo/fds_ficticias/` e certificados em `exemplo/certificados/`, todos gerados por `exemplo/gerar_fixtures.py`) |
| `referencia/DataBook_exemplo_projeto_completo.pdf` | Saída esperada para o exemplo completo (65 páginas) |
| `tests/` | Regressão (texto página a página contra as referências), schema e regras dos tipos novos |

## Rodar o exemplo

```bash
pip install -r requirements.txt
python -m databook exemplo/projeto_completo.json saida.pdf
```

A CLI imprime avisos de consistência (DDS com horário impossível, tag repetida, dia sem fotos, serviço finalizado
sem RLQ etc.). Os avisos não bloqueiam a geração; servem para revisão antes do envio ao cliente.

## Testes

```bash
cd backend/databook
pip install -r requirements.txt jsonschema
python -m unittest discover -s tests -v
```

## Uso no código

```python
from databook import gerar_databook
info = gerar_databook(dados, "/tmp/databook.pdf", base_dir="/caminho/das/fotos")
# info = {"arquivo": "...", "paginas": 124, "avisos": [...]}
```

## Regras que o gerador aplica sozinho

- **Avanço**: soma de `servicos[].concluidas` por dia sobre `escopo_total`. Dias sem produção aparecem em lilás no gráfico.
- **Laudo do dia**: APROVADO se algum serviço tem `laudo: "APROVADO"`; EM ANDAMENTO se algum serviço não está finalizado.
- **Fotos**: corrige rotação EXIF, reduz para 760 px (JPEG q72) e remove duplicadas do mesmo dia (mesma foto no RDO e no RLQ).
  Ordem = ordem da lista. Grade de 3 colunas; legenda "Foto {dia}.{n} · tipo · RDO/RLQ nº".
- **Paginação**: o documento é montado em passes até o sumário e o "Página X de Y" estabilizarem; as FDS recebem um
  carimbo discreto no rodapé com a numeração do Data Book.
- **Marcadores (bookmarks)** do PDF por seção, por dia e por anexo.

## Relatórios técnicos além do RLQ (campos opcionais)

Tudo o que foi acrescentado é opcional; um JSON só com RDO + RLQ gera exatamente o PDF original.

- `dias[].servicos[].tipo`: `RLQ` (padrão), `RCPU`, `RTP` ou `RLM`; `relatorio` = nº do relatório de origem
  (`rlq` continua aceito). Dados específicos em `rcpu: {...}` e `rtp: {...}` (ver `schema.json`).
- Seções técnicas: "Procedimento de Limpeza Química" só aparece com RLQ (ou FDS/etapas); "Contagem de Partículas
  e Análise de Umidade" com RCPU; "Teste de Pressão" com RTP. A numeração das seções e do diário se ajusta sozinha.
- `limites_rcpu` (`iso`, `nas`, `umidade_ppm`) habilita a coluna Limite/Resultado e o aviso de medição acima do limite.
- `certificados[]` vira o Anexo C (relação + divisória + PDF integral com carimbo), no mesmo padrão das FDS.
- `acumulado_inicial`: Data Book de um intervalo que não começa no início do projeto; o avanço soma a partir dele.
- `quantidade`/`concluidas`/`escopo_total` aceitam decimais (ex.: metros); `unidade_quantidade` troca o "un.".
- Turno noturno: `jornada_noturna`, `efetivo_noturno`, `horas_extras_noturno`, `dds_noturno`. Mais de um RDO no dia: `rdos_extras`.
- Avisos novos: laudo reprovado, medição acima do limite, certificado vencido na data do serviço, relatório técnico sem
  fotos, pressão de teste menor que a de trabalho, serviço finalizado sem relatório.

## Identidade visual

Cores no topo de `generator.py` (verde `#30503A`, azul `#11437E`, vermelho `#C81519`, lilás `#9B93A8`, fundo da capa `#22392A`).
Trocar logos = substituir os PNGs em `assets/logos/` mantendo os nomes.

## Integração no app (filtroAPP)

| Parte | Onde |
|---|---|
| Mapper `montarDadosDatabook(projetoId, inicio, fim)` | `backend/src/lib/databook/montar-dados.js` (+ `servicos.js`, `progresso.js`, `textos.js`, `anexos.js`) |
| Serviço (intervalo, revisão, edições, nº `DB-<projeto>-<seq>` e revisões) | `backend/src/lib/databook/service.js` |
| Job (fila no worker → `python -m databook … --json`) | `backend/src/lib/databook/jobs.js`, `python.js` |
| Rotas `/api/rdo/databook/*` (gestor e coordenador do RDO) | `backend/src/routes/resources/databook.js` |
| Tabelas `ProjectDatabook` / `ProjectDatabookRevision`; FDS no `StockItem` | migração `20261010120000_project_databooks` |
| Botão "Gerar Data Book", diálogo de intervalo e tela de revisão | `frontend/src/components/databook/` (gestor: Projetos e Arquivados; coordenador: Aprovados e Arquivados) |
| Cadastro de FDS (sinônimos do RLQ, código, revisão, data) | Estoque → produto químico; o PDF é o documento anexado ao item |

Fluxo: diálogo (padrão = 1º e último RDO aprovado) → tela de revisão (rascunho dos textos, responsáveis,
limites de RCPU, FDS e certificados sugeridos, avisos da pré-validação `--avisos`) → `POST gerar` cria a revisão
`PENDING` → o worker materializa fotos (HEIC → JPEG), FDS e certificados num diretório temporário, roda o gerador e
grava `<uploadDir>/Missão <código> - <nome>/DATABOOK/DB-…_Rev<n>.pdf`. Gerar de novo o mesmo intervalo cria a revisão
seguinte, com a linha no "Registro de revisões".

### Rodar localmente

```bash
# gerador
cd backend/databook && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt jsonschema
.venv/bin/python -m unittest discover -s tests -v

# backend: aponte o app para o venv (ou instale as libs no python3 do sistema)
export DATABOOK_PYTHON="$PWD/.venv/bin/python"
cd .. && npm test
```

Na imagem Docker o venv fica em `/opt/databook-venv` e `DATABOOK_PYTHON` já vem configurado (`backend/Dockerfile`).
O job roda no container `worker` (e na API quando `BACKGROUND_JOBS_IN_API=true`).

### Gerar o Data Book de um projeto real

1. Estoque → cada produto químico usado nos RLQs: anexe a FDS (PDF) e preencha "Nomes químicos no RLQ"
   (ex.: Barrilha → `Carbonato de sódio`), código, revisão e data da FDS.
2. RDO → gestor (Projetos ou Arquivados) ou coordenador (Aprovados ou Arquivados) → **Gerar Data Book**.
3. Ajuste o intervalo, **Continuar**, revise textos/responsáveis/anexos e os avisos, **Gerar Data Book**.
4. Acompanhe o status no diálogo e baixe o PDF; o histórico fica no mesmo diálogo.
