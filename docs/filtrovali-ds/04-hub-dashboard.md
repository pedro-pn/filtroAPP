# 04 — Hub / Dashboard (protótipo aprovado)

Especificação visual da tela aprovada no protótipo. É a **referência de composição** para o
Hub — o ponto de entrada pós-login que lista módulos por papel e resume o estado operacional.

Na implementação atual, o Hub não apresenta BottomBar: a barra mobile pertence às seções
do módulo ativo. O menu da TopBar dá acesso aos módulos.

## 1. Estrutura (ordem dos elementos)

```
Shell
├─ Sidebar (≥ lg)                    // navegação: grupos "Principal" + "Módulos"
├─ TopBar (sticky)                   // breadcrumb + search + tema + notificações + perfil
└─ Conteúdo (max-width 1280, centralizado)
   ├─ PageHeader                     // saudação + data + ação primária
   ├─ Seção KPIs                     // 4 cartões de indicador
   ├─ Seção "Módulos"                // grid de cards de módulo (por papel)
   ├─ Seção "Atividade recente"      // lista/tabela de eventos
   └─ Seção "Pendências" (DataTable) // tabela responsiva de itens acionáveis
   BottomBar (< lg)                  // tab bar + FAB "Novo"
```

## 2. PageHeader
- Saudação contextual por horário: **"Bom dia/Boa tarde/Boa noite, {primeiro nome}"**
  (`--text-xl --font-bold`).
- Subtítulo: data por extenso + resumo curto (`--text-sm --muted`), ex.: "Terça, 19 de agosto —
  3 pendências para hoje".
- Ação primária à direita: `Button primary` "Novo RDO" (ícone +). Em mobile, esta ação é o
  **FAB** da BottomBar.

## 3. KPIs (4 cartões)
- Grid: `1` (mobile) → `2` (sm) → `4` (lg), gap `--space-4`.
- Cada KPI = `Card` (`variant="flat"` ou `default`, `padding="md"`) com:
  - Rótulo `--text-sm --muted` (ex.: "RDOs do mês").
  - Valor grande `--text-2xl --font-bold .tabular`.
  - Delta/variação com `StatusPill`/seta (`success` = alta boa, `danger` = queda) + comparação
    ("+12% vs. mês anterior").
  - Ícone temático 20px `--muted` (opcional, não decorativo redundante).
- **Não** usar gradientes nem números decorativos sem significado.
- KPIs sugeridos (dados reais depois; fictícios no protótipo): RDOs do mês, Equipamentos a
  vencer calibração, Itens de estoque abaixo do mínimo, Relatórios pendentes de assinatura.

## 4. Cards de módulos
- Título de seção "Módulos" (`PageHeader`-like menor: `--text-lg --font-semibold`).
- Grid: `1` → `2` (sm) → `3` (lg) → `4` (xl), gap `--space-4`.
- Cada card = `Card variant="interactive"` (clicável, hover eleva) contendo:
  - Ícone do módulo 20–24px em recipiente `--brand-soft`, cor `--brand`.
  - Nome do módulo `--font-semibold`.
  - Descrição curta `--text-sm --muted` (1 linha).
  - Opcional: `Badge` de contagem/pendência (ex.: "3 pendentes", tone `warning`).
- **Filtrado por papel** via `moduleRegistry`/`moduleNavigation` (mesma lógica atual).
- Clique navega para a rota do módulo (`rolePath`). O card inteiro é acionável e acessível.

## 5. Atividade recente
- `Card` com header "Atividade recente" + link "Ver tudo" (`Button link`).
- Lista de eventos: ícone de tom + texto (ator + ação + alvo) + timestamp relativo
  (`--text-xs --muted .tabular`).
- Status de cada evento via `StatusPill` quando aplicável (ex.: "RDO #182 aprovado").
- Estado vazio → `EmptyState variant="default"` ("Nenhuma atividade recente").
- Loading → `Skeleton variant="text" lines={5}`.

## 6. Tabela de pendências (DataTable)
- `Card` (ou seção) com `PageHeader` menor + `FilterBar` (Search + Select de tipo/período).
- `DataTable` com colunas ex.: **Item** (`primary`), Tipo (`Badge`), Responsável, Prazo
  (`.tabular`), Status (`StatusPill`), Ações (`Button ghost` ⋯).
- Densidade `comfortable`; cabeçalho sticky.
- Ordenação por Prazo/Status.
- Estados: loading (linhas Skeleton), empty ("Sem pendências"), error (Alert + "Tentar
  novamente").

## 7. Ações
- Primária global: "Novo RDO" (PageHeader no desktop; FAB no mobile).
- Por linha da tabela: ver/aprovar/editar via `Button ghost` ou menu ⋯ (→ BottomSheet no mobile).
- "Ver tudo" leva à listagem completa do respectivo módulo.

## 8. Estados da tela
- **Carregando:** KPIs, cards e tabela em Skeleton; layout já reservado (sem shift).
- **Vazio (novo usuário/papel restrito):** EmptyState nos blocos sem dados; módulos disponíveis
  ainda aparecem.
- **Erro de dados:** Alert `danger` no bloco afetado, com retry; resto da tela permanece usável.

## 9. Comportamento mobile
- Sidebar → oculta; navegação pela **BottomBar** (5 itens + FAB "Novo").
- KPIs em 1–2 colunas roláveis verticalmente.
- Cards de módulo em 1 coluna.
- Tabela de pendências → **lista de cards** (Item como título, demais campos como pares,
  ações no rodapé).
- Filtros → Search visível + botão "Filtros (N)" abrindo **BottomSheet**.
- TopBar compacta (menu + saudação curta + tema/perfil).

## 10. Referência de implementação (protótipo)
O protótipo validado vive em `components/prototype/` deste projeto v0 (fora do repositório real):
`dashboard.tsx` (shell), `sidebar.tsx`, `topbar.tsx`, `bottom-bar.tsx`,
`dashboard-content.tsx` (KPIs + módulos + atividade + tabela), `badge.tsx`, `data.ts`.
Servem como **espelho visual**; a implementação no projeto real deve reconstruir com os
componentes do DS, não copiar 1:1 (dados são fictícios).
