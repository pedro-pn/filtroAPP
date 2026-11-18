# 02 — Componentes

Cada componente segue o mesmo formato: **Finalidade · Aparência · Variantes · Tamanhos ·
Estados · Comportamento · Props · Responsividade · Acessibilidade · Exemplo**.

Convenções gerais para todos os componentes:

- Consomem **apenas tokens semânticos** (nada de hex/px de cor).
- Raio padrão `--radius-md`; badges/chips `--radius-sm`.
- Foco sempre visível: anel de 2px `--focus-ring`, `outline-offset: 2px`.
- Alvo de toque mínimo **44×44px** em mobile.
- Props de estilo livre (`className`) são permitidas para _layout_ (margem/posição no pai),
  **nunca** para redefinir cor/tipografia do componente.
- Todos os textos em **pt-BR**.

Legenda de props: `?` = opcional.

---

## Componentes de fundação — implementados na Fase 1

| Componente    | Local                            | Contrato                                                                  |
| ------------- | -------------------------------- | ------------------------------------------------------------------------- |
| `BrandLogo`   | `components/brand/BrandLogo.tsx` | seleciona exclusivamente assets oficiais; `adaptive` acompanha light/dark |
| `AppIcon`     | `components/icons/AppIcon.tsx`   | wrapper obrigatório para Lucide; tamanhos 16/20/24px e stroke 1.75        |
| `ThemeToggle` | `theme/ThemeToggle.tsx`          | alterna `light → dark → system` com rótulo acessível                      |

`BrandLogo` aceita `adaptive`, `color`, `white`, `header`, `login`, `symbol` e `green`.
`AppIcon` é decorativo por padrão e recebe `label` quando o SVG comunica informação própria.
O catálogo completo de assets, tema e convenções está em
[`07-foundation-phase-1.md`](./07-foundation-phase-1.md).

Os primitivos `Button`, `IconButton`, `Field`, `Input`, `Select`, `Textarea`, `Badge`,
`StatusPill`, `Alert`, `Spinner`, `Skeleton`, `EmptyState` e `Card` estão implementados em
`frontend/src/components/ui/ds/`. O `Modal` compartilhado possui uma aparência
`design-system` opt-in e mantém `legacy` como padrão enquanto seus consumidores ainda não
foram migrados. Os demais componentes deste documento continuam sendo especificação para as
fases seguintes.

---

## Button

**Finalidade.** Ação primária/secundária em formulários, toolbars, cards, modais.

**Aparência.** Retângulo com `--radius-md`, texto `--font-medium`, ícone opcional 16–20px,
`gap --space-2`. Padding simétrico conforme tamanho.

**Variantes.**

| Variante    | Fundo                             | Texto                                      | Borda                          | Uso                             |
| ----------- | --------------------------------- | ------------------------------------------ | ------------------------------ | ------------------------------- |
| `primary`   | `--brand` (hover `--brand-hover`) | `--on-brand`                               | —                              | ação principal (1 por contexto) |
| `secondary` | `--surface`                       | `--ink`                                    | `--line` (hover `--surface-2`) | ação secundária                 |
| `ghost`     | transparente                      | `--ink` (hover `--surface-2`)              | —                              | ações em toolbar/linha          |
| `danger`    | `--danger`                        | `#fff`                                     | —                              | ação destrutiva confirmada      |
| `link`      | transparente                      | `--link` sublinhado (hover `--link-hover`) | —                              | navegação inline                |

**Tamanhos.**

| Tamanho | Altura | Padding X        | Fonte         |
| ------- | ------ | ---------------- | ------------- |
| `sm`    | 32px   | `--space-3` (12) | `--text-sm`   |
| `md`    | 40px   | `--space-4` (16) | `--text-base` |
| `lg`    | 48px   | `--space-5` (20) | `--text-md`   |

**Estados.** default · hover · active/pressed · `focus-visible` (anel) · disabled
(opacidade 45%, sem eventos) · **loading** (spinner embutido substitui o ícone à esquerda;
largura preservada; `aria-busy="true"`).

**Comportamento.** `type` explícito (`button`/`submit`). Em loading, bloqueia cliques. Ícone
à esquerda por padrão; `iconRight` para direção/expansão. `fullWidth` estica no mobile.

**Props.**

```ts
type ButtonProps = {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "link"; // default 'secondary'
  size?: "sm" | "md" | "lg"; // default 'md'
  loading?: boolean;
  disabled?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
  type?: "button" | "submit" | "reset";
  onClick?: (e) => void;
  children: ReactNode;
};
```

**Responsividade.** Em `< md`, ações primárias de formulário podem usar `fullWidth`.
Toolbar de ações vira barra fixa inferior no fluxo de formulários longos (ver RDO).

**Acessibilidade.** `<button>` real (nunca `div` clicável). Botão só-ícone exige
`aria-label`. Estado loading anuncia via `aria-busy`. Foco nunca removido sem substituto.

**Exemplo.**

```tsx
<Button
  variant="primary"
  size="md"
  loading={saving}
  iconLeft={<AppIcon icon={Save} size="sm" />}
>
  Salvar RDO
</Button>
```

---

## Input

**Finalidade.** Entrada de texto de linha única (texto, e-mail, número, data, hora, senha).

**Aparência.** Altura 40px (`md`), fundo `--surface`, borda `--line` (`--radius-md`),
texto `--text-md`, placeholder `--muted`. **`font-size: 16px` no mobile** para evitar zoom do
iOS — uniforme, não só em `type=time`.

**Anatomia.** `label` (sempre visível, `--text-sm --font-medium`) → campo →
`helperText`/`errorText` (`--text-xs`). Suporta `prefix`/`suffix` (ícone ou texto) e
addon (ex.: unidade).

**Tamanhos.** `sm` 32px · `md` 40px (padrão) · `lg` 48px.

**Estados.** default · hover (borda `--line-strong`) · focus (anel `--focus-ring` +
borda `--line-strong`) · **error** (borda `--danger-line`, texto de erro `--danger`) ·
disabled (fundo `--surface-2`, texto `--muted`) · readonly · com valor · required (`*`).

**Comportamento.** Validação exibida no blur/submit (integra com `react-hook-form` + `zod`
já usados). Mensagem de erro substitui o helper. Contador opcional para `maxLength`.

**Props.**

```ts
type InputProps = {
  label?: string;
  helperText?: string;
  errorText?: string;
  size?: "sm" | "md" | "lg";
  prefix?: ReactNode;
  suffix?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  type?: "text" | "email" | "number" | "password" | "date" | "time" | "tel";
  // + atributos nativos de input
};
```

**Responsividade.** Largura 100% do container. Em grid de formulário, ocupa 1 coluna (mobile)
→ colunas nomeadas no desktop (ver formulários em doc 03).

**Acessibilidade.** `label` associado via `htmlFor`/`id`. Erro ligado por
`aria-describedby` e `aria-invalid="true"`. Nunca usar placeholder como label.

**Exemplo.**

```tsx
<Input
  label="Horímetro"
  type="number"
  suffix="h"
  required
  errorText={errors.horimetro?.message}
  {...register("horimetro")}
/>
```

---

## Select

**Finalidade.** Escolha de um valor em lista curta/média fechada.

**Aparência.** Idêntica ao Input (mesma altura/borda/radius) + chevron `--muted` à direita.
Opções em popover com `--shadow-e2`, item ativo em `--brand-soft`.

**Variantes.** `select` (nativo estilizado, listas curtas) · `combobox` (com busca, listas
longas — ex.: cliente, equipamento). Multi-seleção usa chips removíveis dentro do campo.

**Tamanhos.** iguais ao Input (`sm`/`md`/`lg`).

**Estados.** iguais ao Input + `open` (popover visível) e `empty` ("Nenhum resultado").

**Comportamento.** Combobox filtra por debounce; teclado navega (↑/↓/Enter/Esc). Placeholder
"Selecione…". Valor limpável quando não-required (`clearable`).

**Props.**

```ts
type SelectProps = {
  label?: string;
  options: { value: string; label: string; disabled?: boolean }[];
  value?: string | string[];
  onChange: (v) => void;
  searchable?: boolean; // vira combobox
  multiple?: boolean;
  clearable?: boolean;
  placeholder?: string;
  size?: "sm" | "md" | "lg";
  errorText?: string;
  disabled?: boolean;
};
```

**Responsividade.** Em `< md`, comboboxes com muitas opções podem abrir como BottomSheet de
seleção. Popover nunca ultrapassa a viewport (flip/scroll automático).

**Acessibilidade.** `role="combobox"`/`listbox`/`option`, `aria-expanded`,
`aria-activedescendant`. Foco preso na lista aberta; Esc fecha e devolve foco ao campo.

---

## Search (SearchBar)

**Finalidade.** Busca textual de listas/tabelas. Consolida a `SearchBar` atual +
`usePersistentSearch`/`useDebouncedValue`/`useUrlParamState`.

**Aparência.** Input com ícone de lupa à esquerda (`--muted`), botão limpar (×) à direita
quando há texto. Altura 40px. Radius `--radius-md`.

**Variantes.** `inline` (dentro de toolbar) · `full` (largura total, topo de lista mobile).

**Estados.** vazio (placeholder) · digitando (debounce) · com valor (botão limpar) ·
loading (spinner no lugar da lupa) · sem resultados (delega ao EmptyState da lista).

**Comportamento.** Debounce padrão 300ms. Persiste em URL (`?q=`) e/ou storage, mantendo o
comportamento atual. Enter dispara busca imediata. Respeita IME (não buscar durante composição).

**Props.**

```ts
type SearchProps = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string; // default "Buscar…"
  debounceMs?: number; // default 300
  loading?: boolean;
  variant?: "inline" | "full";
};
```

**Acessibilidade.** `role="searchbox"`, `aria-label`. Botão limpar com `aria-label="Limpar busca"`.
Resultados anunciados via região `aria-live="polite"` (contagem).

---

## Card

**Finalidade.** Agrupar conteúdo relacionado. **Substitui as ~102 variações de card** do CSS atual.

**Aparência.** `--surface`, borda `--line`, `--radius-lg`, `--shadow-e1`, padding conforme prop.
Slots: `header` (título + ação/menu), `body`, `footer`.

**Variantes.** `default` · `interactive` (hover eleva para `--shadow-e2`, cursor pointer —
usado em cards de módulo/lista clicável) · `flat` (`--shadow-e0`, para grids internos) ·
`accent` (faixa/realce de status via token — usar com parcimônia).

**Tamanhos (padding).** `sm` `--space-4` · `md` `--space-5` (padrão) · `lg` `--space-6`.

**Estados.** default · hover (só `interactive`) · `focus-visible` (quando clicável) · selected
(borda `--brand`, fundo `--brand-softer`) · loading (Skeleton dentro do body).

**Comportamento.** Se clicável, o card inteiro é um `<button>`/`<a>` acessível. `header` e
`footer` são opcionais. Não empilhar sombras (um card não contém outro elevado).

**Props.**

```ts
type CardProps = {
  variant?: "default" | "interactive" | "flat" | "accent";
  padding?: "sm" | "md" | "lg";
  accentTone?: "brand" | "success" | "warning" | "danger" | "info"; // só com variant accent
  header?: ReactNode;
  footer?: ReactNode;
  onClick?: () => void;
  children: ReactNode;
};
```

**Responsividade.** Em grids, colapsa de N colunas → 1 coluna no mobile (ver doc 03).
Padding reduz um passo em `< md`.

**Acessibilidade.** Card clicável = elemento interativo real com `aria-label`/texto claro.
Não aninhar controles interativos dentro de um card clicável (evitar clique ambíguo).

---

## Badge

**Finalidade.** Rótulo curto de categoria/contagem/atributo. (Ver `StatusPill` para _status_ de fluxo.)

**Aparência.** Pílula `--radius-sm`, `--text-xs --font-medium`, `padding 2px 8px`, borda 1px,
`dot` opcional (bolinha `bg-current`).

**Variantes (tone).** `neutral` (`--surface-2`/`--muted`) · `brand` (`--brand-soft`/`--brand`) ·
`success` · `warning` · `danger` · `info` — cada feedback usa `*-bg` / `*` / `*-line`.

**Tamanhos.** único (xs). Para contagem em nav, versão circular mínima (`--space-4` de altura).

**Estados.** estático. Pode ser removível (`onRemove` → × ) quando usado como chip de filtro.

**Props.**

```ts
type BadgeProps = {
  tone?: "neutral" | "brand" | "success" | "warning" | "danger" | "info";
  dot?: boolean;
  onRemove?: () => void; // vira chip removível
  children: ReactNode;
};
```

**Acessibilidade.** Se comunica status por cor, incluir texto (nunca só cor). `dot` é
`aria-hidden`. Chip removível: botão × com `aria-label`.

---

## StatusPill

**Finalidade.** Representar o **status de um fluxo de negócio** de forma unificada.
**Substitui** `badge-ok/pen/rej/rev/signed`, `equip-badge-*`, `privacy-status-*`, `ops-pill`,
`rtype-badge` e afins.

**Aparência.** Igual ao Badge, com `dot` por padrão. A cor deriva de um **mapa status → tone**,
não de classe por módulo.

**Mapa canônico (estender no código, nunca duplicar cores):**

| Status                                           | tone      |
| ------------------------------------------------ | --------- |
| aprovado / concluído / assinado / ativo / válido | `success` |
| pendente / aguardando / em análise / a vencer    | `warning` |
| rejeitado / vencido / cancelado / erro / inativo | `danger`  |
| em revisão / rascunho / informativo              | `info`    |
| neutro / não iniciado / N/A                      | `neutral` |

**Props.**

```ts
type StatusPillProps = {
  status: string; // chave do domínio (ex.: 'aprovado')
  // resolve tone via mapa central `statusToTone`
  label?: string; // texto exibido (default = status capitalizado)
};
```

**Regra.** Novo status de domínio → adicionar entrada no mapa `statusToTone` central.
**Proibido** criar nova cor/classe de pílula por módulo.

**Acessibilidade.** Texto sempre presente além do `dot`. Contraste AA garantido pelos tokens.

---

## Alert (banner inline)

**Finalidade.** Mensagem contextual dentro da página/formulário (não temporária).
Substitui `form-error`, `inline-error`, `ops-error` e blocos de aviso ad-hoc.

**Aparência.** Bloco `--radius-md`, fundo `*-bg`, borda `*-line`, ícone à esquerda (`*`),
título `--font-semibold` + descrição `--text-sm`. Ação/fechar opcionais à direita.

**Variantes (tone).** `info` · `success` · `warning` · `danger`.

**Estados.** estático · dispensável (`onClose`) · com ação (botão `link`/`secondary`).

**Props.**

```ts
type AlertProps = {
  tone?: "info" | "success" | "warning" | "danger";
  title?: string;
  children?: ReactNode; // descrição
  action?: { label: string; onClick: () => void };
  onClose?: () => void;
};
```

**Responsividade.** Full-width no container; em `< sm`, ação vai para linha abaixo.

**Acessibilidade.** `role="status"` (info/success) ou `role="alert"` (warning/danger).
Ícone `aria-hidden`. Botão fechar com `aria-label="Dispensar"`.

---

## Modal

**Finalidade.** Interação focal bloqueante (formulário, confirmação, detalhe).
Mantém a **excelente base de a11y** do `Modal.tsx` atual (focus trap, Esc, restauração de foco).

**Aparência.** Backdrop `--z-overlay` (preto translúcido), painel `--surface`, `--radius-lg`,
`--shadow-e3`. Header (título + fechar) fixo, body rolável, footer de ações fixo.

**Tamanhos.** `sm` 420px · `md` 560px · `lg` 720px · `full` (quase full viewport).
**Em `< md`, todo modal vira fullscreen** (ou BottomSheet — ver regra em doc 03).

**Estados.** aberto/fechado (com transição) · loading (Skeleton/spinner no body) ·
confirmação destrutiva (ação primária `danger`).

**Comportamento.** `closeOnBackdrop` default `false` para formulários (evita perda de dados),
`true` para diálogos leves. Esc fecha (salvo em fluxos com dados sujos → confirmar).
Scroll do body travado enquanto aberto. Foco inicial no primeiro campo/ação.

**Props.**

```ts
type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: "sm" | "md" | "lg" | "full";
  closeOnBackdrop?: boolean; // default false
  footer?: ReactNode;
  children: ReactNode;
};
```

**Acessibilidade.** `role="dialog"`, `aria-modal="true"`, `aria-labelledby` (título). Focus
trap + restauração de foco ao elemento disparador. Botão fechar com `aria-label="Fechar"`.

---

## BottomSheet

**Finalidade.** Equivalente mobile do Modal/menu de ações: painel que sobe pela base.
Usado para ações contextuais, seleção longa e formulários curtos em `< md`.

**Aparência.** Painel ancorado embaixo, `--surface`, cantos superiores `--radius-xl`,
`--shadow-e3`, "grabber" (barra) no topo. Backdrop `--z-overlay`.

**Variantes.** `actions` (lista de ações) · `form` (campos curtos) · `picker` (seleção).

**Tamanhos.** `auto` (conteúdo) · `half` (50vh) · `full` (quase full). Arrasto para fechar.

**Estados.** aberto/fechado · arrastando · snap points.

**Comportamento.** Fecha por: arrasto para baixo, toque no backdrop, Esc, botão. Trava scroll
do fundo. É o destino automático de menus "⋯" e modais pequenos no mobile.

**Props.**

```ts
type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: "auto" | "half" | "full";
  children: ReactNode;
};
```

**Acessibilidade.** Mesmas regras do Modal (`role="dialog"`, `aria-modal`, focus trap).
Grabber é `aria-hidden`; sempre haver botão/fechar acessível por teclado.

---

## DataTable

**Finalidade.** Exibir dados tabulares densos (11+ telas com `<table>` hoje). Componente
**único** e responsivo — substitui as tabelas ad-hoc.

**Aparência.** `--surface`, cabeçalho `--surface-2` **sticky** (`--z-sticky`), linhas com
divisória `--line`, hover `--surface-2`. Zebra opcional. Números alinhados à direita com `.tabular`.

**Densidade.** `comfortable` (linha ~52px) · `compact` (linha ~40px). Padrão `comfortable`.

**Recursos.** ordenação por coluna, seleção (checkbox), paginação **ou** scroll infinito,
coluna de ações (botões `ghost`/menu ⋯), estados de loading/empty/error integrados.

**Estados.** loading (linhas Skeleton) · empty (EmptyState no corpo) · error (Alert +
"Tentar novamente") · vazio-por-filtro ("Nenhum resultado para os filtros").

**Comportamento responsivo (regra central).**

- **≥ md:** tabela real, cabeçalho sticky, scroll vertical no container.
- **< md:** cada linha vira um **Card de par chave→valor** (definition list). Colunas
  marcadas como `primary` viram título do card; as demais listadas abaixo; ações no rodapé
  do card. **Fim do scroll horizontal** sofrido no antigo container de 420px.

**Props.**

```ts
type Column<T> = {
  key: keyof T | string;
  header: string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  numeric?: boolean; // aplica .tabular + align right
  primary?: boolean; // vira título no modo card (mobile)
  render?: (row: T) => ReactNode;
  hideOnMobile?: boolean;
};
type DataTableProps<T> = {
  columns: Column<T>[];
  data: T[];
  density?: "comfortable" | "compact";
  selectable?: boolean;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  emptyState?: ReactNode;
  rowActions?: (row: T) => ReactNode;
  onRowClick?: (row: T) => void;
  sort?: { key: string; dir: "asc" | "desc" };
  onSortChange?: (s) => void;
};
```

**Acessibilidade.** `<table>` semântica com `<th scope="col">`; ordenação anuncia
`aria-sort`. No modo card mobile, usar `<dl>`/`<dt>`/`<dd>`. Linha clicável não engole os
controles de ação (foco separado).

---

## EmptyState

**Finalidade.** Comunicar ausência de dados e oferecer próximo passo. Substitui `colab-empty`,
`stats-empty`, `tech-summary-empty` etc.

**Aparência.** Centralizado: ícone `--muted` (24–32px) → título `--text-lg --font-semibold`
→ descrição `--text-sm --muted` → CTA opcional (`Button primary`). Sem ilustrações pesadas.

**Variantes.** `default` (lista vazia) · `search` (sem resultados de busca/filtro) ·
`error` (falha ao carregar; CTA "Tentar novamente") · `create` (primeiro uso; CTA de criação).

**Props.**

```ts
type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  variant?: "default" | "search" | "error" | "create";
};
```

**Acessibilidade.** `role="status"` para vazio; `role="alert"` para erro. Ícone `aria-hidden`.

---

## Skeleton

**Finalidade.** Placeholder de carregamento. Generaliza o `Skeleton` já existente.

**Aparência.** Bloco `--surface-2` com shimmer sutil, `--radius-sm/md`. Respeita a **altura e o
formato do conteúdo real** (evita "flash"/layout shift).

**Variantes.** `text` (linha) · `block` (retângulo) · `circle` (avatar) · `table-rows`
(N linhas) · `card` (estrutura de card).

**Props.**

```ts
type SkeletonProps = {
  variant?: "text" | "block" | "circle" | "table-rows" | "card";
  width?: string | number;
  height?: string | number;
  lines?: number; // para variant text/table-rows
};
```

**Comportamento.** Usado para carregamento de conteúdo/listas/tabelas. Para **ações pontuais**
(salvar), usar o spinner do Button, não Skeleton.

**Acessibilidade.** Container com `aria-busy="true"` e `aria-live="polite"`; texto `sr-only`
"Carregando…". Skeleton em si é `aria-hidden`.

---

## Toast

**Finalidade.** Feedback transitório de resultado de ação. Evolui o `Toast.tsx` atual.

**Aparência.** Cartão `--surface`, `--shadow-e2`, `--radius-md`, ícone de tom à esquerda,
texto + ação/fechar. Empilha no canto (desktop: inferior-direito; mobile: topo ou inferior
acima da BottomBar). Camada `--z-toast`.

**Variantes (tone).** `success` · `warning` · `danger` · `info` · `neutral`.

**Estados.** entrando/saindo (transição) · **pausa no hover/focus** · com ação (ex.: "Desfazer").

**Comportamento.** Duração padrão 4s; **pausa ao hover/focus** e retoma ao sair (melhoria
sobre o atual, que era fixo em 4s). Ações destrutivas devem oferecer "Desfazer" quando viável.
Máx. ~3 visíveis; excedentes enfileiram.

**Props.**

```ts
type ToastOptions = {
  tone?: "success" | "warning" | "danger" | "info" | "neutral";
  title: string;
  description?: string;
  duration?: number; // default 4000; 0 = persistente
  action?: { label: string; onClick: () => void };
};
```

**Acessibilidade.** Região `aria-live="polite"` (ou `assertive` para erro). Fechar com
`aria-label`. Não usar apenas cor para o tom (ícone + texto).

---

## Sidebar

**Finalidade.** Navegação primária **no desktop (≥ lg)**. Lista os módulos do Hub por papel
(reaproveita `moduleRegistry`/`moduleNavigation`).

**Aparência.** Coluna fixa à esquerda (largura 260px; `collapsed` 72px), `--surface`, borda
direita `--line`. Topo: logo/nome. Grupos rotulados ("Principal", "Módulos"). Item = ícone
20px + label + `Badge` de contagem opcional. Rodapé: Suporte, Configurações, perfil.

**Estados do item.** default · hover (`--brand-softer`) · **ativo** (`--brand-soft`, texto/
ícone `--brand`, indicador à esquerda) · focus-visible · disabled (sem permissão).

**Comportamento.** `expanded`/`collapsed` (persistido). Item ativo derivado da rota. Grupos
colapsáveis opcionais. Não rola com o conteúdo (fixa). Camada `--z-sidebar`.

**Props.**

```ts
type NavItem = {
  label: string;
  href: string;
  icon: ReactNode;
  badge?: number;
  roles?: string[]; // filtragem por papel
};
type SidebarProps = {
  groups: { label?: string; items: NavItem[] }[];
  collapsed?: boolean;
  onToggle?: () => void;
  activeHref: string;
};
```

**Responsividade.** **Some em `< lg`** — vira drawer acionado pelo botão "Menu" da TopBar/
BottomBar (mesmos itens). Ver doc 03.

**Acessibilidade.** `<nav aria-label="Navegação principal">`, item ativo `aria-current="page"`.
Ícones decorativos `aria-hidden`; item colapsado mostra label via tooltip + `aria-label`.

---

## TopBar

**Finalidade.** Cabeçalho de contexto: identificação da tela + ações globais.

**Aparência.** Barra superior `--surface`, borda inferior `--line`, `--z-sticky` (sticky no
topo do conteúdo). Esquerda: (mobile) botão menu + título; (desktop) breadcrumb. Centro
(≥ md): Search global. Direita: toggle de tema, notificações (com Badge), avatar/perfil.

**Estados.** padrão · com busca · com notificações não lidas (Badge).

**Comportamento.** Sticky ao rolar. No mobile concentra menu + título; busca pode recolher em
ícone que expande. Não duplica navegação da Sidebar.

**Props.**

```ts
type TopBarProps = {
  breadcrumb?: { label: string; href?: string }[];
  onOpenMenu?: () => void; // mobile → abre drawer
  showSearch?: boolean;
  right?: ReactNode; // slots extras
};
```

**Responsividade.** Breadcrumb → título simples em `< md`. Search central → ícone expansível.
Ações menos usadas migram para menu "⋯".

**Acessibilidade.** `<header>` + landmarks. Botões só-ícone com `aria-label`. Notificações
anunciam contagem.

---

## BottomBar (tab bar mobile)

**Finalidade.** Navegação primária **no mobile (< lg)**. Preserva o padrão atual de BottomBar.

**Aparência.** Barra fixa inferior `--surface`, borda superior `--line`, `--z-bottombar`,
até 5 itens (ícone 24px + label `--text-xs`). Item central pode ser **FAB "Novo"** (ação de
criação em `--brand`). Respeita `safe-area-inset-bottom`.

**Estados do item.** default (`--muted`) · ativo (`--brand`) · com badge de contagem.

**Comportamento.** Reflete a rota ativa. "Menu" abre o drawer com todos os módulos (os que não
cabem nos 5 tabs). FAB abre BottomSheet/rota de criação contextual.

**Props.**

```ts
type BottomBarProps = {
  items: NavItem[]; // até 4 + FAB
  fab?: { label: string; icon: ReactNode; onClick: () => void };
  activeHref: string;
};
```

**Responsividade.** **Some em `≥ lg`** (dá lugar à Sidebar). Alvos ≥ 44px.

**Acessibilidade.** `<nav aria-label="Navegação">`, item ativo `aria-current="page"`, labels
sempre presentes (não só ícone).

---

## PageHeader

**Finalidade.** Cabeçalho **de conteúdo** de cada página (abaixo da TopBar): título, subtítulo,
ações primárias da tela.

**Aparência.** Título `--text-xl --font-bold` + subtítulo/descrição `--text-sm --muted` à
esquerda; cluster de ações à direita (Button primary + secundárias). Espaço inferior `--space-6`.

**Variantes.** `default` · `withTabs` (abas abaixo) · `withFilters` (barra de filtros integrada).

**Estados.** padrão · loading (Skeleton de título) · com contagem/summary (ex.: "128 registros").

**Props.**

```ts
type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  tabs?: { label: string; href: string }[];
  meta?: ReactNode; // contagem, período, etc.
};
```

**Responsividade.** Em `< md`, ações descem para linha própria (ou a ação primária vira FAB da
BottomBar). Título encolhe para `--text-lg`.

**Acessibilidade.** Título é o `<h1>` da página. Abas com `role="tablist"`/`tab`.

---

## Filtros (FilterBar)

**Finalidade.** Padronizar as barras de filtro hoje divergentes (`acp-pcards-filters`,
`admin-card-toolbar`, etc.) em **um** padrão.

**Aparência.** Faixa horizontal: Search (esquerda) + controles de filtro (Selects/date range/
toggles) + botão "Limpar". Filtros aplicados aparecem como **chips removíveis** (Badge com
`onRemove`) logo abaixo. Fundo `--surface`/`--canvas-subtle`.

**Variantes.** `inline` (desktop, tudo em linha) · `drawer/sheet` (mobile: botão "Filtros" abre
BottomSheet com os controles) · `compact` (poucos filtros).

**Estados.** sem filtro · com filtros (chips + contador no botão "Filtros") · loading (aplica
skeleton na lista/tabela associada).

**Comportamento.** Estado persistido em URL (`useUrlParamState`) e/ou storage, como já ocorre.
Debounce na busca. "Limpar" reseta todos. Contagem de filtros ativos exibida no botão mobile.

**Props.**

```ts
type FilterBarProps = {
  search?: SearchProps;
  children: ReactNode; // controles (Select, DateRange, Toggle…)
  activeChips?: { label: string; onRemove: () => void }[];
  onClear?: () => void;
  layout?: "inline" | "sheet" | "compact";
};
```

**Responsividade.** **≥ md:** inline. **< md:** Search fica visível; demais controles vão para
BottomSheet acionado por botão "Filtros (N)". Chips ativos roláveis horizontalmente.

**Acessibilidade.** Cada controle rotulado. Região de resultados `aria-live`. Chips removíveis
com `aria-label="Remover filtro X"`.

---

## Upload de PDF — opt-in implementado em 10/09/2026

O `components/ui/PdfDropzone` aceita `appearance="design-system"`. O padrão
continua `legacy` para preservar módulos ainda não migrados. A variante DS usa
tokens de superfície, foco e erro nos dois temas, `AppIcon` para upload e
`IconButton` secundário para remover o arquivo selecionado. O botão de remoção
funciona também por teclado sem abrir novamente o seletor de arquivos.

Mantidos `onFile`, `onFiles`, arraste/clique, arquivo atual e regras do formulário
consumidor. Nomes extensos podem quebrar dentro da área de upload; o alvo de
remoção possui 44px no mobile. Primeiro consumidor: Novo documento em Assinaturas.

## BarList — implementado em 10/09/2026

Lista comparativa compartilhada em `components/ui/ds/BarList.tsx`, usada primeiro
pelos dois painéis do Dashboard de Acompanhamento. Recebe `items` com `id`, `label`,
`description?`, `valueLabel` e `percentage`, além de `aria-label` obrigatório.

O consumidor calcula o recorte, a ordenação e a proporção; o componente não calcula
valores de negócio. Cada item mantém o valor exato em texto e uma barra decorativa
(`aria-hidden`), sem anunciar percentuais normalizados como progresso real. Larguras
são limitadas a 0–100, com fallback zero para números não finitos. Rótulos extensos
e valores podem ocupar linhas separadas sem truncamento ou scroll. Superfície e
preenchimento usam `--surface-2` e `--brand-text` nos dois temas.

## ProgressBar — implementado em 10/09/2026

Barra compartilhada em `components/ui/ds/ProgressBar.tsx`, usada primeiro nos cards
de Projetos do Acompanhamento. Recebe `label`, `value`, `valueLabel`, `tone?` e
`segments?` (cada segmento com `value` e `tone?`). Não calcula percentuais de negócio.

O texto fornecido pelo consumidor mantém o valor exato, inclusive acima de 100%.
A geometria é decorativa (`aria-hidden`) e limitada a 0–100; segmentos ocupam somente
o espaço restante. Valores ausentes, negativos ou não finitos ocupam largura zero.
Horas normais e HE usam a mesma barra segmentada, com quantidades também em texto.
Tokens semânticos garantem aparência nos dois temas; rótulos e valores podem
ocupar linhas distintas, sem truncamento obrigatório.

## Confirmações — erro de gravação opcional

`components/ui/ConfirmDialog` aceita `errorMessage?: string | null` para exibir
falhas **dentro do diálogo**, junto ao contexto da operação. Na aparência DS usa
`Alert tone="danger"`; na legada mantém `form-error` com `role="alert"`.
Sem a propriedade, o comportamento dos demais consumidores permanece igual.
O controller continua responsável por bloquear envios duplicados, manter a caixa
aberta durante a operação e limpar a mensagem quando apropriado.

## Button — rótulos extensos

`multiline` é uma opção explícita para títulos clicáveis extensos: altura automática,
quebra de texto e alinhamento inicial, mantendo o tamanho mínimo do controle e o
alvo mobile. Disponível para títulos clicáveis; os cards de Projetos passaram a
usar `Card.surfaceAction` no refinamento posterior. O padrão permanece
em uma linha; ações de rodapé e toolbars não devem habilitar essa opção.

## Refinamentos de cards, contadores e avisos — 10/09/2026

- `Card.surfaceAction={{ label, onClick, pressed? }}` torna a superfície clicável
  por botão nativo independente, sem envolver controles internos em outro botão.
  Enter/espaço e foco visível cobrem o card; campos, links, botões, labels, forms e
  alvos com `tabIndex` preservam sua interação. `data-card-interactive` reserva uma
  área adicional quando necessário. Não combinar com `href`/`onClick` da raiz.
  Durante renomeação inline, o consumidor remove a ação de superfície.
- `Button.counter` apresenta uma contagem separada do rótulo, com fundo sutil que
  acompanha a cor do botão, formato arredondado e números tabulares. Aceita zero e
  placeholder sem criar um badge específico por módulo. Primeiro uso: situações
  dos projetos no Acompanhamento.
- `Badge.multiline` permite avisos longos sem truncamento, mantendo tamanho pelo
  conteúdo e densidade de tag. Primeiro uso: avisos operacionais/finalização recente
  dos cards de projetos. Erros de consulta/gravação continuam usando `Alert`.
