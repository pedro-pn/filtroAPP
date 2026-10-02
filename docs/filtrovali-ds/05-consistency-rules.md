# 05 — Regras de Consistência

Estas regras existem para impedir que cada módulo volte a criar o próprio estilo — a causa
raiz da entropia do `base.css` atual (151 cores, ~102 cards, 70 `!important`, 23 breakpoints).

## ✅ FAÇA

1. **Use tokens semânticos** para toda cor, sombra, raio e espaçamento
   (`var(--surface)`, `var(--space-4)`, `var(--radius-md)`, `var(--shadow-e1)`).
2. **Reutilize os componentes do DS** (`Button`, `Card`, `Badge`, `StatusPill`, `DataTable`…).
   Precisa de algo novo? Estenda o componente via **prop/variante**, no próprio DS.
3. **Adicione status novos ao mapa central** `statusToTone` — nunca crie pílula/cor por módulo.
4. **Use a escala de espaçamento** (múltiplos de 4px) via `gap`.
5. **Use os 5 breakpoints oficiais** (`sm/md/lg/xl/2xl`).
6. **Respeite a hierarquia tipográfica** (`--text-*`, pesos definidos). Mínimo 12px.
7. **Garanta foco visível** e alvos ≥ 44px no mobile.
8. **Componha layout** com flexbox (padrão) e grid (2D). Responsivo com prefixos de breakpoint.
9. **Mantenha contraste AA** em qualquer par texto/fundo, nos dois temas.
10. **Coloque novidades de UI no DS**, com documentação, para todos reutilizarem.
11. **Delimite a migração com `.fv-ds`** no menor contêiner completamente migrado.
12. **Use utilitários Tailwind semânticos** (`bg-surface`, `text-ink`, `text-link`); CSS
    dedicado continua válido para a estrutura interna de um componente reutilizável.
13. **Use `AppIcon` para Lucide e `BrandLogo` para marca.** Esses wrappers centralizam as
    decisões que não devem ser repetidas por módulo.

## ❌ NÃO FAÇA

1. **Não crie novas cores** fora dos tokens. Proibido hex literal em componente/módulo.
   (Ex.: nada de mais um verde `#205c2f`, `#3d6449`…).
2. **Não crie valores arbitrários de spacing/radius/shadow** (`padding: 7px`, `border-radius:
   3px`, `box-shadow: ...` inline). Use a escala.
3. **Não crie um novo estilo de card por módulo** (`acp-pcard`, `admin-card`, `client-report-
   card`…). Use `Card` com props.
4. **Não crie badges específicos** (`badge-ok`, `equip-badge-expired`, `privacy-status-*`,
   `ops-pill`, `rtype-badge`). Use `Badge`/`StatusPill`.
5. **Não use `!important`** para resolver UI. Se precisou, o problema é de especificidade/
   arquitetura — corrija na origem.
6. **Não sobrescreva componentes por contexto** (`.rdo-bottom-actions .primary-button { … }`).
   Ajuste via props do componente.
7. **Não introduza breakpoints novos** (`430px`, `560px`, `860px`…). Use os 5 oficiais.
8. **Não use fontes < 12px** nem tamanhos fracionários (`12.5px`, `.78rem`).
9. **Não use `div` clicável** no lugar de `button`/`a`. Não remova foco sem substituto.
10. **Não dependa de tutorial/pop-up** para explicar algo que a UI deveria tornar óbvio —
    resolva com hierarquia, rótulos e estados vazios claros.
11. **Não use gradientes decorativos, blobs, ou números/ícones sem função.**
12. **Não use emoji como ícone** — usar `lucide-react` por meio de `AppIcon`.
13. **Não importe Preflight** e não use `@import 'tailwindcss'` diretamente. A integração
    aprovada importa apenas theme e utilities.
14. **Não use a paleta genérica do Tailwind** (`green-*`, `slate-*`, `red-*`) nem arbitrary
    colors. Use os tokens semânticos do Filtrovali DS.
15. **Não aplique `.fv-ds` em `#root`** enquanto alguma tela ainda depender do CSS legado.
16. **Não use `dark:` para repetir cores semânticas.** O componente consome o mesmo token;
    a classe `.dark` troca o valor na raiz.

## Governança

- **Fonte da verdade:** este handoff + `variables.css`. Divergência = bug.
- **Novo componente/variante:** entra no DS (`components/ui/`) com documentação, não em um módulo.
- **Ícones:** um único set (`lucide-react`) via `AppIcon`, tamanhos 16/20/24px, stroke 1.75.
- **Marca:** somente assets oficiais via `BrandLogo`; nunca substituir por ícone genérico.
- **Tokens:** alterar cor/tema = alterar token, nunca reescrever componentes.
- **Fronteira:** código novo entra em `.fv-ds`; legado permanece em `legacy.css` até migrar.
- **Revisão:** PR que introduza hex literal, `!important`, classe `*-card`/`*-badge` de módulo,
  ou breakpoint fora da escala deve ser rejeitado.
- **Definition of Done visual:** usa só tokens; passa em light e dark; responde aos 5
  breakpoints; foco visível; contraste AA; sem `!important`.
