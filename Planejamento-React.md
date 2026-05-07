# Planejamento de Migração React — Pendências Restantes

> Branch: `app_v2_react` · Referência: `filtrovali_app_v4.html`
> Última atualização: 2026-05-07
>
> A migração funcional principal está concluída. Os itens já implementados foram removidos da lista ativa. Abaixo ficam apenas o que ainda falta implementar e o que ainda precisa de validação manual.

---

## Falta Implementar

- [x] **Cutover final para React em produção**: trocar a entrega principal de `/` e `/reset-password` para a SPA React.

- [x] **Acessibilidade restante**: completar ajustes que não bloqueiam a UI atual, mas ainda faltam para uma revisão AA mais rigorosa.

- [x] **Componentes reutilizáveis de UI**: extrair componentes genéricos para reduzir duplicação de classes CSS soltas.

---

## Falta Testar Manualmente

- [ ] **Cutover em homologação**: após implementar o cutover, validar que `/`, `/reset-password` e rotas internas do React carregam diretamente pelo navegador e por refresh.
- [ ] **Link de redefinição de senha**: confirmar que o link enviado por e-mail abre `/reset-password?token=...` na SPA React e conclui a troca de senha.
- [ ] **DOCX/PDF via React**: criar relatório no React com quebras de linha, unidades de comprimento, condições especiais (standby, noturno) e rascunho retomado; confirmar equivalência do DOCX/PDF com o fluxo do HTML.
- [ ] **RCPU com dois RDOs**: confirmar `Contagem inicial NAS` = dia 1 e `Contagem final NAS` = dia 2 após o ajuste em `syncApprovedRcpReports` (`backend/src/routes/resources/reports.js`).
- [ ] **Fotos legadas**: testar URL sem prefixo `/relatorios/` em uploads antigos, por exemplo `Missão 9999 - Filtrovali/timestamp.jpeg`, com a normalização atual de `UploadField.tsx`.
- [ ] **Logo em produção**: validar `LOGO_HEADER.png` com `VITE_ASSETS_BASE_URL` configurado nas telas Home, Gestor, Coordenador e Cliente.
- [ ] **Troca de projeto pelo gestor**: abrir RDO, trocar projeto, alterar número, salvar/aprovar, gerar PDF/DOCX e confirmar líder e assinatura corretos.
- [ ] **Validação visual HTML x React**: percorrer as telas em desktop e mobile comparando RDO, Gestor, Coordenador e Cliente contra `filtrovali_app_v4.html`.
- [ ] **Responsividade em celular real**: validar cards de serviço, botões compactos, tabs/chips e toasts sem overflow horizontal e sem encobrir ações.
- [ ] **Coordenador**: validar se densidade visual, agrupamento de relatórios e ações correspondem ao padrão do Gestor, sem os CRUDs.
- [ ] **Correções recentes de relatório**: validar data sem retroceder um dia, obrigatoriedade de `Serviço finalizado?`, campo `Limpeza de tubulação?`, cores de links/textos, home do colaborador e centralização desktop.

---

## Notas Técnicas

- Dev local: `frontend/.env.local` com `VITE_API_BASE_URL=http://localhost:4000/api` e `VITE_ASSETS_BASE_URL=http://localhost:4000`.
- Build: `npm run build` em `frontend/`. Lint só emite avisos de Fast Refresh e dependências de hook — não bloqueiam build.
- O `filtrovali_app_v4.html` permanece referência funcional até o cutover.
- Node local é `18.19.1`; algumas dependências recomendam `>=20`.

---
