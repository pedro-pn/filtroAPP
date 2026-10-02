# 01 — Design Tokens

Arquitetura em **duas camadas**:

- **Primitivos** — paleta bruta, valores absolutos. Não são usados diretamente nos componentes.
- **Semânticos** — mapeiam primitivos para um significado de uso (`--surface`, `--brand`, `--danger`).
  São os **únicos** tokens que os componentes consomem.

Os valores canônicos vivem em [`variables.css`](./variables.css). Esta página descreve o
significado e as regras de uso.

---

## 1. Cores primitivas

### Marca (verde Filtrovali normalizado)

| Token         | Hex       | Uso pretendido                    |
| ------------- | --------- | --------------------------------- |
| `--green-700` | `#243d2c` | hover/pressed do brand (light)    |
| `--green-600` | `#2c4a36` | reservado                         |
| `--green-500` | `#30503a` | **cor de marca** (light)          |
| `--green-400` | `#3d6449` | brand em superfícies escuras      |
| `--green-300` | `#4f8a63` | brand (dark)                      |
| `--green-200` | `#72b487` | texto da marca e foco (dark)                |
| `--green-100` | `#e6efe9` | fundo suave de marca (light)      |
| `--green-50`  | `#f2f7f4` | fundo suavíssimo de marca (light) |

### Neutros (rampa única — substitui os ~40 cinzas/off-whites atuais)

| Token        | Hex       |
| ------------ | --------- |
| `--gray-950` | `#0f1512` |
| `--gray-900` | `#16211b` |
| `--gray-800` | `#1c2a22` |
| `--gray-700` | `#374151` |
| `--gray-500` | `#6b7280` |
| `--gray-400` | `#9aa7a0` |
| `--gray-300` | `#d1d5db` |
| `--gray-200` | `#e5e7eb` |
| `--gray-100` | `#f3f4f4` |
| `--gray-50`  | `#f7f8f7` |
| `--white`    | `#ffffff` |

### Feedback (4 famílias × 3 tons: base / bg / line)

| Família | base      | bg (fundo) | line (borda) |
| ------- | --------- | ---------- | ------------ |
| Sucesso | `#1f7a3d` | `#e6f4ea`  | `#b7dcc3`    |
| Aviso   | `#b45309` | `#fff7e6`  | `#fcd9a3`    |
| Erro    | `#c81519` | `#fdecec`  | `#f3b3b5`    |
| Info    | `#11437e` | `#e7effa`  | `#b6cbe6`    |

> **Regra:** só existem estas famílias. Não criar "mais um verde/vermelho" por módulo.
> Sair de **151 cores hex** para estas ~5 famílias tokenizadas é o objetivo central.

---

## 2. Cores semânticas

Os componentes usam **apenas** estes nomes. Cada um resolve para um primitivo diferente
em light e dark (ver tabela light/dark abaixo).

### Superfícies e texto

| Token             | Significado                                                   |
| ----------------- | ------------------------------------------------------------- |
| `--canvas`        | fundo da aplicação (atrás de tudo)                            |
| `--canvas-subtle` | fundo levemente rebaixado (áreas agrupadas)                   |
| `--surface`       | superfície de cartões, modais, tabelas                        |
| `--surface-2`     | superfície secundária (cabeçalho de tabela, chips, hover)     |
| `--line`          | borda/divisória padrão                                        |
| `--line-strong`   | borda de maior contraste (inputs em foco, separadores fortes) |
| `--ink`           | texto primário                                                |
| `--muted`         | texto secundário/legendas/placeholder                         |
| `--inverse`       | texto/ícone sobre fundos fortes neutros                       |

### Marca

| Token            | Significado                                                       |
| ---------------- | ----------------------------------------------------------------- |
| `--brand`        | cor de marca (botão primário, item ativo, foco)                   |
| `--brand-hover`  | estado hover/pressed do brand                                     |
| `--brand-soft`   | fundo suave de marca (item de menu ativo, badge brand)            |
| `--brand-softer` | fundo suavíssimo (hover de item de menu)                          |
| `--brand-text`   | texto de marca sobre superfícies suaves; possui ajuste AA no dark |
| `--on-brand`     | texto/ícone sobre `--brand`                                       |

### Feedback (semântico)

`--success`, `--success-bg`, `--success-line`
`--warning`, `--warning-bg`, `--warning-line`
`--danger`, `--danger-bg`, `--danger-line`
`--info`, `--info-bg`, `--info-line`

- `*` (base): texto/ícone e borda de ênfase.
- `*-bg`: preenchimento de fundo (alert, badge, linha destacada).
- `*-line`: borda de contorno do bloco.

Botões destrutivos usam ainda `--danger-hover` e `--on-danger`. Esses tokens são
específicos por tema para que o estado hover e o conteúdo do botão mantenham contraste AA.

### Foco

| Token          | Significado                                  |
| -------------- | -------------------------------------------- |
| `--focus-ring` | cor do anel de foco (`:focus-visible`) — 2px |

### Links e limites de controles

| Token              | Significado                                              |
| ------------------ | -------------------------------------------------------- |
| `--link`           | texto de link; possui valor dark próprio para atingir AA |
| `--link-hover`     | hover/focus visual do texto de link                      |
| `--control-border` | limite perceptível de inputs/selects nos dois temas      |

### Estados e efeitos funcionais

| Token                  | Significado                                          |
| ---------------------- | ---------------------------------------------------- |
| `--scrim`              | backdrop de modal; possui opacidade própria por tema |
| `--skeleton-highlight` | faixa funcional do shimmer de carregamento           |
| `--disabled-opacity`   | opacidade unificada de controles desabilitados       |
| `--disabled-bg`        | superfície de controles desabilitados                |
| `--disabled-ink`       | texto/ícone legível de controles desabilitados       |
| `--disabled-line`      | limite visual de controles desabilitados             |

> `--brand` não deve ser usado automaticamente como cor de link. No dark ele mede
> aproximadamente 4.06:1 sobre `--surface`; `--link` usa o tom aprovado com contraste AA.

---

## 3. Tipografia

- **Família UI:** `Inter Variable` (auto-hospedada via `@fontsource-variable/inter`), fallback
  `ui-sans-serif, system-ui, sans-serif`. Token: `--font-sans`.
- **Família mono** (códigos/IDs quando necessário): `ui-monospace, "SFMono-Regular", monospace`.
  Token: `--font-mono`.
- **Números tabulares:** aplicar `font-variant-numeric: tabular-nums` (classe utilitária
  `.tabular`) em colunas de tabela, valores monetários, datas e códigos.

### Escala de tamanho (`--text-*`) + line-height

| Token         | Tamanho | Line-height | Uso                                 |
| ------------- | ------- | ----------- | ----------------------------------- |
| `--text-xs`   | 12px    | 16px (1.33) | metadados, legendas, badges         |
| `--text-sm`   | 13px    | 18px (1.38) | densidade de tabela, texto auxiliar |
| `--text-base` | 14px    | 20px (1.43) | **corpo padrão**                    |
| `--text-md`   | 16px    | 24px (1.5)  | inputs, ênfase, texto de leitura    |
| `--text-lg`   | 18px    | 26px (1.44) | título de card / seção              |
| `--text-xl`   | 22px    | 30px (1.36) | título de página                    |
| `--text-2xl`  | 28px    | 36px (1.29) | dashboards / número de KPI          |

> **Mínimo absoluto: 12px.** Eliminar todos os `9px`, `10px`, `11px`, e fracionários
> (`12.5px`, `13.5px`, `.78rem`) do CSS atual.

### Pesos (`--font-weight-*`)

| Token             | Valor | Uso                                  |
| ----------------- | ----- | ------------------------------------ |
| `--font-regular`  | 400   | corpo                                |
| `--font-medium`   | 500   | labels, botões, ênfase leve          |
| `--font-semibold` | 600   | títulos de card, cabeçalho de tabela |
| `--font-bold`     | 700   | título de página, número de KPI      |

### Regras de line-height

- Corpo/textos longos: 1.4–1.5.
- Títulos: 1.25–1.4.
- Nunca abaixo de 1.2.

---

## 4. Espaçamento (base 4px)

| Token        | px  |
| ------------ | --- |
| `--space-1`  | 4   |
| `--space-2`  | 8   |
| `--space-3`  | 12  |
| `--space-4`  | 16  |
| `--space-5`  | 20  |
| `--space-6`  | 24  |
| `--space-8`  | 32  |
| `--space-10` | 40  |
| `--space-12` | 48  |
| `--space-16` | 64  |

**Regras:**

- Usar **somente** múltiplos da escala. Proibido `3px`, `5px`, `7px`, `9px`, `11px`.
- Espaço entre elementos com `gap` (flex/grid), nunca `margin` improvisado nem classes `space-*`.
- Padding de container de conteúdo: `--space-4` (mobile) → `--space-6` (≥ md) → `--space-8` (≥ xl).
- Espaço entre seções de página: `--space-6` (mobile) / `--space-8` (desktop).

---

## 5. Border radius

| Token           | px    | Uso                                    |
| --------------- | ----- | -------------------------------------- |
| `--radius-sm`   | 6     | badges, inputs pequenos, chips         |
| `--radius-md`   | 10    | **inputs, botões, cards** (padrão)     |
| `--radius-lg`   | 14    | cards grandes, modais, painéis         |
| `--radius-xl`   | 18    | superfícies de destaque / bottom sheet |
| `--radius-pill` | 999px | pills, avatares circulares (via 50%)   |

> Substitui os 20+ valores atuais (`2/3/4/5/8/9/20px`, etc.).

---

## 6. Bordas

- Espessura padrão: **1px**.
- Cor padrão: `--line`. Contraste alto: `--line-strong`.
- Foco: anel de **2px** `--focus-ring` via `outline` ou `box-shadow`, com `outline-offset: 2px`.
- Não usar bordas coloridas de feedback fora dos tokens `*-line`.

---

## 7. Elevação / sombras (4 níveis)

| Token         | Valor                            | Uso                                  |
| ------------- | -------------------------------- | ------------------------------------ |
| `--shadow-e0` | `none`                           | superfícies planas, linhas de tabela |
| `--shadow-e1` | `0 1px 2px rgba(16,21,18,.06)`   | cards, inputs                        |
| `--shadow-e2` | `0 4px 12px rgba(16,21,18,.08)`  | dropdown, popover, menu, toast       |
| `--shadow-e3` | `0 16px 40px rgba(16,21,18,.16)` | modais, bottom sheet                 |

> Substitui os 50 `box-shadow` distintos do CSS atual. No dark mode as sombras
> permanecem (o contraste vem também das bordas `--line`).

---

## 8. Breakpoints (5 oficiais — mobile-first, `min-width`)

| Token | Valor  | Alvo                                     |
| ----- | ------ | ---------------------------------------- |
| `sm`  | 480px  | telefone grande                          |
| `md`  | 768px  | tablet retrato                           |
| `lg`  | 1024px | **corte sidebar/desktop**                |
| `xl`  | 1280px | desktop largo (largura máx. de conteúdo) |
| `2xl` | 1536px | monitores grandes                        |

**Regras:**

- Substituir os ~23 breakpoints atuais por estes 5.
- Em **`md` (768px)** a BottomBar de seções dá lugar à navegação local e ao drawer.
  Em **`lg` (1024px)** a Sidebar fixa substitui o drawer como navegação de módulos.
- Não introduzir breakpoints intermediários (`430`, `560`, `860`…). Se um layout "quebra"
  entre pontos, ajustar o componente, não criar um novo breakpoint.

---

## 9. Z-index (escala nomeada)

| Token           | Valor | Camada                             |
| --------------- | ----- | ---------------------------------- |
| `--z-base`      | 0     | conteúdo                           |
| `--z-sticky`    | 100   | cabeçalho de tabela sticky, TopBar |
| `--z-sidebar`   | 200   | sidebar fixa                       |
| `--z-dropdown`  | 300   | dropdowns, popovers, tooltips      |
| `--z-bottombar` | 400   | BottomBar mobile                   |
| `--z-overlay`   | 500   | backdrop de modal/drawer/sheet     |
| `--z-modal`     | 600   | modal, drawer, bottom sheet        |
| `--z-toast`     | 700   | toasts (acima de tudo)             |

> Regra: nunca usar valores mágicos (`9999`). Sempre um token da escala.

---

## 10. Light / Dark mode

- **Estratégia:** classe `.dark` na raiz (`<html>`), com fallback opcional a
  `prefers-color-scheme`. Toggle manual persistido pelo app.
- Componentes **não** conhecem o tema — apenas consomem tokens semânticos. Trocar o tema
  = trocar o valor dos tokens, nunca reescrever o componente.

### Mapa semântico → primitivo

| Semântico          | Light     | Dark                    |
| ------------------ | --------- | ----------------------- |
| `--canvas`         | `#f7f8f7` | `#0f1512`               |
| `--canvas-subtle`  | `#f3f4f4` | `#131b16`               |
| `--surface`        | `#ffffff` | `#16211b`               |
| `--surface-2`      | `#f3f4f4` | `#1c2a22`               |
| `--line`           | `#e5e7eb` | `rgba(255,255,255,.09)` |
| `--line-strong`    | `#d1d5db` | `rgba(255,255,255,.16)` |
| `--ink`            | `#1a1a1a` | `#eef2ef`               |
| `--muted`          | `#596273` | `#9aa7a0`               |
| `--inverse`        | `#ffffff` | `#0f1512`               |
| `--brand`          | `#30503a` | `#30503a`               |
| `--brand-hover`    | `#243d2c` | `#3d6449`               |
| `--brand-soft`     | `#e6efe9` | `rgba(79,138,99,.12)`   |
| `--brand-softer`   | `#f2f7f4` | `rgba(79,138,99,.10)`   |
| `--on-brand`       | `#ffffff` | `#ffffff`               |
| `--link`           | `#30503a` | `#72b487`               |
| `--link-hover`     | `#243d2c` | `#eef2ef`               |
| `--control-border` | `#6b7280` | `#9aa7a0`               |
| `--success`        | `#1f7a3d` | `#57b979`               |
| `--success-bg`     | `#e6f4ea` | `rgba(31,122,61,.16)`   |
| `--success-line`   | `#b7dcc3` | `rgba(87,185,121,.30)`  |
| `--warning`        | `#b45309` | `#e0a049`               |
| `--warning-bg`     | `#fff7e6` | `rgba(180,83,9,.18)`    |
| `--warning-line`   | `#fcd9a3` | `rgba(224,160,73,.30)`  |
| `--danger`         | `#c81519` | `#ef6b6e`               |
| `--danger-bg`      | `#fdecec` | `rgba(200,21,25,.18)`   |
| `--danger-line`    | `#f3b3b5` | `rgba(239,107,110,.30)` |
| `--info`           | `#11437e` | `#6ba3e0`               |
| `--info-bg`        | `#e7effa` | `rgba(17,67,126,.22)`   |
| `--info-line`      | `#b6cbe6` | `rgba(107,163,224,.30)` |
| `--focus-ring`     | `#30503a` | `#72b487`               |

> **Contraste:** todas as combinações texto/fundo devem atingir no mínimo WCAG AA
> (4.5:1 para texto normal, 3:1 para texto grande e componentes). O `--brand` dark é
> adequado para marca e componentes, mas não para texto normal sobre `--surface`; links
> devem usar `--link` (`#72b487`, aproximadamente 6.78:1 nesse par).

Para a arquitetura de aplicação, persistência e resultados medidos na Fase 1, consulte
[`07-foundation-phase-1.md`](./07-foundation-phase-1.md).

### Revisão de contraste — 02/10/2026

A execução usa `frontend/src/styles/variables.css`. O texto secundário claro
usa `--gray-600` (`#596273`) e o texto/link/foco verde no escuro usa
`--green-200` (`#72b487`). O fundo do botão principal permanece `--green-500`;
`--brand-hover` escuro usa `--green-400`. A logo original não foi recolorida.
