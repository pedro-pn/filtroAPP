# Prévia da reorganização do acompanhamento

Esta versão parte da tela real. O botão **Tela atual** monta o `ProjectCardsBoard`
e o `ProjectDetailDashboard` de produção. **Reorganizada** monta cópias isoladas
com os mesmos dados, estilos, consultas e controles. As rotas de produção não
importam nenhum arquivo desta pasta.

A folha adicional ajusta agrupamento, espaçamento, títulos e expansão de conteúdo.
Cabeçalho verde, AppShell, navegação, tipografia, cores, cartões, gráficos,
alertas, tabelas, formulários e modais vêm dos arquivos atuais do app.

## Organização proposta

- **Consumo de gastos**, **Evolução** e **Composição do avanço** ficam na mesma
  linha perto do cabeçalho, em três cards independentes e mais estreitos. Composição dos
  custos, maiores gastos, custos manuais e últimos dias
  começam abertos. O card de **Último RDO** fica junto dos indicadores de tempo.
  **Ver relatórios** usa a variante verde primária do app.
- A seção de visão geral e a leitura rápida saem. **Evolução** reúne os
  indicadores de tempo e o gráfico logo abaixo. A composição por serviço fica
  no terceiro card, ao lado de Evolução. No celular, os três cards ficam empilhados.
- **Colaboradores na obra** fica logo após evolução, seguido da meta semanal.
- O painel semanal mantém os cálculos, cenários, métricas, regras, versões e
  controles existentes. A tabela mostra previsto, realizado, diferença e
  situação. Autor, versões e ações ficam em **Detalhes e edição das metas**.
  O contador inclui somente semanas encerradas com comparação válida.
- Prazos e planejamento sai da página; o editor de cronograma do topo permanece.
- **Gastos e retorno** é um único card que reúne faturamento e impostos,
  impostos do projeto e faturamentos realizados. As três áreas ficam lado a
  lado no desktop, com divisórias discretas, e empilhadas no celular dentro do
  mesmo card. O cabeçalho permite recolher todo o conteúdo de uma vez. A lista
  de notas mantém o layout compacto já disponível no DataTable.
- **Qualidade e gestão** e **Recursos e rastreabilidade** têm cabeçalhos fixos,
  sem recolher/expandir. Seus cards brancos de desvios, notas, equipamentos e
  avanço diário mantêm os controles individuais de abertura.
- Os títulos de seção têm 18 px com o mesmo peso. Os cards podem ser recolhidos
  ou expandidos pelo cabeçalho, inclusive gastos, evolução, serviços e metas.
  Os estados iniciais de abertura dos cards são preservados. Recolher mantém os
  valores dos formulários; ações do cabeçalho abrem o conteúdo automaticamente.
- Na listagem, os mesmos cards conservam barras, alertas e ações de gestão;
  informações complementares ficam em **Detalhes do card**.

## Dados ilustrativos

`previewData.ts` adapta a fixture já existente em `test/fixtures/project-detail.mjs`
para vários projetos e semanas. O adapter do Axios responde localmente a todas
as consultas e gravações da prévia, sem chamar a API real. Dias úteis são valores
ilustrativos adicionais; a fonte e as regras reais deverão ser confirmadas ao
integrar esse indicador ao app. Nenhuma regra de cálculo de produção foi alterada.

## Abrir e gerar

Na pasta `frontend`:

```sh
npm run dev -- --port 5191
```

- Dashboard reorganizado: <http://localhost:5191/design-preview/index.html>
- Pela rede local da máquina atual: <http://10.10.0.132:5191/design-preview/index.html>
- Tela atual: <http://localhost:5191/design-preview/index.html?version=atual>
- Cards: <http://localhost:5191/design-preview/index.html?view=cards>

Nesta máquina, o Windows tem a regra `Filtrovali-Preview-LAN-5191` para permitir
TCP 5191 somente da rede `10.10.0.0/24`. O WSL em modo espelhado importa essa
regra do Windows. O servidor precisa estar rodando para os links funcionarem.

Para regenerar as cópias a partir dos componentes de produção:

```sh
python3 design-preview/generate.py
```

Para verificar os tipos e gerar HTML independente:

```sh
npx tsc --noEmit -p design-preview/tsconfig.json
node design-preview/build.mjs
```

O HTML independente e as capturas ficam em `output/playwright/` na raiz da worktree.
Os arquivos gerados em `components/` indicam a fonte original; o script de geração
registra as alterações de organização para comparação com o código consolidado.
