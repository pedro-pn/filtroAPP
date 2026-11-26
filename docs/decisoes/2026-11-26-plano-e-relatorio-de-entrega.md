# Plano e relatório de cada entrega: `specs/` e a descrição do PR

- **Data:** 2026-11-26
- **Decisão:** o critério 13.5 da régua (cada entrega deixa um plano e um relatório) é atendido
  assim, sem as pastas `docs/planos/` e `docs/entregas/`:
  - **Plano:**
    - entrega grande (feature nova, mudança de modelo de dados, integração nova): `specs/NNN-nome/`,
      com `spec.md`, `plan.md` e `tasks.md` (spec-kit, adotado em 07/2026);
    - entrega pequena: a seção **"Por que"** da descrição do PR.
  - **Relatório:** a descrição do PR, pelo modelo `.github/pull_request_template.md`, com as seções
    "Por que", "O que muda", "Como foi testado", "Como conferir depois do deploy", "Pendências" e
    "Documentação".
- **Motivo:**
  - **Sem duplicar:** o PR já é o lugar onde a mudança é revista, fica ligado aos commits e é
    encontrado pelo `git log`/`gh pr view`. Um arquivo a mais em `docs/entregas/` repetiria o
    mesmo texto e desatualizaria.
  - **Plano das grandes:** o `specs/` já cumpre esse papel desde julho.
- **Riscos aceitos:**
  - o relatório fica no GitHub, não no repositório; se o projeto sair do GitHub, as descrições
    precisam ser exportadas junto;
  - o modelo de PR não é obrigatório: PRs do Dependabot e de emergência podem vir sem as seções.
- **Como conferir:** os PRs recentes, exceto os do Dependabot, têm as seções preenchidas. As
  entregas grandes têm `specs/NNN`.
- **Quando revisar:** se a equipe crescer e as descrições de PR deixarem de ser suficientes para
  quem chega, ou se aparecer a necessidade de um histórico de entregas fora do GitHub.
