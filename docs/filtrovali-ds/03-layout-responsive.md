# 03 — Layout e Responsividade

## 1. Mudança estrutural fundamental

O app atual está travado em `.app-shell { max-width: 420px }` — **inclusive no desktop**.
Isto é **removido**. O novo shell é fluido e adapta a navegação ao tamanho de tela.

```
┌───────────────────────────────────────────────┐
│ TopBar (sticky)                                 │
├──────────┬──────────────────────────────────── │
│          │  PageHeader                          │
│ Sidebar  │  ── conteúdo (max-width 1280) ──     │
│ (≥ lg)   │  KPIs / grids / DataTable / …        │
│          │                                      │
├──────────┴──────────────────────────────────── │
│ BottomBar (< md, se houver seções no módulo)    │
└───────────────────────────────────────────────┘
```

## 2. Regras por dispositivo

### Desktop (≥ lg, 1024px+)
- **Sidebar fixa** à esquerda (260px; colapsável para 72px).
- **TopBar** com breadcrumb + search central + ações.
- **Sem BottomBar.**
- Conteúdo em container fluido com **`max-width: 1280px`** centralizado (`--space-8` de padding
  lateral em `≥ xl`; conteúdo pode chegar a 1440–1536 em `2xl` se a tela justificar, mas o
  texto/leitura fica contido).
- Grids usam 2–4 colunas conforme a seção.

### Tablet (md, 768–1023px)
- **Sem Sidebar fixa** — botão "Menu" abre drawer com os módulos.
- TopBar completa (breadcrumb pode simplificar).
- **Sem BottomBar** (ou opcional). Preferir drawer.
- Grids: 2 colunas. Conteúdo full-width com padding `--space-6`.

### Mobile (< md, até 767px)
- **BottomBar fixa** com as seções do módulo ativo; até 4 seções diretas ou 3 + "Mais".
- **TopBar** compacta: botão menu + título; search recolhível.
- Drawer lateral (pelo "Menu") com todos os módulos.
- Conteúdo full-width, padding `--space-4`.
- Grids: **1 coluna**. Tabelas → **cards**. Modais grandes → **BottomSheet**.

## 3. Largura máxima e container

| Contexto | Regra |
|----------|-------|
| Área de conteúdo | `max-width: 1280px`, centralizada |
| Padding lateral | `--space-4` (mobile) → `--space-6` (md) → `--space-8` (xl) |
| Sidebar | 260px expandida / 72px colapsada |
| TopBar altura | 56px (mobile) / 64px (desktop) |
| BottomBar altura | 56px + safe-area |
| Leitura de texto longo | limitar a ~72ch |

## 4. Grids e espaçamento entre seções

- **KPIs:** grid `1 col` (mobile) → `2` (sm) → `4` (lg). Gap `--space-4`.
- **Cards de módulo:** `1 col` (mobile) → `2` (sm) → `3` (lg) → `4` (xl). Gap `--space-4`.
- **Formulários:** `1 col` (mobile) → `2` (md) → `3` (xl) para campos curtos; campos longos
  ocupam a linha inteira (`col-span-full`). Gap `--space-4` (linha) / `--space-6` (grupo).
- **Espaço vertical entre seções da página:** `--space-6` (mobile) / `--space-8` (desktop).
- **Espaço interno de card:** conforme `padding` do Card (`--space-4/5/6`).
- Sempre `gap`; nunca `margin` improvisado nem `space-*`.

## 5. Comportamento responsivo por componente

| Componente | ≥ lg (desktop) | md (tablet) | < md (mobile) |
|------------|----------------|-------------|----------------|
| **Navegação** | Sidebar fixa | Drawer via "Menu" | BottomBar de seções + Drawer |
| **TopBar** | breadcrumb + search central | breadcrumb simples | menu + título + search recolhível |
| **DataTable** | tabela real, header sticky | tabela real (scroll interno) | **cards chave→valor** (1 por linha) |
| **Modal** | painel centralizado (sm/md/lg) | painel centralizado | **fullscreen ou BottomSheet** |
| **Filtros** | inline | inline/compacto | Search + **BottomSheet "Filtros (N)"** |
| **Formulário** | 2–3 colunas | 2 colunas | 1 coluna; ações fixas no rodapé |
| **PageHeader** | título + ações inline | idem | ações em linha própria / FAB |
| **Card grid** | 3–4 colunas | 2 colunas | 1 coluna |
| **KPIs** | 4 colunas | 2 colunas | 1–2 colunas |
| **Select longo** | popover | popover | BottomSheet picker |
| **Toast** | inferior-direito | inferior-direito | topo (ou acima da BottomBar) |

### 5.1 Tabela desktop → cards mobile (detalhe)
- Colunas com `primary: true` viram o **título** do card.
- Colunas `hideOnMobile` são omitidas no card.
- Demais colunas viram pares `label → valor` (`<dl>`).
- Ações da linha vão para o rodapé do card.
- Zero scroll horizontal.

### 5.2 Sidebar desktop → menu mobile
- Mesmos itens (`moduleRegistry` filtrado por papel).
- `< lg`: botão "Menu" da TopBar abre **drawer lateral** com os módulos e seus grupos.
- Item ativo e badges idênticos aos da Sidebar.

### 5.3 Modal → BottomSheet
- `≥ md`: Modal centralizado (tamanho conforme conteúdo).
- `< md`: formulários curtos e menus de ação abrem como **BottomSheet**; formulários longos
  abrem **fullscreen** (Modal `full`). Confirmações simples continuam como diálogo pequeno.

### 5.4 Formulários (fluxos longos, ex.: RDO)
- Layout em colunas no desktop; 1 coluna no mobile.
- Barra de ações (Salvar/Cancelar) **fixa no rodapé** em telas pequenas (não usar
  sobrescrita de `.primary-button` por contexto — usar o Button do DS com `fullWidth`).
- Inputs 16px no mobile (anti-zoom uniforme).

## 6. Safe areas e toque
- Respeitar `env(safe-area-inset-*)` na BottomBar e em sheets.
- Alvos interativos ≥ 44×44px no mobile.
- Sticky headers (TopBar, cabeçalho de DataTable) não podem cobrir conteúdo focado (scroll-margin).
