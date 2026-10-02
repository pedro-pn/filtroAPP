# 07 — Fundação implementada (Fase 1)

Este documento registra as decisões técnicas efetivamente implementadas na Fase 1 do
Filtrovali DS. Ele complementa a especificação visual dos documentos anteriores e passa a
ser a referência de arquitetura para as próximas fases.

## 1. Escopo e estado

A Fase 1 entregou apenas a fundação necessária para uma migração incremental:

- tokens e temas light/dark;
- Tailwind CSS v4 configurado para código novo;
- fronteira explícita entre Design System e CSS legado;
- infraestrutura de tema `light` / `dark` / `system`;
- `BrandLogo`, `AppIcon` e `ThemeToggle`;
- fonte Inter auto-hospedada;
- aliases temporários para consumidores legados.

Nenhuma tela, rota, regra de negócio, API, store ou módulo funcional foi migrado. O
`ThemeToggle` está pronto e validado, mas ainda não foi montado no layout legado; ele deve
entrar junto com a migração do shell/navegação.

## 2. Tailwind CSS v4

### Decisão

O projeto adotou Tailwind CSS v4 por meio do plugin oficial `@tailwindcss/vite`. O objetivo é
usar utilitários tokenizados nos novos componentes sem converter em massa o `base.css`.

Arquivos envolvidos:

- `frontend/vite.config.ts` — registra o plugin `tailwindcss()`;
- `frontend/src/styles/tailwind.css` — integra tokens, layers e utilitários;
- `frontend/src/styles/variables.css` — mantém os valores canônicos em CSS variables.

### Configuração

- `@theme` expõe tipografia, radius, sombras e os breakpoints oficiais.
- `@theme inline` expõe as cores semânticas (`bg-surface`, `text-ink`, `bg-brand`,
  `text-link`, estados de feedback etc.).
- A paleta genérica `--color-*` do Tailwind é anulada. Ela não deve se tornar uma segunda
  fonte de cores.
- O espaçamento base do Tailwind é `4px`, coerente com a escala do DS.
- O variant `dark` usa a classe `.dark` na raiz.
- Componentes devem preferir classes semânticas e reutilizáveis. Listas extensas de valores
  arbitrários em páginas não são aceitas.

### Sem Preflight

O Preflight do Tailwind **não é importado**. Apenas `theme.css` e `utilities.css` são usados.
Essa decisão evita que o reset opinativo do Tailwind altere elementos das telas legadas.

Não adicionar `@import 'tailwindcss'` diretamente: esse import reintroduziria o Preflight.

## 3. Tailwind e CSS legado

A ordem de cascade layers é:

```css
@layer theme, legacy, utilities;
```

O `base.css` permanece como corpo principal do legado, com apenas ajustes pontuais de
compatibilidade de tokens, e é carregado por:

```css
@import "./base.css" layer(legacy);
```

Consequências dessa arquitetura:

1. regras legadas mantêm a ordem e o comportamento entre si;
2. utilitários Tailwind podem vencer o legado dentro de componentes novos;
3. estilos de componentes do DS, fora de layer, podem especializar sua própria interface;
4. não é necessário recorrer a `!important` para atravessar a transição.

A ordem dos estilos no entrypoint é:

1. fonte Inter;
2. `tailwind.css`;
3. `variables.css`;
4. `foundation.css`;
5. `utilities.css`;
6. `legacy.css`.

## 4. Convenção `.fv-ds`

`.fv-ds` é a fronteira de migração visual. `data-fv-ds` é aceito como forma equivalente.

```tsx
<section className="fv-ds">{/* conteúdo já migrado */}</section>
```

Regras:

- aplicar a classe no menor contêiner que represente uma área completamente migrada;
- componentes dentro da fronteira consomem fonte, cores, foco e comportamento responsivo do
  novo DS;
- não aplicar `.fv-ds` globalmente em `#root` enquanto houver telas dependentes do legado;
- não usar `.fv-ds` apenas para corrigir um elemento isolado em uma tela ainda não migrada;
- quando todo o shell estiver migrado, a fronteira poderá subir para o layout principal.

O arquivo `foundation.css` limita deliberadamente suas regras globais à fronteira `.fv-ds`,
preservando o comportamento do CSS existente.

## 5. Lucide e `AppIcon`

`lucide-react` é o set oficial para **novos** ícones do Design System. Ícones existentes em
telas não migradas permanecem inalterados até a migração de seu componente.

Todo ícone Lucide novo deve passar por `AppIcon`, em
`frontend/src/components/icons/AppIcon.tsx`.

Convenção:

| Propriedade    | Regra                                                                      |
| -------------- | -------------------------------------------------------------------------- |
| tamanhos       | `sm = 16px`, `md = 20px`, `lg = 24px`                                      |
| tamanho padrão | `md` / `20px`                                                              |
| stroke         | `1.75` com `absoluteStrokeWidth`                                           |
| cor            | `currentColor`; o componente pai controla o token semântico                |
| alinhamento    | SVG block, sem encolhimento no flex                                        |
| acessibilidade | decorativo por padrão; usar `label` quando o SVG tiver significado próprio |

Não usar emoji, caractere Unicode, SVG duplicado ou import direto do Lucide em componentes de
domínio. O import direto é permitido somente dentro da camada de infraestrutura que seleciona
o ícone e o entrega ao `AppIcon`.

## 6. `BrandLogo` e matriz de assets

`frontend/src/components/brand/BrandLogo.tsx` é o único ponto novo autorizado a montar URLs
dos assets de marca. A identidade não deve ser redesenhada nem substituída por ícone genérico.

| `variant`  | Asset                                               | Contexto recomendado                                            |
| ---------- | --------------------------------------------------- | --------------------------------------------------------------- |
| `adaptive` | light: `LOGO_COLORIDO.png`; dark: `LOGO_BRANCA.png` | padrão para superfícies que acompanham o tema                   |
| `color`    | `LOGO_COLORIDO.png`                                 | fundo claro; logo horizontal oficial                            |
| `white`    | `LOGO_BRANCA.png`                                   | fundo escuro neutro; símbolo colorido + lettering branco        |
| `header`   | `LOGO_HEADER.png`                                   | header/sidebar sobre verde de marca; versão monocromática clara |
| `login`    | `LOGO_LOGIN.png`                                    | autenticação; composição vertical aprovada                      |
| `symbol`   | `LOGO_TAB.png`                                      | marca reduzida, favicon ou espaço quadrado                      |
| `green`    | `LOGO_VERDE.png`                                    | contextos públicos que usam a peça com fundo verde incorporado  |

O componente preserva as dimensões intrínsecas, usa `alt="Filtrovali"` por padrão e oferece
`decorative` para ocorrências redundantes. URLs diretas já existentes no legado serão
substituídas apenas quando seus consumidores forem migrados.

## 7. Arquitetura de tema

Arquivos:

| Arquivo                   | Responsabilidade                                                     |
| ------------------------- | -------------------------------------------------------------------- |
| `theme/theme.ts`          | tipos, leitura/persistência, resolução do sistema e aplicação no DOM |
| `theme/ThemeContext.ts`   | contrato do contexto                                                 |
| `theme/ThemeProvider.tsx` | estado React, listener do sistema e sincronização entre abas         |
| `theme/useTheme.ts`       | acesso seguro ao contexto                                            |
| `theme/ThemeToggle.tsx`   | controle acessível `light → dark → system`                           |

`initializeTheme()` executa antes do primeiro render React. A preferência e o tema resolvido
são estados distintos:

| Preferência | Tema resolvido                            |
| ----------- | ----------------------------------------- |
| `light`     | sempre light                              |
| `dark`      | sempre dark                               |
| `system`    | resultado atual de `prefers-color-scheme` |

Contrato no elemento `<html>`:

- classe `.light` ou `.dark`;
- `data-theme="light|dark"` com o tema resolvido;
- `data-theme-preference="light|dark|system"` com a escolha do usuário;
- `color-scheme` definido pelos tokens do tema.

A preferência é persistida em `localStorage` com a chave `filtrovali-theme`. O provider também
ouve mudanças de `prefers-color-scheme` quando a preferência é `system` e eventos de `storage`
para sincronizar outras abas.

Componentes não devem testar o tema para escolher cores. Eles consomem tokens semânticos. A
exceção é `BrandLogo variant="adaptive"`, pois a troca de tema exige selecionar outro arquivo
de imagem real.

## 8. Tokens específicos de tema

Os valores light e dark canônicos continuam em `variables.css`. No dark mode não há inversão
automática: superfícies, textos, marca e cada família de feedback possuem valores próprios.

| Token              | Light     | Dark                    |
| ------------------ | --------- | ----------------------- |
| `--canvas`         | `#f7f8f7` | `#0f1512`               |
| `--surface`        | `#ffffff` | `#16211b`               |
| `--surface-2`      | `#f3f4f4` | `#1c2a22`               |
| `--line`           | `#e5e7eb` | `rgba(255,255,255,.09)` |
| `--line-strong`    | `#d1d5db` | `rgba(255,255,255,.16)` |
| `--ink`            | `#1a1a1a` | `#eef2ef`               |
| `--muted`          | `#6b7280` | `#9aa7a0`               |
| `--brand`          | `#30503a` | `#4f8a63`               |
| `--brand-hover`    | `#243d2c` | `#5fa074`               |
| `--on-brand`       | `#ffffff` | `#0f1512`               |
| `--focus-ring`     | `#30503a` | `#5fa074`               |
| `--control-border` | `#6b7280` | `#9aa7a0`               |

As famílias `success`, `warning`, `danger` e `info` também têm valores dark próprios para
foreground, background translúcido e borda. Não reutilizar os valores light em fundo escuro.

### Token `--link`

`--brand` dark produz contraste de aproximadamente `4.06:1` sobre `--surface`, insuficiente
para texto normal. Por isso links possuem tokens próprios:

| Token          | Light                | Dark                             |
| -------------- | -------------------- | -------------------------------- |
| `--link`       | `var(--brand)`       | `var(--brand-hover)` (`#5fa074`) |
| `--link-hover` | `var(--brand-hover)` | `var(--ink)`                     |

O verde de marca original permanece inalterado. O token específico corrige apenas o contexto
de texto interativo.

## 9. Contraste e acessibilidade

Critérios mínimos:

- WCAG AA `4.5:1` para texto normal;
- `3:1` para texto grande e limites/estados essenciais de componentes;
- focus ring de `2px`, offset de `2px`, visível nos dois temas;
- alvo interativo mínimo de `44 × 44px` no mobile;
- links distinguíveis por cor e sublinhado;
- estados nunca comunicados apenas por cor;
- logos e ícones selecionados para a superfície correta.

Pares validados na Fase 1:

| Par                         | Light     | Dark      |
| --------------------------- | --------- | --------- |
| texto primário / surface    | `17.40:1` | `14.66:1` |
| texto secundário / surface  | `4.83:1`  | `6.63:1`  |
| texto do botão / brand      | `9.00:1`  | `4.53:1`  |
| link / surface              | `9.00:1`  | `5.34:1`  |
| focus ring / surface        | `9.00:1`  | `5.34:1`  |
| borda de controle / surface | `4.83:1`  | `6.63:1`  |

Badges dark de `success`, `warning`, `danger` e `info` ficaram entre `5.11:1` e `6.28:1`
para texto sobre seus fundos compostos. Cada primitivo criado na Fase 2 deve repetir a
validação nos estados default, hover, focus, disabled, loading e erro.

Na validação do Shell da Fase 3, `--brand-soft` dark foi ajustado de opacidade `0.16` para
`0.12`. O par `--brand-text` / `--brand-soft` composto sobre `--surface`, usado por itens de
navegação ativos e badges de marca, passou de `4.39:1` para `4.63:1` (WCAG AA).

## 10. Compatibilidade com o CSS legado

A transição segue estas regras:

1. `base.css` não é reescrito nem removido em massa;
2. `legacy.css` é o único ponto que importa o monólito e o mantém na layer `legacy`;
3. aliases antigos (`--g`, `--wh`, `--tx`, `--mu`, `--mut`, `--br`, `--bd`, `--r`, `--rs`
   etc.) continuam disponíveis;
4. aliases legados permanecem estáveis mesmo quando o tema dark muda os tokens semânticos;
5. colisões de nome entre legado e semânticos novos usam aliases `--legacy-*` até a migração;
6. nenhuma classe ou variável antiga é removida antes de todos os consumidores migrarem;
7. a limpeza ocorre por tela/componente concluído, acompanhada de busca por consumidores;
8. Preflight e regras globais novas não podem alterar telas ainda fora de `.fv-ds`.

O estado desejado é coexistência temporária:

```text
novo Design System  → tokens semânticos + Tailwind + .fv-ds
frontend não migrado → legacy.css + aliases estáveis
```

## 11. Entrada da Fase 2

A próxima fase deve começar pelos componentes primitivos e não pelo Hub ou por módulos de
domínio. A implementação só começa após autorização explícita. A ordem recomendada permanece:

1. Button e IconButton;
2. Input, Select, Textarea e Field;
3. Badge/StatusPill e Alert;
4. Spinner, Skeleton e estados vazios;
5. Card, Modal, Popover e Dropdown;
6. testes de acessibilidade, light/dark e responsividade dos primitivos.
