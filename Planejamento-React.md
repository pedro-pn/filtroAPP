# Planejamento de Migração React — Pendências

> Branch: `app_v2_react` · Referência: `filtrovali_app_v4.html`
> Última atualização: 2026-05-06 (§18.35)
>
> A migração funcional principal está concluída. Abaixo estão os itens pendentes antes do cutover.

---

## P0 — Bloqueadores de cutover

- [x] **CC/assinantes unificados no projeto** (`GestorPage.tsx` `ProjectClientFields`): refatorado para entrada única de e-mail com lista/tags, botão `+ Adicionar`, toggle `Assinante?`, remoção por linha e nome por e-mail quando marcado como assinante. O editor também inclui assinantes existentes na lista unificada para não perdê-los ao salvar.
- [ ] **Cutover final**: trocar nginx/Express para servir React em `/` e `/reset-password`; remover dependência operacional do `filtrovali_app_v4.html`.

---

## P1 — Paridade funcional

- [x] **Edição inline nos CRUDs admin** (`GestorPage.tsx`): projeto, equipe/colaboradores, usuários internos, unidades, manômetros e contadores já abrem formulário `.admin-inline-form` no card correspondente ao clicar em "Editar".
- [x] **Aprovação/reprovação do cliente**: React agora replica os pontos principais do HTML: comentário opcional do cliente direto no card e no detalhe, envio do comentário na assinatura individual, reprovação e lote, status "Aguardando assinatura", bloqueio de ação em relatórios reprovados e histórico das últimas avaliações exibido na lista/detalhe. Fluxo de reaprovação pelo gestor já estava implementado.
- [ ] **Integração ZapSign**: ligar o fluxo de assinatura ao endpoint ZapSign real para iniciar testes de assinatura de relatórios. Verificar criação de documento, envio de link por e-mail e recebimento de callback de assinatura.
- [x] **Serviço finalizado permanece em "Em andamento"**: regra de continuidade reforçada em `NewReportPage`: serviços finalizados removem sugestões equivalentes por chaves explícitas (`__ongoingKey`, `__serviceLinkKey`, `__sourceServiceId`) e por chave semântica de projeto/tipo/equipamento/sistema, sem apagar serviços dos relatórios já enviados.
- [x] **Cliente — seleção e ações em lote**: checkboxes ficam visíveis nos relatórios selecionáveis; por padrão aparece apenas "Selecionar todos". Contador, limpar seleção, download em lote e assinatura em lote aparecem somente após existir seleção.
- [x] **Cliente — navegação por abas de projeto**: portal do cliente usa abas horizontais por projeto e abas por tipo de relatório, com card "Projeto atual", em vez de grupos recolhíveis.
- [ ] **Derivados editáveis?**: confirmar com stakeholder se RTP/RLQ/RCPU/RLM/RLF/RLI precisam de editor no React. HTML hoje só edita RDO. Resposta: os relatorios de serviços devem ser alterados através dos próprios RDOs que eles pertencem. Isto ocorre para manter o vinculo RDO/serviços.

---

## P2 — Validação e testes obrigatórios

- [ ] **Auto-refresh após arquivar projeto ou criar relatório**: ao arquivar um projeto e ao criar um relatório com serviços, a lista deve atualizar automaticamente via React Query sem precisar de refresh manual. Revisar invalidações de cache (`invalidateQueries`) nos handlers correspondentes.
- [ ] **Arquivados — separar por tipo de relatório**: aba "Arquivados" do gestor (projetos arquivados) deve subdividir os relatórios dentro de cada projeto por tipo (RDO, RTP, RLQ, etc.), igual ao que já ocorre na aba "Aprovados".
- [ ] **Toggle de detalhes nos cards de projeto**: adicionar botão para expandir/recolher os detalhes do card de projeto na aba Projetos. Estado do toggle deve ser persistido por conta (localStorage por userId+projectId) para que o usuário não precise reabrir toda vez.
- [ ] **Campo de pesquisa nas abas do gestor**: adicionar input de busca nas abas Aprovados, Projetos, Arquivados, Equipe, Usuários, Unidades, Manômetros e Contadores. Ao digitar, filtrar em tempo real os cards que contenham o texto em qualquer campo visível (nome, CNPJ, e-mail, projeto, número, etc.).
- [ ] **DOCX/PDF via React**: testar relatório criado no React com quebras de linha, unidades de comprimento, condições especiais (standby, noturno) e rascunho retomado. Confirmar que o DOCX gerado é equivalente ao do HTML.
- [ ] **RCPU com dois RDOs**: confirmar `Contagem inicial NAS` = dia 1 e `Contagem final NAS` = dia 2 após fix em `syncApprovedRcpReports` (`reports.js`).
- [ ] **Fotos legadas**: testar URL sem prefixo `/relatorios/` em uploads antigos (ex.: `Missão 9999 - Filtrovali/timestamp.jpeg`) com a normalização atual de `UploadField.tsx`.
- [ ] **Logo em produção**: validar `LOGO_HEADER.png` com `VITE_ASSETS_BASE_URL` configurado nas telas Home, Gestor, Coordenador e Cliente.
- [ ] **Troca de projeto pelo gestor**: abrir RDO, trocar projeto, alterar número, salvar/aprovar, gerar PDF/DOCX e confirmar líder/assinatura corretos.
- [ ] **Validação visual em navegador** (desktop + mobile): percorrer todas as telas comparando HTML × React — RDO (campos, toggles, continuidade), Gestor (CRUDs, cards inline, batch), Coordenador, Cliente.

---

## P3 — Polimento e acessibilidade

- [ ] **Responsividade fina em celular**: validação em dispositivo real para botões compactos e toasts não encobrirem ações.
- [ ] **Coordenador**: validar se densidade visual e agrupamento de relatórios correspondem ao padrão do gestor (sem CRUDs).
- [ ] **Acessibilidade restante**: foco-trap nos modais, navegação por teclado em tabs/tags, auditoria de contraste WCAG AA.
- [ ] **Componentes reutilizáveis**: extrair `Button` (primary/secondary/danger/mini) e `Modal` genérico — hoje são classes CSS soltas. Baixa prioridade, não afeta UI atual.

---

## Notas técnicas

- Dev local: `frontend/.env.local` com `VITE_API_BASE_URL=http://localhost:4000/api` e `VITE_ASSETS_BASE_URL=http://localhost:4000`.
- Build: `npm run build` em `frontend/`. Lint só emite avisos de Fast Refresh e dependências de hook — não bloqueiam build.
- O `filtrovali_app_v4.html` permanece referência funcional até o cutover.
- Node local é `18.19.1`; algumas dependências recomendam `>=20`.

---