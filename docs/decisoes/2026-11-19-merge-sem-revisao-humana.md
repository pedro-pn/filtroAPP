# Merge na `main` sem revisão humana obrigatória

- **Data:** 2026-11-19
- **Decisão:** a proteção da `main` não exige aprovação humana de PR. O porteiro é automático: os 12 checks obrigatórios do CI (Architecture, Backend, Frontend, Docker e as 8 suítes com PostgreSQL, incluindo o papel restrito do banco), branch atualizada antes do merge (`strict`), regra valendo também para admins, sem force-push nem exclusão da `main`.
- **Contexto:** o projeto tem um único mantenedor e as entregas são feitas com agentes que já rodam revisão de código e de segurança antes de abrir o PR. Exigir aprovação humana viraria formalidade (o autor aprovando o próprio PR) e só atrasaria as entregas.
- **Critério da régua:** 1.3 ("revisão antes da versão principal: porteiro, revisor humano ou ambos") — atendido pelo porteiro automático.
- **Riscos aceitos:** um defeito que passe nos testes automáticos chega à `main` sem segundo olhar humano. Mitigação: testes de banco obrigatórios, trava de migrations destrutivas, deploy com conferência e volta automática, ensaio de volta comprovado (2026-11-19).
- **Quando revisar:** se entrar uma segunda pessoa no time de desenvolvimento ou se um cliente externo exigir revisão por par.
