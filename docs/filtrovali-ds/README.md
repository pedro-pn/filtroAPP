# Filtrovali DS — Especificação de Handoff (Designer → Desenvolvedor)

> Documento de referência para implementação do redesign no **projeto React existente**
> (`github.com/pedro-pn/filtroAPP`, pasta `frontend/`).
> Público-alvo: agente de programação (Codex / Claude Code) e desenvolvedores humanos.

## Objetivo

Consolidar toda a interface da Filtrovali em um **Design System único e tokenizado**,
substituindo o `base.css` monolítico (13.284 linhas, 151 cores, ~102 variações de card,
23 breakpoints, 70 `!important`) por uma camada de tokens + componentes reutilizáveis.

Esta documentação é **prescritiva**: os valores aqui são a fonte da verdade. O
implementador não deve inventar cores, espaçamentos, raios ou breakpoints fora do que
está especificado.

## Escopo deste handoff

- ✅ Especificação de tokens, componentes, layout, responsividade e regras.
- ✅ `variables.css` / tokens CSS sincronizados com a fundação implementada na Fase 1.
- ✅ Mapa de "de → para" das classes atuais.
- ❌ **Não** migra telas do projeto real.
- ❌ **Não** altera backend, APIs, rotas, autenticação ou lógica de negócio.
- ❌ **Não** reconstrói o app; apenas define a camada visual.

> **Estado atual:** a fundação técnica da Fase 1 está implementada. Consulte
> [`07-foundation-phase-1.md`](./07-foundation-phase-1.md) antes de iniciar componentes ou
> migrar qualquer tela.

## Índice

| # | Documento | Conteúdo |
|---|-----------|----------|
| 1 | [01-design-tokens.md](./01-design-tokens.md) | Cores primitivas e semânticas, tipografia, espaçamento, radius, bordas, elevação, breakpoints, z-index, light/dark |
| 2 | [02-components.md](./02-components.md) | Todos os componentes (Button → filtros): finalidade, variantes, tamanhos, estados, props, responsividade, a11y, exemplos |
| 3 | [03-layout-responsive.md](./03-layout-responsive.md) | Regras de layout (desktop/tablet/mobile), grids, comportamento responsivo por componente |
| 4 | [04-hub-dashboard.md](./04-hub-dashboard.md) | Especificação visual do Hub/Dashboard aprovado no protótipo |
| 5 | [05-consistency-rules.md](./05-consistency-rules.md) | O que fazer e o que **não** fazer para evitar divergência entre módulos |
| 6 | [06-migration-map.md](./06-migration-map.md) | Mapeamento das classes/componentes atuais → novos tokens/componentes |
| 7 | [07-foundation-phase-1.md](./07-foundation-phase-1.md) | Decisões técnicas implementadas na Fase 1: Tailwind, tema, marca, ícones e coexistência com o legado |
| 8 | [variables.css](./variables.css) | Tokens CSS completos (framework-agnóstico + variante Tailwind v4) |
| 9 | [rdo-form-redesign-study.md](./rdo-form-redesign-study.md) | Estudo e plano de migração exclusivamente visual do formulário de RDO |

## Princípios do sistema

1. **Tokens acima de valores literais.** Nenhum componente usa hex, px de cor, ou sombra
   literal — sempre via token semântico.
2. **Duas camadas de cor.** Primitivos (paleta bruta) → semânticos (uso). Componentes
   consomem apenas semânticos.
3. **Uma escala para cada dimensão.** Uma escala de espaçamento (base 4px), uma de radius,
   uma de elevação (4 níveis), uma de tipografia, 5 breakpoints oficiais.
4. **Um componente por conceito.** Um `Card`, um `Badge`, um `StatusPill`, um `DataTable` —
   variações via props, nunca via nova classe por módulo.
5. **Mobile-first + desktop real.** Fim do teto de 420px; layout fluido até 1280px com
   sidebar no desktop e tab bar no mobile.
6. **Acessível por padrão.** Foco visível, alvos de toque ≥ 44px, contraste AA, `aria-*`
   nos componentes interativos, suporte a `prefers-color-scheme` e toggle manual.

## Direção estética

**Utilitário-corporativo, limpo e denso-legível** — otimizado para trabalho de dados
prolongado. Verde industrial da marca (`#30503a`) preservado e domado em tokens.
Tipografia **Inter** com números tabulares. Superfícies neutras, elevação sutil,
cantos suaves (radius 6–14px). Suporte nativo a **light e dark mode**.
